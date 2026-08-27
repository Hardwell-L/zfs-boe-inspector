import { describe, expect, it } from 'vitest';
import type { BoeInspectionSnapshot } from '@zfs-boe-inspector/shared-types';
import { evaluateTravelRules } from './travelRules';

function createSnapshot(): BoeInspectionSnapshot {
  return {
    schemaVersion: 1,
    instanceId: 'CL02:1',
    capturedAt: '2026-08-27T00:00:00.000Z',
    meta: { projectCode: 'demo', environment: 'test', adapterVersion: '0.1.0' },
    runtime: { rawBillData: {} },
    config: { template: [] },
  };
}

describe('差旅规则', () => {
  it('没有 Travel Collector 时全部跳过', () => {
    const results = evaluateTravelRules(createSnapshot());
    expect(results.length).toBeGreaterThan(0);
    expect(results.every(({ status }) => status === 'skipped')).toBe(true);
  });

  it('识别缺少标准结果与汇总不一致', () => {
    const snapshot = createSnapshot();
    snapshot.travel = {
      calendarData: [{ boeDate: '2026-08-01', travelSite: '武汉' }],
      standardRequests: [{ boeDate: '2026-08-01', status: 'unknown' }],
      standardDates: ['2026-08-01'],
      standardResults: {},
      standardSummary: {
        total: 120,
        controlType: 'ALLOW',
        daily: [{ amount: 100, controlType: 'WARNING' }],
      },
    };
    const issueIds = evaluateTravelRules(snapshot).filter(({ status }) => status === 'issue').map(({ ruleId }) => ruleId);
    expect(issueIds).toContain('TRAVEL_STANDARD_RESULT_MISSING');
    expect(issueIds).toContain('TRAVEL_STANDARD_SUMMARY_MISMATCH');
    expect(issueIds).toContain('TRAVEL_CONTROL_AGGREGATE_MISMATCH');
  });
});
