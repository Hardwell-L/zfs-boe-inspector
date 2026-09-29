import { structured, record, displayValue } from './inspectionView';

const supported = new Set(['edit', 'show', 'requireSet', 'prev', 'nextField', 'trans', 'config', 'dataSource', 'formShow', 'formEdit', 'formRequire', 'mainDataConfig', 'popSetting', 'relateAssignment', 'dataSourceRange']);

export function propertyJson(value: unknown): Record<string, unknown> | unknown[] | undefined {
  const parsed = structured(value);
  if (parsed.error || !parsed.value || typeof parsed.value !== 'object') return;
  if (!Object.keys(parsed.value).length || '__kind' in parsed.value) return;
  return parsed.value as Record<string, unknown> | unknown[];
}

export function hasPropertyJson(code: string, value: unknown): boolean {
  return supported.has(code) && propertyJson(value) !== undefined;
}

export function fieldCaption(code: string, areaCode: string, names: Map<string, string>): string {
  const path = code.includes('.') ? code : `${areaCode}.${code}`;
  const name = names.get(path);
  return name ? `${name}（${code}）` : code;
}

export const comparisonLabels: Record<string, string> = {
  '=': '等于', '<>': '不等于', '>': '大于', '<': '小于', '>=': '大于等于', '<=': '小于等于',
  in: '包含', nin: '不包含',
};

// 主数据弹窗的复选框以字符串 0 表示选中、1 表示未选中。
function popupFlag(value: unknown): string {
  if (value === '0') return '是';
  if (value === '1') return '否';
  return value == null ? '未配置' : displayValue(value);
}

export function popupSettingRows(value: unknown) {
  if (!Array.isArray(value) || !value.every((item) => typeof record(item).refFieldCode === 'string')) return;
  return value.map((raw) => {
    const item = record(raw);
    return {
      '所属区域': item.areaName,
      '字段名称': item.fieldName,
      '字段编码': [item.refAreaCode, item.refFieldCode].filter(Boolean).join('.'),
      '字段类型': item.fieldType,
      '列表显示': popupFlag(item.listDisplayFlag),
      '查询条件': popupFlag(item.queryFlag),
      '收藏显示': popupFlag(item.favoriteFlag),
    };
  });
}

export function assignmentRows(value: unknown, areaCode: string, names: Map<string, string>) {
  if (!Array.isArray(value) || !value.every((item) => typeof record(item).refFieldCode === 'string' && typeof record(item).curFieldCode === 'string')) return;
  return value.map((raw) => {
    const item = record(raw);
    const source = [item.refArea, item.refFieldCode].filter(Boolean).join('.');
    const target = [item.curArea || areaCode, item.curFieldCode].join('.');
    const targetName = fieldCaption(target, areaCode, names);
    return {
      '来源字段': item.refFieldName ? `${item.refFieldName}（${source}）` : source,
      '目标字段': targetName === target && item.curFieldName ? `${item.curFieldName}（${target}）` : targetName,
      '目标展示字段': item.curLabelCode || '未配置',
    };
  });
}
