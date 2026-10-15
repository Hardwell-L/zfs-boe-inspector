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

describe('多人差旅规则', () => {
  it('同日人员隔离，并允许方案结果复用而没有当日请求缓存', () => {
    const snapshot = createSnapshot();
    snapshot.travel = {
      mode: 'multi', collection: { status: 'complete', reasons: [] },
      persons: ['E1', 'E2'].map((id) => ({
        key: id, person: { employeeId: id }, collection: { status: 'complete', reasons: [] },
        data: {
          requestEvidence: 'cache', calendarData: [{ expenseDate: '2026-10-02', travelSite: '武汉' }],
          standardRequests: [{ boeDate: '2026-10-01' }],
          standardResults: { '武汉_2026-10-02': [{ standardAmount: 100 }] },
          travelerNames: [id], claimantNames: ['报账人'],
        },
      })),
    };
    const results = evaluateTravelRules(snapshot);
    expect(results.filter((item) => item.status === 'issue')).toEqual([]);
    expect(results.filter((item) => item.ruleId === 'TRAVEL_STANDARD_DATE_MISMATCH').every((item) => item.status === 'skipped')).toBe(true);
    expect(results.some((item) => item.evidencePaths.some((path) => path.startsWith('travel.persons.1.data')))).toBe(true);
  });

  it('不完整人员不会产生通过或确定性问题', () => {
    const snapshot = createSnapshot();
    snapshot.travel = { mode: 'multi', persons: [{
      key: 'E1', person: { employeeId: 'E1' }, data: {}, collection: { status: 'partial', reasons: ['预算截断'] },
    }], collection: { status: 'partial', reasons: [] } };
    expect(evaluateTravelRules(snapshot).every((item) => item.status === 'skipped')).toBe(true);
  });
});
