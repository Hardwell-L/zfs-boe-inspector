import type { BoeInspectionSnapshot, InspectionSelection, JsonValue } from '@zfs-boe-inspector/shared-types';
import { scopeIdentity } from './aiContext';

export function scopeRecord(value: unknown): Record<string, JsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : {};
}

export function scopeAreas(snapshot: BoeInspectionSnapshot) {
  const data = scopeRecord(snapshot.runtime.rawBillData);
  return snapshot.config.template.map((raw) => {
    const area = scopeRecord(raw);
    const code = String(area.areaCode ?? '');
    return {
      code, label: String(area.areaName || area.areaLabel || code),
      rows: Array.isArray(data[code]) ? data[code].map(scopeRecord) : [],
      fields: (Array.isArray(area.areaFields) ? area.areaFields : []).map((rawField) => {
        const field = scopeRecord(rawField);
        const fieldCode = String(field.fieldCode ?? field.code ?? '');
        return { code: fieldCode, label: String(field.fieldName || field.label || fieldCode), labelCode: String(field.labelCode ?? '') };
      }).filter((field) => field.code),
    };
  }).filter((area) => area.code);
}

export function uniqueScopes(scopes: InspectionSelection[]) {
  return [...new Map(scopes.map((scope) => [scopeIdentity(scope), scope])).values()];
}

export function scopeIssues(snapshot: BoeInspectionSnapshot, scopes: InspectionSelection[]) {
  const areas = scopeAreas(snapshot);
  return [...new Set(scopes.flatMap((scope) => {
    if (scope.kind === 'bill') return [];
    const area = areas.find((item) => item.code === scope.areaCode);
    if (!area) return [`区域 ${scope.areaCode} 已不在当前模板中`];
    if (scope.kind === 'field' && !area.fields.some((field) => field.code === scope.fieldCode)) return [`字段 ${scope.areaCode}.${scope.fieldCode} 已不在当前模板中`];
    const rows = scope.kind === 'field' ? [scope.rowIndex] : scope.rowIndexes ?? [];
    return rows.some((row) => !Number.isInteger(row) || row < 0 || row >= Math.max(1, area.rows.length))
      ? [`${area.label} 的所选行已超出当前数据范围，请重新选择`] : [];
  }))];
}
