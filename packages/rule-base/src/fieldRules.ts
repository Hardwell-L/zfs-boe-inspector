import { getByPath, isEmpty } from '@zfs-boe-inspector/core';
import type { BoeInspectionSnapshot, RuleEvaluation } from '@zfs-boe-inspector/shared-types';
import {
  asRecord,
  collectFields,
  extractReferenceTokens,
  hasCycle,
  issue,
  jsonValue,
  parseMaybeJson,
  passed,
  skipped,
} from './helpers';

const FIELD_RULE_IDS = [
  'FIELD_CODE_MISSING',
  'FIELD_DUPLICATE_IN_AREA',
  'FIELD_RUNTIME_PATH_MISSING',
  'FIELD_CONFIG_PARSE_ERROR',
  'FIELD_WARNING_RULE_MISSING',
  'FIELD_REQUIRED_HIDDEN',
  'FIELD_REQUIRED_READONLY_EMPTY',
  'FIELD_DYNAMIC_CONFIG_INVALID',
  'FIELD_DYNAMIC_REFERENCE_MISSING',
  'FIELD_RUNTIME_TYPE_MISMATCH',
  'FIELD_DATASOURCE_INCOMPLETE',
  'FIELD_DATASOURCE_CONFIG_INVALID',
  'FIELD_ROW_KEY_MISSING',
  'FIELD_TRANS_INVALID',
  'FIELD_TRANS_TARGET_MISSING',
  'FIELD_TRANS_TARGET_CONFLICT',
  'FIELD_PREV_REFERENCE_MISSING',
  'FIELD_NEXT_REFERENCE_MISSING',
  'FIELD_CASCADE_CYCLE',
  'FIELD_RELATION_CONFIG_INVALID',
  'FIELD_DEFAULT_TYPE_MISMATCH',
  'FIELD_COMPUTE_CONFIG_INVALID',
  'FIELD_COMPUTE_REFERENCE_MISSING',
  'FIELD_COMPUTE_CYCLE',
  'FIELD_LINK_CONFIG_INCOMPLETE',
  'FIELD_IMPORT_CONFIG_CONFLICT',
  'FIELD_FUNCTION_UNINSPECTABLE',
] as const;

const PARSEABLE_KEYS = [
  'show', 'edit', 'requireSet', 'rules', 'warning', 'computed', 'calculate',
  'config', 'staticConfig', 'trans', 'prev', 'nextField', 'extendConfig',
  'relateScheme', 'dataMappingConfig',
];

const DYNAMIC_KEYS = ['show', 'edit', 'requireSet', 'formShow', 'formRequire'];
const COMPUTE_KEYS = ['computed', 'calculate'];

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (value === 1 || value === '1' || value === 'true') return true;
  if (value === 0 || value === '0' || value === 'false') return false;
  return undefined;
}

function fieldValue(snapshot: BoeInspectionSnapshot, areaCode: string, fieldCode: string, rowIndex = 0): unknown {
  return getByPath(snapshot.runtime.rawBillData, `${areaCode}.${rowIndex}.${fieldCode}`);
}

function expectedRuntimeType(fieldType: unknown): 'array' | 'number' | 'boolean' | 'string' | undefined {
  const type = String(fieldType ?? '').toLowerCase();
  if (/(multi|checkbox|multiple)/.test(type)) return 'array';
  if (/(amount|number|money|rate|percent)/.test(type)) return 'number';
  if (/(switch|boolean)/.test(type)) return 'boolean';
  if (/(input|text|date|time|radio|select|picker)/.test(type)) return 'string';
  return undefined;
}

function actualType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function transEntries(value: unknown): Array<{ from?: string; to?: string }> | undefined {
  const parsed = parseMaybeJson(value);
  if (parsed.error) return undefined;
  if (Array.isArray(parsed.value)) return parsed.value.filter(asRecord);
  const record = asRecord(parsed.value);
  if (!record) return undefined;
  if ('from' in record || 'to' in record) return [record];
  return Object.entries(record).map(([from, to]) => ({
    from,
    ...(typeof to === 'string' ? { to } : {}),
  }));
}

function functionMetadataPaths(value: unknown, path = '', seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  if (asRecord(value)?.__kind === 'function') return [path];
  seen.add(value);
  const paths = Object.entries(value).flatMap(([key, child]) => (
    functionMetadataPaths(child, path ? `${path}.${key}` : key, seen)
  ));
  seen.delete(value);
  return paths;
}

function addPassedResults(results: RuleEvaluation[]): RuleEvaluation[] {
  for (const ruleId of FIELD_RULE_IDS) {
    if (!results.some((result) => result.ruleId === ruleId)) {
      results.push(passed(ruleId, 'field-config', `${ruleId} 未发现问题`));
    }
  }
  if (!results.some(({ ruleId }) => ruleId === 'FIELD_TRANS_SOURCE_UNVERIFIED')) {
    results.push(skipped(
      'FIELD_TRANS_SOURCE_UNVERIFIED',
      'field-config',
      'Snapshot 不包含数据源原始响应，无法确认 trans 是否遗漏源字段',
    ));
  }
  return results;
}

function skipUnavailableRules(reason: string): RuleEvaluation[] {
  return [
    ...FIELD_RULE_IDS.map((ruleId) => skipped(ruleId, 'field-config', reason)),
    skipped(
      'FIELD_TRANS_SOURCE_UNVERIFIED',
      'field-config',
      'Snapshot 不包含可用的模板配置，无法确认 trans 是否遗漏源字段',
    ),
  ];
}

export function evaluateFieldRules(snapshot: BoeInspectionSnapshot): RuleEvaluation[] {
  if (snapshot.meta.compatibility?.collection?.status === 'unavailable') {
    return skipUnavailableRules(
      '当前项目未提供可用的 bill template，字段规则暂不判定，避免将数据未加载误报为配置缺陷',
    );
  }
  const results: RuleEvaluation[] = [];
  const fields = collectFields(snapshot);
  const warningRuleNames = snapshot.config.warningRuleNames;
  const warningRules = warningRuleNames === undefined ? undefined : new Set(warningRuleNames);
  const knownFields = new Set(fields.filter(({ areaCode, fieldCode }) => areaCode && fieldCode)
    .map(({ areaCode, fieldCode }) => `${areaCode}.${fieldCode}`));
  const computeGraph = new Map<string, Set<string>>();
  const cascadeGraph = new Map<string, Set<string>>();

  for (const item of fields) {
    const { areaCode, fieldCode, field, path } = item;
    const identity = `${areaCode}.${fieldCode}`;
    if (!fieldCode) {
      results.push(issue('FIELD_CODE_MISSING', 'field-config', 'error', '字段配置缺少 fieldCode', [path]));
      continue;
    }

    const duplicates = fields.filter((candidate) => candidate.areaCode === areaCode && candidate.fieldCode === fieldCode);
    if (duplicates.length > 1 && duplicates[0]?.path === path) {
      results.push(issue(
        'FIELD_DUPLICATE_IN_AREA',
        'field-config',
        'error',
        `区域 ${areaCode} 中字段 ${fieldCode} 重复`,
        duplicates.map(({ path: duplicatePath }) => `${duplicatePath}.fieldCode`),
      ));
    }

    const areaRows = getByPath(snapshot.runtime.rawBillData, areaCode);
    if (Array.isArray(areaRows) && areaRows.length > 0) {
      const exists = areaRows.some((row) => asRecord(row) && Object.hasOwn(row, fieldCode));
      if (!exists) {
        results.push(issue(
          'FIELD_RUNTIME_PATH_MISSING',
          'field-config',
          'warning',
          `字段 ${identity} 在运行时数据中不存在`,
          [`${path}.fieldCode`, `runtime.rawBillData.${areaCode}`],
        ));
      }
    }

    for (const key of PARSEABLE_KEYS) {
      if (!(key in field) || field[key] === '' || field[key] === undefined) continue;
      const parsed = parseMaybeJson(field[key]);
      if (parsed.error) {
        const ruleId = DYNAMIC_KEYS.includes(key)
          ? 'FIELD_DYNAMIC_CONFIG_INVALID'
          : COMPUTE_KEYS.includes(key)
            ? 'FIELD_COMPUTE_CONFIG_INVALID'
            : key === 'trans'
              ? 'FIELD_TRANS_INVALID'
              : ['relateScheme', 'dataMappingConfig'].includes(key)
                ? 'FIELD_RELATION_CONFIG_INVALID'
                : 'FIELD_CONFIG_PARSE_ERROR';
        results.push(issue(
          ruleId,
          'field-config',
          'error',
          `字段 ${identity} 的 ${key} 配置不是有效 JSON`,
          [`${path}.${key}`],
          { actual: jsonValue(field[key]), reason: parsed.error },
        ));
      }
    }

    if (typeof field.warning === 'string' && field.warning !== '') {
      const warningPath = `${path}.warning`;
      if (!warningRules) {
        results.push(skipped(
          'FIELD_WARNING_RULE_MISSING',
          'field-config',
          `字段 ${identity} 的警告规则 ${field.warning} 未验证：未采集宿主 warning 规则表`,
          [warningPath],
        ));
      } else if (!warningRules.has(field.warning)) {
        results.push(issue(
          'FIELD_WARNING_RULE_MISSING',
          'field-config',
          'error',
          `字段 ${identity}（${String(field.fieldName ?? field.label ?? fieldCode)}）引用了不存在的警告规则 ${field.warning}`,
          [warningPath, 'config.warningRuleNames'],
          {
            actual: field.warning,
            expected: [...warningRules],
            reason: '字段 warning 必须引用宿主项目已注册的警告规则；字段编码本身不代表规则已注册。',
            suggestion: `检查 ${identity} 的 warning 配置，改为项目已注册的规则名；不需要警告时清空该配置。`,
          },
        ));
      }
    }

    const runtimeState = snapshot.config.fieldRuntimeStates?.find((state) => (
      state.areaCode === areaCode && state.fieldCode === fieldCode && state.rowIndex === 0
    ));
    if (runtimeState?.evaluationError) {
      results.push(issue(
        'FIELD_DYNAMIC_CONFIG_INVALID',
        'field-config',
        'warning',
        `字段 ${identity} 的动态配置计算失败`,
        ['config.fieldRuntimeStates'],
        { reason: runtimeState.evaluationError },
      ));
    }
    const runtimeStateAvailable = snapshot.meta.compatibility?.fieldRuntime !== 'unavailable';
    const required = runtimeState?.required
      ?? (runtimeStateAvailable
        ? booleanValue(field._requireFlag)
          ?? booleanValue(field.require)
          ?? booleanValue(field.required)
        : undefined);
    const visible = runtimeState?.visible
      ?? (runtimeStateAvailable
        ? booleanValue(field._showFlag)
          ?? booleanValue(field.currentShow)
          ?? booleanValue(field.isShow)
        : undefined);
    const editable = runtimeState?.editable
      ?? (runtimeStateAvailable
        ? booleanValue(field._editFlag)
          ?? booleanValue(field.currentEdit)
          ?? booleanValue(field.editable)
          ?? booleanValue(field.isEdit)
        : undefined);
    const currentValue = runtimeState?.value ?? fieldValue(snapshot, areaCode, fieldCode);
    if (required === true && visible === false) {
      results.push(issue(
        'FIELD_REQUIRED_HIDDEN',
        'field-config',
        'error',
        `必填字段 ${identity} 当前被隐藏`,
        [path, `runtime.rawBillData.${areaCode}.0.${fieldCode}`],
      ));
    }
    if (required === true && editable === false && isEmpty(currentValue) && isEmpty(field.defaultValue)) {
      results.push(issue(
        'FIELD_REQUIRED_READONLY_EMPTY',
        'field-config',
        'error',
        `必填字段 ${identity} 不可编辑且没有值`,
        [path, `runtime.rawBillData.${areaCode}.0.${fieldCode}`],
      ));
    }

    const expectedType = expectedRuntimeType(field.fieldType);
    if (expectedType && !isEmpty(currentValue) && actualType(currentValue) !== expectedType) {
      results.push(issue(
        'FIELD_RUNTIME_TYPE_MISMATCH',
        'field-config',
        'warning',
        `字段 ${identity} 的运行时值类型与控件类型不一致`,
        [`${path}.fieldType`, `runtime.rawBillData.${areaCode}.0.${fieldCode}`],
        { expected: expectedType, actual: actualType(currentValue) },
      ));
    }

    for (const key of DYNAMIC_KEYS) {
      if (!field[key]) continue;
      for (const reference of extractReferenceTokens(field[key], areaCode)) {
        if (!knownFields.has(reference)) {
          results.push(issue(
            'FIELD_DYNAMIC_REFERENCE_MISSING',
            'field-config',
            'error',
            `字段 ${identity} 的动态配置引用了不存在的字段 ${reference}`,
            [`${path}.${key}`],
          ));
        }
      }
    }

    for (const key of COMPUTE_KEYS) {
      if (!field[key]) continue;
      const dependencies = new Set(extractReferenceTokens(field[key], areaCode));
      computeGraph.set(identity, dependencies);
      for (const reference of dependencies) {
        if (!knownFields.has(reference)) {
          results.push(issue(
            'FIELD_COMPUTE_REFERENCE_MISSING',
            'field-config',
            'error',
            `字段 ${identity} 的计算配置引用了不存在的字段 ${reference}`,
            [`${path}.${key}`],
          ));
        }
      }
    }

    const dataSourceType = field.dataSourceType;
    const hasDataSource = !isEmpty(dataSourceType) || !isEmpty(field.service) || !isEmpty(field.requestUrl);
    const hasLovKey = typeof field.lovKey === 'string' && field.lovKey.trim() !== '';
    // select 从 options、ajax 或 fastCode 获取选项，不要求提供 LOV 配置。
    if (field.fieldType !== 'select' && hasDataSource && !hasLovKey && isEmpty(field.config) && isEmpty(field.staticConfig) && isEmpty(field.requestUrl) && isEmpty(field.service)) {
      results.push(issue(
        'FIELD_DATASOURCE_INCOMPLETE',
        'field-config',
        'warning',
        `字段 ${identity} 配置了数据源类型 ${String(dataSourceType)}，但快照中未发现数据源配置`,
        ['dataSourceType', 'lovKey', 'config', 'staticConfig', 'requestUrl', 'service'].map((key) => `${path}.${key}`),
        {
          reason: '当前字段未配置非空 lovKey，且 config、staticConfig、requestUrl、service 均为空。请检查该字段的数据源设置；若选项由组件默认值或运行时逻辑提供，需结合实际选项加载情况确认，不能仅据此认定数据源失效。',
          actual: jsonValue(dataSourceType),
        },
      ));
    }
    if (['multi-table', 'table'].includes(String(field.fieldType)) && !field.rowKey) {
      results.push(skipped(
        'FIELD_ROW_KEY_MISSING',
        'field-config',
        `字段 ${identity} 未显式配置 rowKey，BOE 默认使用 fieldCode（${fieldCode}）；快照不含数据源原始响应，无法确认返回行是否包含该键`,
        [`${path}.rowKey`, `${path}.fieldCode`, `${path}.fieldType`],
      ));
    }
    for (const key of ['config', 'staticConfig']) {
      const parsed = parseMaybeJson(field[key]);
      if (field[key] && parsed.error) {
        results.push(issue(
          'FIELD_DATASOURCE_CONFIG_INVALID',
          'field-config',
          'error',
          `字段 ${identity} 的 ${key} 数据源配置无效`,
          [`${path}.${key}`],
          { reason: parsed.error },
        ));
      }
    }

    if (field.trans) {
      const entries = transEntries(field.trans);
      if (!entries) {
        results.push(issue('FIELD_TRANS_INVALID', 'field-config', 'error', `字段 ${identity} 的 trans 格式无法识别`, [`${path}.trans`]));
      } else {
        const targets = new Map<string, number>();
        for (const entry of entries) {
          if (!entry.to) {
            results.push(issue('FIELD_TRANS_TARGET_MISSING', 'field-config', 'error', `字段 ${identity} 的 trans 条目缺少 to`, [`${path}.trans`]));
            continue;
          }
          targets.set(entry.to, (targets.get(entry.to) ?? 0) + 1);
        }
        for (const [target, count] of targets) {
          if (count > 1) {
            results.push(issue('FIELD_TRANS_TARGET_CONFLICT', 'field-config', 'warning', `字段 ${identity} 有 ${count} 个 trans 源写入 ${target}`, [`${path}.trans`]));
          }
        }
      }
    }

    for (const [key, ruleId] of [['prev', 'FIELD_PREV_REFERENCE_MISSING'], ['nextField', 'FIELD_NEXT_REFERENCE_MISSING']] as const) {
      if (!field[key]) continue;
      for (const reference of extractReferenceTokens(field[key], areaCode)) {
        if (!knownFields.has(reference)) {
          results.push(issue(ruleId, 'field-config', 'error', `字段 ${identity} 的 ${key} 引用了不存在的字段 ${reference}`, [`${path}.${key}`]));
        }
      }
    }

    const cascadeDependencies = new Set<string>();
    if (field.prevField) {
      const reference = String(field.prevField).includes('.') ? String(field.prevField) : `${areaCode}.${field.prevField}`;
      cascadeDependencies.add(reference);
    }
    for (const reference of extractReferenceTokens(field.prev, areaCode)) cascadeDependencies.add(reference);
    if (cascadeDependencies.size > 0) cascadeGraph.set(identity, cascadeDependencies);

    if (field.isCascade && isEmpty(field.prevField) && isEmpty(field.prev)) {
      results.push(issue('FIELD_RELATION_CONFIG_INVALID', 'field-config', 'warning', `级联字段 ${identity} 缺少上级字段配置`, [path]));
    }

    const defaultValue = field.defaultValue ?? field.default;
    const defaultExpectedType = expectedRuntimeType(field.fieldType);
    if (defaultExpectedType && !isEmpty(defaultValue) && actualType(defaultValue) !== defaultExpectedType) {
      results.push(issue(
        'FIELD_DEFAULT_TYPE_MISMATCH',
        'field-config',
        'warning',
        `字段 ${identity} 的默认值类型与控件类型不一致`,
        [`${path}.defaultValue`, `${path}.fieldType`],
        { expected: defaultExpectedType, actual: actualType(defaultValue) },
      ));
    }

    if (field.link && isEmpty(field.linkUrl) && isEmpty(asRecord(field.link)?.url)) {
      results.push(issue('FIELD_LINK_CONFIG_INCOMPLETE', 'field-config', 'warning', `字段 ${identity} 启用了链接但缺少 URL`, [`${path}.link`]));
    }
    if (booleanValue(field.import) === true && (visible === false || editable === false)) {
      results.push(issue('FIELD_IMPORT_CONFIG_CONFLICT', 'field-config', 'warning', `字段 ${identity} 可导入但当前隐藏或不可编辑`, [`${path}.import`]));
    }
    const functionPaths = functionMetadataPaths(field);
    if (functionPaths.length > 0) {
      results.push(issue(
        'FIELD_FUNCTION_UNINSPECTABLE',
        'field-config',
        'info',
        `字段 ${identity} 的 ${functionPaths.join('、')} 包含函数，执行结果尚未验证`,
        functionPaths.map((functionPath) => `${path}.${functionPath}`),
        {
          reason: '快照仅保留函数名称和参数个数，不包含函数实现或执行结果。此提示不表示配置有误；请在业务页面触发对应操作，检查实际结果。Inspector 不会主动执行这些函数。',
          suggestion: '查看证据路径对应的函数配置，并在业务页面验证其实际行为。',
        },
      ));
    }
  }

  const computeCycle = hasCycle(computeGraph);
  if (computeCycle) {
    results.push(issue('FIELD_COMPUTE_CYCLE', 'field-config', 'error', `计算字段存在循环依赖：${computeCycle.join(' → ')}`, ['config.template']));
  }
  const cascadeCycle = hasCycle(cascadeGraph);
  if (cascadeCycle) {
    results.push(issue('FIELD_CASCADE_CYCLE', 'field-config', 'error', `级联字段存在循环依赖：${cascadeCycle.join(' → ')}`, ['config.template']));
  }

  return addPassedResults(results);
}
