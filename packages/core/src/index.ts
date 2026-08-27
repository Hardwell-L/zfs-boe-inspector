import {
  SNAPSHOT_SCHEMA_VERSION,
  type BoeInspectionSnapshot,
  type InspectionReport,
  type RuleEvaluation,
} from '@zfs-boe-inspector/shared-types';

export { buildTravelView } from './travelView';
export type { TravelCalendarRow, TravelRequestRow, TravelStandardRow, TravelViewModel } from './travelView';

export type RuleEvaluator = (snapshot: BoeInspectionSnapshot) => RuleEvaluation[];

export function assertSnapshot(snapshot: BoeInspectionSnapshot): void {
  if (snapshot.schemaVersion !== SNAPSHOT_SCHEMA_VERSION) {
    throw new Error(`不支持的 Snapshot 协议版本：${snapshot.schemaVersion}`);
  }
  if (!snapshot.instanceId || !snapshot.meta?.projectCode) {
    throw new Error('Snapshot 缺少 instanceId 或 projectCode');
  }
  if (!Array.isArray(snapshot.config?.template)) {
    throw new Error('Snapshot.config.template 必须是数组');
  }
}

export function runInspection(
  snapshot: BoeInspectionSnapshot,
  evaluators: RuleEvaluator[],
): InspectionReport {
  assertSnapshot(snapshot);
  const evaluations = evaluators.flatMap((evaluate) => evaluate(snapshot));
  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    snapshot,
    evaluations,
    summary: {
      passed: evaluations.filter(({ status }) => status === 'passed').length,
      issues: evaluations.filter(({ status }) => status === 'issue').length,
      skipped: evaluations.filter(({ status }) => status === 'skipped').length,
      errors: evaluations.filter(({ status, severity }) => status === 'issue' && severity === 'error').length,
      warnings: evaluations.filter(({ status, severity }) => status === 'issue' && severity === 'warning').length,
      infos: evaluations.filter(({ status, severity }) => status === 'issue' && severity === 'info').length,
    },
  };
}

export function getByPath(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split('.').reduce<unknown>((current, key) => {
    if (current === null || typeof current !== 'object') return undefined;
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
    return (current as Record<string, unknown>)[key];
  }, value);
}

export function parseConfig(value: unknown): { value?: unknown; error?: string } {
  if (typeof value !== 'string') return { value };
  const trimmed = value.trim();
  if (!trimmed) return { value: undefined };
  if (!['{', '['].includes(trimmed[0] ?? '')) return { value };
  try {
    return { value: JSON.parse(trimmed) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function isEmpty(value: unknown): boolean {
  return value === undefined
    || value === null
    || value === ''
    || (Array.isArray(value) && value.length === 0);
}
