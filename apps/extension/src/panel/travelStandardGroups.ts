import type { TravelStandardRow } from '@zfs-boe-inspector/core';
import type { JsonValue } from '@zfs-boe-inspector/shared-types';

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
  return JSON.stringify(value);
}

export function dateSummary(dates: string[]): string {
  const unique = [...new Set(dates)].sort();
  const ranges: string[] = [];
  let start = '';
  let end = '';
  const flush = () => { if (start) ranges.push(start === end ? start : `${start} ～ ${end}`); };
  for (const day of unique) {
    const next = /^\d{4}-\d{2}-\d{2}$/.test(day) && /^\d{4}-\d{2}-\d{2}$/.test(end)
      && Date.parse(`${day}T00:00:00Z`) - Date.parse(`${end}T00:00:00Z`) === 86400000;
    if (!next) { flush(); start = day; }
    end = day;
  }
  flush();
  return ranges.join('、');
}

export interface StandardGroup {
  key: string;
  row: TravelStandardRow;
  rows: TravelStandardRow[];
  dates: string;
}

export function groupStandards(rows: TravelStandardRow[]): StandardGroup[] {
  const groups = new Map<string, StandardGroup>();
  rows.forEach((row, index) => {
    // 保留完整原始规则（含币种、方案、优先级和适用条件），只合并缓存日期不同的相同规则。
    const key = row.dataIssue ? `issue:${index}` : JSON.stringify([row.place, canonical(row.raw)]);
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { key, row, rows: [row], dates: '' });
  });
  return [...groups.values()].map((group) => ({ ...group, dates: dateSummary(group.rows.map((row) => row.date)) }));
}
