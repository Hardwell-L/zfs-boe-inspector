import { describe, expect, it } from 'vitest';
import { runInspection } from './index';
import type { BoeInspectionSnapshot } from '@zfs-boe-inspector/shared-types';

function snapshot(): BoeInspectionSnapshot {
  return {
    schemaVersion: 1,
    instanceId: 'CL02:1',
    capturedAt: '2026-08-27T00:00:00.000Z',
    meta: { projectCode: 'demo', environment: 'test', adapterVersion: '0.1.0' },
    runtime: { rawBillData: {} },
    config: { template: [] },
  };
}

describe('runInspection', () => {
  it('汇总 passed、issue 与 skipped', () => {
    const report = runInspection(snapshot(), [() => [
      { ruleId: 'PASS', category: 'field-config', status: 'passed', summary: 'ok', evidencePaths: [] },
      { ruleId: 'ERROR', category: 'field-config', status: 'issue', severity: 'error', summary: 'bad', evidencePaths: [] },
      { ruleId: 'SKIP', category: 'travel-standard', status: 'skipped', summary: 'skip', evidencePaths: [] },
    ]]);
    expect(report.summary).toMatchObject({ passed: 1, issues: 1, skipped: 1, errors: 1 });
  });

  it('拒绝缺少 projectCode 的 Snapshot', () => {
    const invalid = snapshot();
    invalid.meta.projectCode = '';
    expect(() => runInspection(invalid, [])).toThrow('projectCode');
  });
});
