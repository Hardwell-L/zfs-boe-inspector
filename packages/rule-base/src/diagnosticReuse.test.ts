import { expect, it } from 'vitest';
import { buildRuleDiagnostics, runInspection } from '@zfs-boe-inspector/core';
import type { BoeInspectionSnapshot } from '@zfs-boe-inspector/shared-types';
import { baseRuleEvaluators, diagnosticEvaluators, evaluateFieldRules, evaluateTravelRules } from './index';

it.each([false, true])('复用诊断维持报告条目和顺序，legacy=%s', (legacy) => {
  const snapshot: BoeInspectionSnapshot = {
    schemaVersion: 1, instanceId: 'test', capturedAt: '',
    meta: { projectCode: 'test', environment: 'test', adapterVersion: 'test' },
    runtime: { rawBillData: { detail: [{ amount: 2 }, { amount: 3 }] } },
    config: { template: [{ areaCode: 'detail', areaFields: [{ fieldCode: 'amount', show: '{broken' }] }],
      ...(legacy ? {} : { fieldRuntimeStates: [{ areaCode: 'detail', fieldCode: 'amount', rowIndex: 0, visible: true }] }) },
  };
  const original = runInspection(snapshot, baseRuleEvaluators);
  const diagnostics = buildRuleDiagnostics(snapshot);
  const reused = runInspection(snapshot, [evaluateFieldRules, evaluateTravelRules, ...diagnosticEvaluators(diagnostics)]);
  expect(reused.evaluations).toEqual(original.evaluations);
  expect(reused.summary).toEqual(original.summary);
});
