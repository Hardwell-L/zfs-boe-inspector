import { describe, expect, it } from 'vitest';
import type { BoeInspectionSnapshot } from '@zfs-boe-inspector/shared-types';
import {
  evaluateApplyBoeRules,
  evaluateCalculationRules,
  evaluateDynamicRules,
  evaluateValidationRules,
} from './ruleDiagnostics';

function snapshot(): BoeInspectionSnapshot {
  return {
    schemaVersion: 1,
    instanceId: 'CL02:1',
    capturedAt: '2026-08-27T00:00:00.000Z',
    meta: { projectCode: 'demo', environment: 'test', adapterVersion: '0.2.1' },
    runtime: { rawBillData: { boeHeader: [{}] } },
    config: { template: [{ areaCode: 'boeHeader', validateRules: '[invalid', areaFields: [] }] },
  };
}

describe('四类确定性规则', () => {
  it('只把明确损坏配置记入问题', () => {
    expect(evaluateValidationRules(snapshot()).some(({ status }) => status === 'issue')).toBe(true);
    expect(evaluateCalculationRules(snapshot()).some(({ status }) => status === 'issue')).toBe(false);
    expect(evaluateDynamicRules(snapshot()).some(({ status }) => status === 'issue')).toBe(false);
    expect(evaluateApplyBoeRules(snapshot()).some(({ status }) => status === 'issue')).toBe(false);
  });

  it('无法静态确认计算结果时标记 skipped', () => {
    const value = snapshot();
    (value.config.template[0] as Record<string, any>).areaFields = [{ fieldCode: 'amount', computed: '1 + 1' }];
    expect(evaluateCalculationRules(value).some(({ status }) => status === 'skipped')).toBe(true);
  });
});
