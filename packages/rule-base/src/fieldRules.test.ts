import { describe, expect, it } from 'vitest';
import type { BoeInspectionSnapshot } from '@zfs-boe-inspector/shared-types';
import { evaluateFieldRules } from './fieldRules';

function createSnapshot(): BoeInspectionSnapshot {
  return {
    schemaVersion: 1,
    instanceId: 'CL02:1',
    capturedAt: '2026-08-27T00:00:00.000Z',
    meta: { projectCode: 'demo', environment: 'test', adapterVersion: '0.1.0' },
    runtime: {
      rawBillData: {
        boeHeader: [{ amount: '', source: 'A' }],
      },
    },
    config: {
      template: [{
        areaCode: 'boeHeader',
        areaFields: [
          {
            fieldCode: 'amount',
            fieldType: 'number',
            require: true,
            currentShow: false,
            currentEdit: false,
            computed: '${boeHeader.missing}',
          },
          {
            fieldCode: 'source',
            fieldType: 'multi-table',
            dataSourceType: 'service',
            trans: '[{"from":"code","to":"amount"},{"from":"name","to":"amount"}]',
          },
        ],
      }],
    },
  };
}

describe('字段规则', () => {
  it('识别必填隐藏、空只读、计算引用和 trans 冲突', () => {
    const results = evaluateFieldRules(createSnapshot());
    const issueIds = results.filter(({ status }) => status === 'issue').map(({ ruleId }) => ruleId);
    expect(issueIds).toContain('FIELD_REQUIRED_HIDDEN');
    expect(issueIds).toContain('FIELD_REQUIRED_READONLY_EMPTY');
    expect(issueIds).toContain('FIELD_COMPUTE_REFERENCE_MISSING');
    expect(issueIds).toContain('FIELD_TRANS_TARGET_CONFLICT');
    expect(issueIds).toContain('FIELD_ROW_KEY_MISSING');
  });

  it('无法观察数据源原始响应时标记 skipped', () => {
    const result = evaluateFieldRules(createSnapshot()).find(({ ruleId }) => ruleId === 'FIELD_TRANS_SOURCE_UNVERIFIED');
    expect(result?.status).toBe('skipped');
  });
});
