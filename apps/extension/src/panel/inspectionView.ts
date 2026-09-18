import type { BoeInspectionSnapshot, FieldDetail, FieldSelection, JsonValue, RuleEvaluation } from '@zfs-boe-inspector/shared-types';
import type { RuleDiagnosticEntry } from '@zfs-boe-inspector/core';

export function record(value: unknown): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
}

export function fieldAreas(snapshot?: BoeInspectionSnapshot) {
  return (snapshot?.config.template ?? []).map((raw, areaIndex) => {
    const area = record(raw);
    const fields = (Array.isArray(area.areaFields) ? area.areaFields : []).map((rawField, fieldIndex): Record<string, JsonValue> & { fieldIndex: number } => ({ ...record(rawField), fieldIndex }));
    const counts = new Map<JsonValue, number>();
    const ordinals = new Map<JsonValue, number>();
    for (const field of fields) if (field.fieldCode) counts.set(field.fieldCode, (counts.get(field.fieldCode) ?? 0) + 1);
    return {
      areaIndex, areaCode: String(area.areaCode ?? ''), areaName: String(area.areaName || area.areaCode || '未命名区域'),
      fields: fields.map((field): Record<string, JsonValue> & { fieldIndex: number; duplicateCount: number; duplicateOrdinal: number } => {
        const code = field.fieldCode;
        const ordinal = code ? (ordinals.get(code) ?? 0) + 1 : 0;
        if (code) ordinals.set(code, ordinal);
        return { ...field, duplicateCount: code ? counts.get(code)! : 0, duplicateOrdinal: ordinal };
      }),
    };
  });
}

/** 旧 Adapter 不支持配置索引时，从同一快照恢复配置详情。 */
export function indexedFieldDetail(snapshot: BoeInspectionSnapshot, selection: FieldSelection): FieldDetail | undefined {
  const area = snapshot.config.template.find((value) => record(value).areaCode === selection.areaCode);
  const fields = record(area).areaFields;
  if (!Array.isArray(fields) || selection.fieldIndex === undefined || !Number.isInteger(selection.fieldIndex)) return;
  const field = fields[selection.fieldIndex];
  const config = record(field);
  if (!field || (String(config.fieldCode ?? '') !== selection.fieldCode && config.labelCode !== selection.fieldCode)) return;
  const groups: FieldDetail['groups'] = [];
  for (const descriptor of snapshot.config.fieldDescriptors?.[String(config.fieldType)] ?? []) {
    let group = groups.find((item) => item.key === descriptor.classify);
    if (!group) {
      group = { key: descriptor.classify, label: ({ base: '基本', advance: '高级', data: '数据源' } as Record<string, string>)[descriptor.classify] ?? descriptor.classify, items: [] };
      groups.push(group);
    }
    group.items.push({ ...descriptor, ...(config[descriptor.code] === undefined ? {} : { value: config[descriptor.code] }) });
  }
  const fieldCode = String(config.fieldCode ?? selection.fieldCode);
  const rows = record(snapshot.runtime.rawBillData)[selection.areaCode];
  const value = record(Array.isArray(rows) ? rows[selection.rowIndex] : undefined)[fieldCode];
  const runtimeState = snapshot.config.fieldRuntimeStates?.find((state) => state.areaCode === selection.areaCode && state.fieldCode === fieldCode && state.rowIndex === selection.rowIndex);
  return { selection: { ...selection, fieldCode }, field, area: area!, groups,
    ...(value === undefined ? {} : { value }), ...(runtimeState ? { runtimeState } : {}) };
}

export const categoryLabels: Record<RuleEvaluation['category'], string> = {
  'field-config': '字段配置', 'validation-rule': '校验规则', 'calculation-rule': '计算规则',
  'dynamic-rule': '动态规则', 'apply-boe': '关联申请', 'travel-standard': '差旅标准',
};

export function issueItems(snapshot: BoeInspectionSnapshot | undefined, evaluations: RuleEvaluation[], diagnostics: RuleDiagnosticEntry[] = []) {
  const areas = fieldAreas(snapshot);
  const areaByCode = new Map(areas.map((area) => [area.areaCode, area]));
  const areasByLength = [...areas].sort((a, b) => b.areaCode.length - a.areaCode.length);
  const diagnosticIndex = new Map<string, RuleDiagnosticEntry[]>();
  for (const entry of diagnostics) {
    for (const path of entry.evidencePaths) {
      const key = JSON.stringify([entry.id, path]);
      const items = diagnosticIndex.get(key) ?? [];
      items.push(entry); diagnosticIndex.set(key, items);
    }
  }
  const fieldsByCode = new Map(areas.map((area) => {
    const fields = new Map<string, typeof area.fields>();
    for (const field of area.fields) {
      const code = String(field.fieldCode ?? '');
      const items = fields.get(code) ?? [];
      items.push(field); fields.set(code, items);
    }
    return [area.areaCode, fields] as const;
  }));
  return evaluations.map((evaluation, index) => {
    const areaCodes = new Set<string>();
    const targets = new Map<string, { selection: FieldSelection; label: string }>();
    const add = (areaCode: string, fieldCode?: string, rowIndex = 0, fieldIndex?: number) => {
      const area = areaByCode.get(areaCode);
      if (!area) return;
      areaCodes.add(areaCode);
      const fields = fieldIndex === undefined ? fieldsByCode.get(areaCode)?.get(fieldCode ?? '') ?? []
        : area.fields[fieldIndex] ? [area.fields[fieldIndex]!] : [];
      for (const field of fieldCode === undefined && fieldIndex === undefined ? [] : fields) {
        const selection = { areaCode, fieldCode: String(field.fieldCode ?? ''), rowIndex, fieldIndex: field.fieldIndex };
        targets.set(JSON.stringify(selection), { selection,
          label: `${field.fieldName || field.fieldCode || '未命名字段'}${field.duplicateCount > 1 ? `（重复 ${field.duplicateOrdinal}/${field.duplicateCount}）` : ''} · ${area.areaName}` });
      }
    };
    for (const path of evaluation.evidencePaths) {
      const config = /^config\.template\.(\d+)(?:\.areaFields\.(\d+))?(?:\.|$)/.exec(path);
      if (config) {
        const area = areas[Number(config[1])];
        if (area) add(area.areaCode, undefined, 0, config[2] === undefined ? undefined : Number(config[2]));
      }
      const area = areasByLength.find((item) => path === `runtime.rawBillData.${item.areaCode}` || path.startsWith(`runtime.rawBillData.${item.areaCode}.`));
      if (area) {
        const tail = path.slice(`runtime.rawBillData.${area.areaCode}`.length + 1).split('.');
        add(area.areaCode, tail[1], /^\d+$/.test(tail[0] ?? '') ? Number(tail[0]) : 0);
      }
    }
    const related = new Set(evaluation.evidencePaths.flatMap((path) => diagnosticIndex.get(JSON.stringify([evaluation.ruleId, path])) ?? []));
    for (const entry of related) {
      if (entry.areaCode) add(entry.areaCode, entry.fieldCode, entry.rowIndex ?? 0);
      for (const dependency of entry.dependencyDetails ?? []) add(dependency.areaCode, dependency.fieldCode, dependency.values[0]?.rowIndex ?? 0);
    }
    const targetList = [...targets.values()];
    const search = `${evaluation.summary} ${evaluation.ruleId} ${evaluation.reason ?? ''} ${targetList.map((target) => `${target.label} ${target.selection.fieldCode}`).join(' ')} ${evaluation.evidencePaths.join(' ')}`.toLowerCase();
    return { id: index, evaluation, search, areaCodes: [...areaCodes], targets: targetList, type: evaluation.category === 'field-config' ? 'field' : 'rule', categoryLabel: categoryLabels[evaluation.category] };
  });
}

export function displayValue(value: unknown): string {
  if (value === undefined) return '未采集';
  if (value === '') return '""（空字符串）';
  const marker = record(value).__kind;
  if (marker === 'undefined') return 'undefined';
  if (marker === 'truncated') return '已截断';
  if (marker === 'unreadable') return '不可读取';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function structured(value: unknown): { value: unknown; error?: string } {
  if (typeof value !== 'string' || !value.trim()) return { value };
  try { return { value: JSON.parse(value) }; }
  catch { return { value, error: '配置不是有效 JSON' }; }
}

export function expressionText(value: unknown): string {
  const parsed = structured(value);
  const content = record(parsed.value).content;
  return displayValue(content ?? parsed.value);
}

export function validationRows(value: unknown) {
  if (value === undefined || value === null || value === '') return { rows: [], error: '' };
  const parsed = structured(value);
  if (!Array.isArray(parsed.value)) return { rows: [], error: parsed.error ?? '校验规则必须为数组' };
  return { error: '', rows: parsed.value.map((raw, index) => {
    const rule = record(raw);
    const nodes = String(rule.controlNodeType || '01^02').split('^');
    return { index, raw, rule,
      error: !raw || typeof raw !== 'object' || Array.isArray(raw) ? '规则项必须是对象' : '',
      check: expressionText(rule.checkContent), trigger: expressionText(rule.triggerCondition), remind: expressionText(rule.remindTitle),
      control: String(rule.controlTypeName || ({ '001': '禁止', '002': '警告' } as Record<string, string>)[String(rule.controlType)] || rule.controlType || '未采集'),
      nodes: String(rule.controlNodeTypeName || nodes.map((node) => ({ '01': '提交', '02': '同意', '03': '驳回' } as Record<string, string>)[node] || node).join('、')),
      nodeCodes: nodes,
      state: String(rule.validityFlagName ?? rule.validityFlag ?? '未采集'),
      parseErrors: ['triggerCondition', 'checkContent', 'remindTitle'].filter((key) => rule[key] && structured(rule[key]).error),
    };
  }) };
}
