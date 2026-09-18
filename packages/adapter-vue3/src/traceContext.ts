import type { TraceTrigger } from '@zfs-boe-inspector/shared-types';

interface TriggerInput extends Omit<TraceTrigger, 'value'> { value?: unknown }

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 只解读已确认的方法参数，不执行宿主表达式或补造跨行计算结果。 */
export function traceTriggers(method: string, args: unknown[], data: unknown): TriggerInput[] {
  const payload = record(args[0]);
  if (method === 'updateBoeData' && typeof payload.areaCode === 'string') {
    const values = record(payload.value);
    return Object.keys(values).slice(0, 30).map((fieldCode): TriggerInput => {
      const scope = { areaCode: payload.areaCode as string, fieldCode,
        ...(typeof payload.rowIndex === 'number' ? { rowIndex: payload.rowIndex } : {}) };
      try { return { ...scope, value: values[fieldCode], source: 'argument' }; }
      catch { return { ...scope, source: 'unavailable', reason: 'read-error' }; }
    });
  }
  const source = method === 'triggerComputeMixin' ? args[0]
    : ['reCalculate', 'reComputed'].includes(method) ? args[3] : undefined;
  if (typeof source !== 'string') return [];
  const split = source.lastIndexOf('.');
  if (split <= 0 || split === source.length - 1) return [];
  const areaCode = source.slice(0, split);
  const fieldCode = source.slice(split + 1);
  const index = args[1];
  const rowIndex = typeof index === 'number' && Number.isInteger(index) && index >= 0 ? index : undefined;
  const scope = { areaCode, fieldCode, ...(rowIndex === undefined ? {} : { rowIndex }) };
  try {
    if (!data || typeof data !== 'object') return [{ ...scope, source: 'unavailable', reason: 'data-unavailable' }];
    if (rowIndex === undefined) return [{ ...scope, source: 'unavailable', reason: 'invalid-row' }];
    const rows = record(data)[areaCode];
    if (!Array.isArray(rows) || !rows[rowIndex] || typeof rows[rowIndex] !== 'object') return [{ ...scope, source: 'unavailable', reason: 'row-missing' }];
    const row = record(rows[rowIndex]);
    if (!Object.hasOwn(row, fieldCode)) return [{ ...scope, source: 'unavailable', reason: 'field-missing' }];
    return [{ ...scope, value: row[fieldCode], source: 'entry-value' }];
  } catch { return [{ ...scope, source: 'unavailable', reason: 'read-error' }]; }
}
