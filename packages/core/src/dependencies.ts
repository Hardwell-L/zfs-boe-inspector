import type { BoeInspectionSnapshot, DependencyDetail, JsonValue } from '@zfs-boe-inspector/shared-types';

function object(value: unknown): Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

export function describeDependencies(
  snapshot: BoeInspectionSnapshot,
  references: string[],
  context: { areaCode?: string; rowIndex?: number; category: string; technicalDetail?: JsonValue },
): DependencyDetail[] {
  const detail = object(context.technicalDetail);
  const computed = detail.type === 'computed';
  const formula = typeof detail.formula === 'string' ? detail.formula : '';
  const tokens = computed ? [...formula.matchAll(/\$\{([\w]+\.[\w]+(?::\w+|\.\w+)?)\}/g)].map((match) => match[1]!) : [];
  const refs = [...new Set([...tokens, ...references.filter((ref) => !tokens.some((token) => token.startsWith(`${ref}:`) || token.startsWith(`${ref}.`)))])];
  return refs.map((reference) => {
    const [areaCode = '', fieldCode = ''] = reference.split(/[.:]/);
    const area = object(snapshot.config.template.find((value) => object(value).areaCode === areaCode));
    const field = object((Array.isArray(area.areaFields) ? area.areaFields : []).find((value: unknown) => object(value).fieldCode === fieldCode));
    const rows = object(snapshot.runtime.rawBillData)[areaCode];
    const aggregate = reference.split(/[.:]/).length > 2;
    const singleton = ['boeHeader', 'boeHeaderChild'].includes(areaCode);
    // 只有 computed 的跨区域第 0 行语义已由目标 BOE 实现证实；其他规则展示候选值。
    const exactRow = singleton ? 0 : computed && !aggregate ? (areaCode === context.areaCode ? context.rowIndex ?? 0 : 0) : undefined;
    const indexes = exactRow !== undefined ? [exactRow] : Array.from({ length: Math.min(Array.isArray(rows) ? rows.length : 0, 50) }, (_, index) => index);
    return {
      reference, areaCode, fieldCode,
      areaName: String(area.areaName ?? area.areaLabel ?? areaCode),
      fieldName: String(field.fieldName ?? field.label ?? fieldCode),
      purpose: context.category === 'validation-rule' ? '触发条件或校验内容引用' : context.category === 'dynamic-rule' ? '显示、编辑或必填条件引用' : '计算依赖',
      resolution: aggregate ? '汇总引用：下列为源行值，未采集实际汇总输入' : exactRow !== undefined ? `已解析为第 ${exactRow + 1} 行` : '候选行值：当前快照不足以确认实际执行行',
      values: (indexes.length ? indexes : [0]).map((rowIndex): DependencyDetail['values'][number] => {
        const row = object(Array.isArray(rows) ? rows[rowIndex] : undefined);
        const value = row[fieldCode];
        const marker = object(value).__kind;
        const status: DependencyDetail['values'][number]['status'] = marker === 'truncated' || row.__kind === 'truncated' ? 'truncated'
          : !Array.isArray(rows) || !rows[rowIndex] || marker === 'unreadable' ? 'unavailable'
            : !Object.hasOwn(row, fieldCode) || marker === 'undefined' ? 'missing' : 'value';
        let description = field.labelCode ? row[field.labelCode] : undefined;
        if (description === undefined && Array.isArray(field.options)) {
          const props = object(field.optionProps);
          const option = field.options.find((candidate: unknown) => {
            const item = object(candidate);
            return (item.value ?? item[props.value] ?? item[props.code]) === value;
          });
          description = option?.label ?? option?.[props.label];
        }
        return {
          rowIndex, status,
          ...(status === 'value' ? { value: value as JsonValue } : {}),
          ...(description !== undefined ? { description: description as JsonValue } : {}),
          evidencePath: `runtime.rawBillData.${areaCode}.${rowIndex}.${fieldCode}`,
        };
      }),
      omittedRows: exactRow === undefined && Array.isArray(rows) ? Math.max(0, rows.length - 50) : 0,
    };
  });
}
