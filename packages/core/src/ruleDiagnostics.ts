import type {
  BoeInspectionSnapshot,
  JsonValue,
  RuleCategory,
  RuleSeverity,
} from '@zfs-boe-inspector/shared-types';

export type DiagnosticState = 'ok' | 'issue' | 'unverified';

export interface RuleDiagnosticEntry {
  id: string;
  category: Exclude<RuleCategory, 'field-config' | 'travel-standard'>;
  state: DiagnosticState;
  severity?: RuleSeverity;
  summary: string;
  detail: string;
  areaCode?: string;
  areaName?: string;
  fieldCode?: string;
  fieldName?: string;
  rowIndex?: number;
  dependencies?: string[];
  currentValues?: Record<string, JsonValue>;
  evidencePaths: string[];
  technicalDetail?: JsonValue;
}

export interface RuleDiagnosticModel {
  category: RuleDiagnosticEntry['category'];
  title: string;
  entries: RuleDiagnosticEntry[];
  metrics: {
    total: number;
    issues: number;
    unverified: number;
    locatable: number;
  };
  truncatedAreas: Array<{ areaCode: string; totalRows: number; displayedRows: number }>;
}

export interface RuleDiagnostics {
  validation: RuleDiagnosticModel;
  calculation: RuleDiagnosticModel;
  dynamic: RuleDiagnosticModel;
  applyBoe: RuleDiagnosticModel;
}

interface TemplateField {
  area: Record<string, any>;
  field: Record<string, any>;
  areaIndex: number;
  fieldIndex: number;
  areaCode: string;
  areaName: string;
  fieldCode: string;
  fieldName: string;
  path: string;
}

const MAX_ROWS_PER_AREA = 50;

function asRecord(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : undefined;
}

function parseStructured(value: unknown): { value: unknown; error?: string } {
  if (typeof value !== 'string') return { value };
  const text = value.trim();
  if (!text || !['{', '['].includes(text[0] ?? '')) return { value };
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    return { value, error: error instanceof Error ? error.message : String(error) };
  }
}

function collectTemplateFields(snapshot: BoeInspectionSnapshot): TemplateField[] {
  return snapshot.config.template.flatMap((areaValue, areaIndex) => {
    const area = asRecord(areaValue);
    if (!area) return [];
    const areaCode = String(area.areaCode ?? '');
    const areaName = String(area.areaName ?? area.areaLabel ?? areaCode);
    const fields = Array.isArray(area.areaFields) ? area.areaFields : [];
    return fields.flatMap((fieldValue: unknown, fieldIndex: number) => {
      const field = asRecord(fieldValue);
      if (!field) return [];
      const fieldCode = String(field.fieldCode ?? field.code ?? '');
      return [{
        area,
        field,
        areaIndex,
        fieldIndex,
        areaCode,
        areaName,
        fieldCode,
        fieldName: String(field.fieldName ?? field.label ?? field.title ?? fieldCode),
        path: `config.template.${areaIndex}.areaFields.${fieldIndex}`,
      }];
    });
  });
}

function validReference(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    && value !== 'undefined.undefined';
}

function extractReferences(value: unknown, currentArea = ''): string[] {
  const result = new Set<string>();
  const add = (candidate: unknown, allowLocal = false) => {
    if (typeof candidate !== 'string') return;
    const code = candidate.trim();
    if (validReference(code)) {
      result.add(code);
      return;
    }
    if (allowLocal && /^[A-Za-z_][A-Za-z0-9_]*$/.test(code) && currentArea) {
      result.add(`${currentArea}.${code}`);
    }
  };
  const walk = (current: unknown) => {
    if (typeof current === 'string') {
      for (const match of current.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        add(`${match[1]}.${match[2]}`);
      }
      const parsed = parseStructured(current);
      if (parsed.value !== current) walk(parsed.value);
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    const record = asRecord(current);
    if (!record) return;
    add(record.code);
    add(record.__fieldCode);
    add(record.sourceField, true);
    add(record.targetField, true);
    add(record.prevField, true);
    if (record.type === 'fieldLiteral' || record.type === 'FieldLiteral') add(record.value, true);
    for (const nested of Object.values(record)) walk(nested);
  };
  walk(value);
  return [...result];
}

function dataRecord(snapshot: BoeInspectionSnapshot): Record<string, any> {
  return asRecord(snapshot.runtime.rawBillData) ?? {};
}

function fieldValue(snapshot: BoeInspectionSnapshot, reference: string, rowIndex = 0): JsonValue {
  const [areaCode = '', fieldCode = ''] = reference.split('.');
  const rows = dataRecord(snapshot)[areaCode];
  if (!Array.isArray(rows)) return null;
  const index = ['boeHeader', 'boeHeaderChild'].includes(areaCode) ? 0 : rowIndex;
  const row = asRecord(rows[index]);
  const value = row?.[fieldCode];
  return value === undefined ? null : value as JsonValue;
}

function currentValues(snapshot: BoeInspectionSnapshot, dependencies: string[], rowIndex = 0): Record<string, JsonValue> {
  return Object.fromEntries(dependencies.map((dependency) => [dependency, fieldValue(snapshot, dependency, rowIndex)]));
}

function functionNames(value: unknown): string[] {
  const names = new Set<string>();
  const walk = (current: unknown) => {
    if (typeof current === 'string') {
      for (const match of current.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
        const name = match[1];
        if (name && !['if', 'for', 'while', 'switch', 'function'].includes(name)) names.add(name);
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach(walk);
      return;
    }
    const record = asRecord(current);
    if (!record) return;
    if (record.__kind === 'function') names.add(String(record.name || 'anonymous'));
    for (const nested of Object.values(record)) walk(nested);
  };
  walk(value);
  return [...names];
}

function metrics(
  category: RuleDiagnosticModel['category'],
  title: string,
  entries: RuleDiagnosticEntry[],
  truncatedAreas: RuleDiagnosticModel['truncatedAreas'] = [],
): RuleDiagnosticModel {
  return {
    category,
    title,
    entries,
    metrics: {
      total: entries.length,
      issues: entries.filter(({ state }) => state === 'issue').length,
      unverified: entries.filter(({ state }) => state === 'unverified').length,
      locatable: entries.filter(({ areaCode, fieldCode }) => Boolean(areaCode && fieldCode)).length,
    },
    truncatedAreas,
  };
}

function rowCount(snapshot: BoeInspectionSnapshot, areaCode: string): number {
  const rows = dataRecord(snapshot)[areaCode];
  return Array.isArray(rows) && rows.length > 0 ? rows.length : 1;
}

function missingReferences(references: string[], knownFields: Set<string>): string[] {
  return references.filter((reference) => !knownFields.has(reference));
}

function knownFieldReferences(snapshot: BoeInspectionSnapshot, fields: TemplateField[]): Set<string> {
  const known = new Set(fields.map(({ areaCode, fieldCode }) => `${areaCode}.${fieldCode}`));
  for (const [areaCode, rows] of Object.entries(dataRecord(snapshot))) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      const rowRecord = asRecord(row);
      if (!rowRecord) continue;
      for (const fieldCode of Object.keys(rowRecord)) known.add(`${areaCode}.${fieldCode}`);
    }
  }
  ['boeStatus', 'boeTypeCode', 'boeNo', 'id'].forEach((fieldCode) => known.add(`boeHeader.${fieldCode}`));
  return known;
}

function businessText(value: unknown, fallback: string): string {
  const parsed = parseStructured(value).value;
  if (typeof parsed === 'string') {
    const text = parsed.trim();
    if (text.startsWith('"') && text.endsWith('"')) {
      try {
        const unquoted = JSON.parse(text);
        if (typeof unquoted === 'string') return unquoted;
      } catch {
        // 不是 JSON 字符串时沿用原文。
      }
    }
    return text || fallback;
  }
  const record = asRecord(parsed);
  if (!record) return fallback;
  return businessText(record.content ?? record.value ?? record.code, fallback);
}

export function buildValidationDiagnostics(snapshot: BoeInspectionSnapshot): RuleDiagnosticModel {
  const headerIndex = snapshot.config.template.findIndex((value) => asRecord(value)?.areaCode === 'boeHeader');
  const header = headerIndex >= 0 ? asRecord(snapshot.config.template[headerIndex]) : undefined;
  if (!header || header.validateRules === undefined || header.validateRules === '') {
    return metrics('validation-rule', '校验规则', []);
  }
  const parsed = parseStructured(header.validateRules);
  if (parsed.error || !Array.isArray(parsed.value)) {
    return metrics('validation-rule', '校验规则', [{
      id: 'VALIDATION_CONFIG_INVALID',
      category: 'validation-rule',
      state: 'issue',
      severity: 'error',
      summary: '校验规则配置无法解析',
      detail: parsed.error ?? 'validateRules 必须是数组',
      areaCode: 'boeHeader',
      areaName: String(header.areaName ?? '单据头'),
      evidencePaths: [`config.template.${headerIndex}.validateRules`],
      technicalDetail: header.validateRules as JsonValue,
    }]);
  }

  const fields = collectTemplateFields(snapshot);
  const knownFields = knownFieldReferences(snapshot, fields);
  const entries = parsed.value.flatMap((ruleValue, ruleIndex): RuleDiagnosticEntry[] => {
    const rule = asRecord(ruleValue);
    const path = `config.template.${headerIndex}.validateRules.${ruleIndex}`;
    if (!rule) {
      return [{
        id: 'VALIDATION_RULE_INVALID', category: 'validation-rule', state: 'issue', severity: 'error',
        summary: `第 ${ruleIndex + 1} 条校验规则格式无效`, detail: '规则项必须是对象',
        areaCode: 'boeHeader', evidencePaths: [path], technicalDetail: ruleValue as JsonValue,
      }];
    }
    const trigger = parseStructured(rule.triggerCondition);
    const content = parseStructured(rule.checkContent);
    const dependencies = [...new Set([
      ...extractReferences(trigger.value),
      ...extractReferences(content.value),
    ])];
    const missing = missingReferences(dependencies, knownFields);
    const errors = [
      trigger.error ? `triggerCondition JSON 无效：${trigger.error}` : '',
      content.error ? `checkContent JSON 无效：${content.error}` : '',
      missing.length > 0 ? `引用字段不存在：${missing.join('、')}` : '',
    ].filter(Boolean);
    const controlNodes = String(rule.controlNodeType ?? '01^02').split('^').filter(Boolean);
    const state: DiagnosticState = errors.length > 0 ? 'issue' : 'unverified';
    const firstDependency = dependencies[0]?.split('.') ?? [];
    return [{
      id: errors.length > 0 ? 'VALIDATION_RULE_BROKEN' : 'VALIDATION_RESULT_UNVERIFIED',
      category: 'validation-rule',
      state,
      ...(state === 'issue' ? { severity: 'error' as const } : {}),
      summary: businessText(rule.remindTitle ?? rule.title, `校验规则 ${ruleIndex + 1}`),
      detail: errors.join('；') || `控制节点 ${controlNodes.join('、')}；Inspector 只解析规则，不执行校验表达式。`,
      ...(firstDependency[0] ? { areaCode: firstDependency[0] } : { areaCode: 'boeHeader' }),
      ...(firstDependency[1] ? { fieldCode: firstDependency[1] } : {}),
      dependencies,
      currentValues: currentValues(snapshot, dependencies),
      evidencePaths: [path],
      technicalDetail: {
        priority: rule.priority ?? null,
        controlType: rule.controlType ?? null,
        controlNodes,
        triggerCondition: trigger.value as JsonValue,
        checkContent: content.value as JsonValue,
      },
    }];
  });
  return metrics('validation-rule', '校验规则', entries);
}

function findCycle(graph: Map<string, Set<string>>): string[] | undefined {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): string[] | undefined => {
    if (visiting.has(node)) return [...stack.slice(stack.indexOf(node)), node];
    if (visited.has(node)) return undefined;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (!graph.has(next)) continue;
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return undefined;
  };
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return undefined;
}

export function buildCalculationDiagnostics(snapshot: BoeInspectionSnapshot): RuleDiagnosticModel {
  const fields = collectTemplateFields(snapshot);
  const knownFields = knownFieldReferences(snapshot, fields);
  const graph = new Map<string, Set<string>>();
  const truncatedAreas = new Map<string, RuleDiagnosticModel['truncatedAreas'][number]>();
  const entries: RuleDiagnosticEntry[] = [];

  for (const item of fields) {
    const raw = item.field.calculate ?? item.field.computed;
    if (raw === undefined || raw === '' || raw === null) continue;
    const parsed = parseStructured(raw);
    const dependencies = extractReferences(parsed.value, item.areaCode);
    const identity = `${item.areaCode}.${item.fieldCode}`;
    graph.set(identity, new Set(dependencies));
    const missing = missingReferences(dependencies, knownFields);
    const count = rowCount(snapshot, item.areaCode);
    const displayed = Math.min(count, MAX_ROWS_PER_AREA);
    if (count > displayed) {
      truncatedAreas.set(item.areaCode, { areaCode: item.areaCode, totalRows: count, displayedRows: displayed });
    }
    const errors = [
      parsed.error ? `计算配置 JSON 无效：${parsed.error}` : '',
      missing.length > 0 ? `引用字段不存在：${missing.join('、')}` : '',
    ].filter(Boolean);
    for (let rowIndex = 0; rowIndex < displayed; rowIndex += 1) {
      const state: DiagnosticState = errors.length > 0 ? 'issue' : 'unverified';
      entries.push({
        id: errors.length > 0 ? 'CALCULATION_CONFIG_BROKEN' : 'CALCULATION_RESULT_UNVERIFIED',
        category: 'calculation-rule',
        state,
        ...(state === 'issue' ? { severity: 'error' as const } : {}),
        summary: `${item.fieldName} · 第 ${rowIndex + 1} 行`,
        detail: errors.join('；') || '依赖与条件分支已解析；Inspector 不执行计算公式，结果标记为未验证。',
        areaCode: item.areaCode,
        areaName: item.areaName,
        fieldCode: item.fieldCode,
        fieldName: item.fieldName,
        rowIndex,
        dependencies,
        currentValues: currentValues(snapshot, dependencies, rowIndex),
        evidencePaths: [item.path, `runtime.rawBillData.${item.areaCode}.${rowIndex}.${item.fieldCode}`],
        technicalDetail: {
          type: item.field.calculate !== undefined ? 'calculate' : 'computed',
          branches: Array.isArray(parsed.value) ? parsed.value as JsonValue[] : [],
          formula: parsed.value as JsonValue,
          functionNames: functionNames(parsed.value),
        },
      });
    }
  }

  const cycle = findCycle(graph);
  if (cycle) {
    const [areaCode = '', fieldCode = ''] = cycle[0]?.split('.') ?? [];
    entries.unshift({
      id: 'CALCULATION_DEPENDENCY_CYCLE',
      category: 'calculation-rule',
      state: 'issue',
      severity: 'error',
      summary: '计算字段存在循环依赖',
      detail: cycle.join(' → '),
      areaCode,
      fieldCode,
      dependencies: cycle,
      evidencePaths: ['config.template'],
      technicalDetail: cycle,
    });
  }
  return metrics('calculation-rule', '计算规则', entries, [...truncatedAreas.values()]);
}

const DYNAMIC_KEYS = ['show', 'edit', 'requireSet', 'formShow', 'formRequire'] as const;

export function buildDynamicDiagnostics(snapshot: BoeInspectionSnapshot): RuleDiagnosticModel {
  const fields = collectTemplateFields(snapshot);
  const knownFields = knownFieldReferences(snapshot, fields);
  const states = snapshot.config.fieldRuntimeStates ?? [];
  const entries: RuleDiagnosticEntry[] = [];
  const truncatedAreas = new Map<string, RuleDiagnosticModel['truncatedAreas'][number]>();

  const visitedAreas = new Set<string>();
  for (const item of fields) {
    if (visitedAreas.has(item.areaCode)) continue;
    visitedAreas.add(item.areaCode);
    const configured = DYNAMIC_KEYS.filter((key) => item.area[key] !== undefined && item.area[key] !== '');
    if (configured.length === 0) continue;
    const parseErrors = configured.flatMap((key) => {
      const parsed = parseStructured(item.area[key]);
      return parsed.error ? [`${key} JSON 无效：${parsed.error}`] : [];
    });
    const dependencies = [...new Set(configured.flatMap((key) => extractReferences(item.area[key], item.areaCode)))];
    const missing = missingReferences(dependencies, knownFields);
    const errors = [
      ...parseErrors,
      ...(missing.length > 0 ? [`引用字段不存在：${missing.join('、')}`] : []),
    ];
    entries.push({
      id: errors.length > 0 ? 'DYNAMIC_AREA_CONFIG_BROKEN' : 'DYNAMIC_AREA_RUNTIME_UNVERIFIED',
      category: 'dynamic-rule',
      state: errors.length > 0 ? 'issue' : 'unverified',
      ...(errors.length > 0 ? { severity: 'error' as const } : {}),
      summary: `${item.areaName} · 区域动态规则`,
      detail: errors.join('；') || '区域动态配置已解析，但 Snapshot v1 不新增区域动态执行，结果标记为未验证。',
      areaCode: item.areaCode,
      areaName: item.areaName,
      dependencies,
      currentValues: currentValues(snapshot, dependencies),
      evidencePaths: configured.map((key) => `config.template.${item.areaIndex}.${key}`),
      technicalDetail: {
        configuredKeys: configured,
        rawConfig: Object.fromEntries(configured.map((key) => [key, item.area[key]])) as JsonValue,
      },
    });
  }

  for (const item of fields) {
    const configured = DYNAMIC_KEYS.filter((key) => item.field[key] !== undefined && item.field[key] !== '');
    const matchingStates = states.filter(({ areaCode, fieldCode }) => areaCode === item.areaCode && fieldCode === item.fieldCode);
    if (configured.length === 0 && matchingStates.length === 0) continue;
    const count = rowCount(snapshot, item.areaCode);
    const displayed = Math.min(count, MAX_ROWS_PER_AREA);
    if (count > displayed) truncatedAreas.set(item.areaCode, { areaCode: item.areaCode, totalRows: count, displayedRows: displayed });
    for (let rowIndex = 0; rowIndex < displayed; rowIndex += 1) {
      const runtime = matchingStates.find((state) => state.rowIndex === rowIndex);
      const parseErrors = configured.flatMap((key) => {
        const parsed = parseStructured(item.field[key]);
        return parsed.error ? [`${key} JSON 无效：${parsed.error}`] : [];
      });
      const dependencies = [...new Set(configured.flatMap((key) => extractReferences(item.field[key], item.areaCode)))];
      const missing = missingReferences(dependencies, knownFields);
      const errors = [
        ...parseErrors,
        ...(missing.length > 0 ? [`引用字段不存在：${missing.join('、')}`] : []),
        ...(runtime?.evaluationError ? [`运行态采集失败：${runtime.evaluationError}`] : []),
      ];
      const state: DiagnosticState = errors.length > 0 ? 'issue' : runtime ? 'ok' : 'unverified';
      entries.push({
        id: errors.length > 0
          ? 'DYNAMIC_CONFIG_BROKEN'
          : runtime ? 'DYNAMIC_RUNTIME_OBSERVED' : 'DYNAMIC_RUNTIME_UNVERIFIED',
        category: 'dynamic-rule',
        state,
        ...(state === 'issue' ? { severity: 'error' as const } : {}),
        summary: `${item.fieldName} · 第 ${rowIndex + 1} 行`,
        detail: errors.join('；') || (runtime
          ? `当前显示 ${runtime.visible === true ? '是' : '否'}、编辑 ${runtime.editable === true ? '是' : '否'}、必填 ${runtime.required === true ? '是' : '否'}。`
          : '存在动态配置，但未采集到对应运行态，结果标记为未验证。'),
        areaCode: item.areaCode,
        areaName: item.areaName,
        fieldCode: item.fieldCode,
        fieldName: item.fieldName,
        rowIndex,
        dependencies,
        currentValues: currentValues(snapshot, dependencies, rowIndex),
        evidencePaths: [...configured.map((key) => `${item.path}.${key}`), `config.fieldRuntimeStates`],
        technicalDetail: {
          configuredKeys: configured,
          runtimeState: runtime ? runtime as unknown as JsonValue : null,
          rawConfig: Object.fromEntries(configured.map((key) => [key, item.field[key]])) as JsonValue,
        },
      });
    }
  }
  return metrics('dynamic-rule', '动态规则', entries, [...truncatedAreas.values()]);
}

interface ApplyMapping {
  fromAreaCode: string;
  fromFieldCode: string;
  fromLabelCode: string;
  toAreaCode: string;
  toFieldCode: string;
  toLabelCode: string;
  assignArea: string;
  isAdd?: boolean;
  path: string;
}

function flattenMappings(value: unknown, path: string): { mappings: ApplyMapping[]; error?: string } {
  const parsed = parseStructured(value);
  if (parsed.error) return { mappings: [], error: parsed.error };
  if (!Array.isArray(parsed.value)) return { mappings: [], error: 'dataTrans 必须是数组' };
  const mappings: ApplyMapping[] = [];
  parsed.value.forEach((outerValue, outerIndex) => {
    const outer = asRecord(outerValue);
    if (!outer) return;
    const items = Array.isArray(outer.assignData) ? outer.assignData : [outer];
    items.forEach((innerValue: unknown, innerIndex: number) => {
      const inner = asRecord(innerValue);
      if (!inner) return;
      mappings.push({
        fromAreaCode: String(inner.fromAreaCode ?? ''),
        fromFieldCode: String(inner.fromFieldCode ?? inner.from ?? ''),
        fromLabelCode: String(inner.fromLabelCode ?? ''),
        toAreaCode: String(inner.toAreaCode ?? outer.assignArea ?? ''),
        toFieldCode: String(inner.toFieldCode ?? inner.to ?? ''),
        toLabelCode: String(inner.toLabelCode ?? ''),
        assignArea: String(outer.assignArea ?? inner.assignArea ?? inner.toAreaCode ?? ''),
        ...(typeof outer.isAdd === 'boolean' ? { isAdd: outer.isAdd } : {}),
        path: `${path}.${outerIndex}${Array.isArray(outer.assignData) ? `.assignData.${innerIndex}` : ''}`,
      });
    });
  });
  return { mappings };
}

function nestedRows(value: unknown, areaCode: string): Record<string, any>[] {
  const record = asRecord(value);
  const rows = record?.[areaCode];
  return Array.isArray(rows) ? rows.flatMap((row) => asRecord(row) ?? []) : [];
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

function sameValue(left: unknown, right: unknown): boolean {
  if (!present(left) && !present(right)) return true;
  if (typeof left === 'object' || typeof right === 'object') return JSON.stringify(left) === JSON.stringify(right);
  return String(left) === String(right);
}

export function buildApplyBoeDiagnostics(snapshot: BoeInspectionSnapshot): RuleDiagnosticModel {
  const fields = collectTemplateFields(snapshot);
  const knownFields = knownFieldReferences(snapshot, fields);
  const configs: Array<{ field: TemplateField; config: Record<string, any>; path: string }> = [];
  const walk = (value: unknown, owner: TemplateField, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, owner, `${path}.${index}`));
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    if (asRecord(record.applyBoeConfig)) {
      configs.push({ field: owner, config: record.applyBoeConfig, path: `${path}.applyBoeConfig` });
    }
    for (const [key, nested] of Object.entries(record)) {
      if (key !== 'applyBoeConfig') walk(nested, owner, `${path}.${key}`);
    }
  };
  fields.forEach((field) => walk(field.field, field, field.path));

  const entries: RuleDiagnosticEntry[] = [];
  const targetCounts = new Map<string, { target: string; count: number; evidencePaths: string[] }>();
  const applySource = snapshot.applyBoe?.lastApplyBoeData[0];
  const transData = snapshot.applyBoe?.lastTransData;
  for (const { field, config, path } of configs) {
    const flattened = flattenMappings(config.dataTrans, `${path}.dataTrans`);
    if (flattened.error) {
      entries.push({
        id: 'APPLY_BOE_DATA_TRANS_INVALID', category: 'apply-boe', state: 'issue', severity: 'error',
        summary: `${field.fieldName} 的 dataTrans 配置无效`, detail: flattened.error,
        areaCode: field.areaCode, areaName: field.areaName, fieldCode: field.fieldCode, fieldName: field.fieldName,
        evidencePaths: [`${path}.dataTrans`], technicalDetail: config.dataTrans as JsonValue,
      });
      continue;
    }
    if (flattened.mappings.length === 0) {
      entries.push({
        id: 'APPLY_BOE_DATA_TRANS_EMPTY', category: 'apply-boe', state: 'issue', severity: 'error',
        summary: `${field.fieldName} 未配置字段映射`, detail: 'applyBoeConfig 已存在，但 dataTrans 中没有可用映射。',
        areaCode: field.areaCode, areaName: field.areaName, fieldCode: field.fieldCode, fieldName: field.fieldName,
        evidencePaths: [`${path}.dataTrans`],
      });
    }
    flattened.mappings.forEach((mapping, mappingIndex) => {
      const target = `${mapping.toAreaCode}.${mapping.toFieldCode}`;
      const targetKey = `${path}:${target}`;
      const targetCount = targetCounts.get(targetKey) ?? { target, count: 0, evidencePaths: [] };
      targetCount.count += 1;
      targetCount.evidencePaths.push(mapping.path);
      targetCounts.set(targetKey, targetCount);
      const requiredMissing = [
        !mapping.fromAreaCode ? 'fromAreaCode' : '',
        !mapping.fromFieldCode ? 'fromFieldCode' : '',
        !mapping.toAreaCode ? 'toAreaCode' : '',
        !mapping.toFieldCode ? 'toFieldCode' : '',
      ].filter(Boolean);
      const targetMissing = mapping.toAreaCode && mapping.toFieldCode && !knownFields.has(target);
      const sourceRows = nestedRows(applySource, mapping.fromAreaCode);
      const transRows = nestedRows(transData, mapping.assignArea || mapping.toAreaCode);
      const targetRows = nestedRows(snapshot.runtime.rawBillData, mapping.toAreaCode);
      const rowLimit = Math.min(Math.max(sourceRows.length, transRows.length, targetRows.length, 1), MAX_ROWS_PER_AREA);
      for (let rowIndex = 0; rowIndex < rowLimit; rowIndex += 1) {
        const source = sourceRows[rowIndex]?.[mapping.fromFieldCode];
        const transformed = transRows[rowIndex]?.[mapping.toFieldCode];
        const targetValue = targetRows[rowIndex]?.[mapping.toFieldCode];
        const hasComparableEvidence = Boolean(sourceRows[rowIndex] && transRows[rowIndex]);
        const issues = [
          requiredMissing.length > 0 ? `映射缺少 ${requiredMissing.join('、')}` : '',
          targetMissing ? `目标字段不存在：${target}` : '',
          present(source) && snapshot.applyBoe && !present(transformed) ? '源申请有值，但转换结果为空' : '',
          present(transformed) && !present(targetValue) ? '转换结果有值，但当前单据字段为空' : '',
          present(transformed) && present(targetValue) && !sameValue(transformed, targetValue) ? '转换结果与当前字段值不一致' : '',
        ].filter(Boolean);
        const state: DiagnosticState = issues.length > 0 ? 'issue' : hasComparableEvidence ? 'ok' : 'unverified';
        entries.push({
          id: issues.length > 0 ? 'APPLY_BOE_MAPPING_INCONSISTENT' : hasComparableEvidence ? 'APPLY_BOE_MAPPING_MATCHED' : 'APPLY_BOE_MAPPING_UNVERIFIED',
          category: 'apply-boe',
          state,
          ...(state === 'issue' ? { severity: 'error' as const } : {}),
          summary: `${mapping.fromAreaCode}.${mapping.fromFieldCode} → ${target}`,
          detail: issues.join('；') || (hasComparableEvidence
            ? '源申请数据、转换结果与当前字段值未发现明确不一致。'
            : '未提供完整关联申请证据，仅展示模板映射与当前字段值。'),
          areaCode: mapping.toAreaCode || field.areaCode,
          areaName: field.areaName,
          fieldCode: mapping.toFieldCode || field.fieldCode,
          fieldName: mapping.toFieldCode || field.fieldName,
          rowIndex,
          evidencePaths: [mapping.path, `runtime.rawBillData.${mapping.toAreaCode}.${rowIndex}.${mapping.toFieldCode}`],
          technicalDetail: {
            mapping: mapping as unknown as JsonValue,
            sourceValue: source === undefined ? null : source as JsonValue,
            transformedValue: transformed === undefined ? null : transformed as JsonValue,
            targetValue: targetValue === undefined ? null : targetValue as JsonValue,
            sourceLabelValue: sourceRows[rowIndex]?.[mapping.fromLabelCode] ?? null,
            transformedLabelValue: transRows[rowIndex]?.[mapping.toLabelCode] ?? null,
            targetLabelValue: targetRows[rowIndex]?.[mapping.toLabelCode] ?? null,
            mappingIndex,
          },
        });
      }
    });
  }
  for (const { target, count, evidencePaths } of targetCounts.values()) {
    if (target === '.' || count < 2) continue;
    const [areaCode = '', fieldCode = ''] = target.split('.');
    entries.unshift({
      id: 'APPLY_BOE_TARGET_DUPLICATE', category: 'apply-boe', state: 'issue', severity: 'warning',
      summary: `目标字段 ${target} 存在重复映射`, detail: `共有 ${count} 条 dataTrans 映射写入同一目标字段。`,
      areaCode, fieldCode, evidencePaths,
    });
  }

  const child = nestedRows(snapshot.runtime.rawBillData, 'boeHeaderChild')[0];
  const applyId = child?.applyBoeId ?? child?.applyBoeNo;
  const detailStats = Object.entries(dataRecord(snapshot)).flatMap(([areaCode, rows]) => {
    if (!Array.isArray(rows)) return [];
    const refCount = rows.filter((row) => present(asRecord(row)?.refApplyboeId)).length;
    return refCount > 0 ? [{ areaCode, total: rows.length, refCount }] : [];
  });
  if (configs.length > 0) {
    entries.unshift({
      id: 'APPLY_BOE_ASSOCIATION_SUMMARY', category: 'apply-boe', state: applyId ? 'ok' : 'unverified',
      summary: applyId ? `当前关联申请：${String(applyId)}` : '当前单据未识别到关联申请编号',
      detail: applyId ? `剩余额度：${String(child?.remainingAvailableAmount ?? '未提供')}；关联明细区域 ${detailStats.length} 个。` : '无法静态确认当前业务是否应已关联申请，未计入问题。',
      areaCode: 'boeHeaderChild', fieldCode: 'applyBoeId', evidencePaths: ['runtime.rawBillData.boeHeaderChild.0'],
      technicalDetail: {
        applyBoeId: child?.applyBoeId ?? null,
        applyBoeNo: child?.applyBoeNo ?? null,
        remainingAvailableAmount: child?.remainingAvailableAmount ?? null,
        detailStats,
        flowStatus: snapshot.applyBoe?.flowStatus ?? null,
      },
    });
  }
  return metrics('apply-boe', '关联申请', entries);
}

export function buildRuleDiagnostics(snapshot: BoeInspectionSnapshot): RuleDiagnostics {
  return {
    validation: buildValidationDiagnostics(snapshot),
    calculation: buildCalculationDiagnostics(snapshot),
    dynamic: buildDynamicDiagnostics(snapshot),
    applyBoe: buildApplyBoeDiagnostics(snapshot),
  };
}
