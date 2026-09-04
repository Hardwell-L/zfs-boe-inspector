import type { RuleDiagnosticModel } from '@zfs-boe-inspector/core';
import type { JsonValue } from '@zfs-boe-inspector/shared-types';

function asRecord(value: JsonValue | undefined): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

function hasDisplayRule(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') {
    if (!value.trim()) return false;
    try {
      return hasDisplayRule(JSON.parse(value) as JsonValue);
    } catch {
      // 损坏的非空配置仍需展示，保留诊断入口。
      return true;
    }
  }
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function dynamicDisplayModel(model: RuleDiagnosticModel): RuleDiagnosticModel {
  const entries = model.entries.filter((entry) => {
    if (!entry.fieldCode) return false;
    const rawConfig = asRecord(asRecord(entry.technicalDetail)?.rawConfig);
    return hasDisplayRule(rawConfig?.show) || hasDisplayRule(rawConfig?.formShow);
  });
  const areaCodes = new Set(entries.map(({ areaCode }) => areaCode));
  return {
    ...model,
    entries,
    metrics: {
      total: entries.length,
      issues: entries.filter(({ state }) => state === 'issue').length,
      unverified: entries.filter(({ state }) => state === 'unverified').length,
      locatable: entries.filter(({ areaCode, fieldCode }) => Boolean(areaCode && fieldCode)).length,
    },
    truncatedAreas: model.truncatedAreas.filter(({ areaCode }) => areaCodes.has(areaCode)),
  };
}

function displayText(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && Object.keys(value).length === 0) return '';
  return JSON.stringify(value);
}

export function hasDisplayText(description: JsonValue | undefined, value: JsonValue | undefined): boolean {
  const text = displayText(description);
  return text !== '' && text !== displayText(value);
}
