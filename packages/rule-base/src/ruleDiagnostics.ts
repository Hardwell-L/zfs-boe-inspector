import {
  buildApplyBoeDiagnostics,
  buildCalculationDiagnostics,
  buildDynamicDiagnostics,
  buildValidationDiagnostics,
  type RuleDiagnosticModel,
} from '@zfs-boe-inspector/core';
import type { BoeInspectionSnapshot, RuleEvaluation } from '@zfs-boe-inspector/shared-types';
import { issue, jsonValue, passed, skipped } from './helpers';

function evaluate(model: RuleDiagnosticModel): RuleEvaluation[] {
  const results = model.entries.flatMap((entry): RuleEvaluation[] => {
    if (entry.state === 'issue') {
      return [issue(
        entry.id,
        entry.category,
        entry.severity ?? 'error',
        entry.summary,
        entry.evidencePaths,
        {
          reason: entry.detail,
          ...(entry.technicalDetail === undefined ? {} : { actual: jsonValue(entry.technicalDetail) }),
          suggestion: entry.areaCode && entry.fieldCode
            ? `在字段配置中检查 ${entry.areaCode}.${entry.fieldCode}`
            : '检查技术详情中的原始配置和证据路径。',
        },
      )];
    }
    if (entry.state === 'unverified') {
      return [skipped(entry.id, entry.category, `${entry.summary}：${entry.detail}`, entry.evidencePaths)];
    }
    return [];
  });
  if (results.some(({ status }) => status === 'issue')) return results;
  results.unshift(passed(`${model.category.toUpperCase().replaceAll('-', '_')}_CONFIG_VALID`, model.category, `${model.title}未发现确定性配置问题`));
  return results;
}

export function evaluateValidationRules(snapshot: BoeInspectionSnapshot): RuleEvaluation[] {
  return evaluate(buildValidationDiagnostics(snapshot));
}

export function evaluateCalculationRules(snapshot: BoeInspectionSnapshot): RuleEvaluation[] {
  return evaluate(buildCalculationDiagnostics(snapshot));
}

export function evaluateDynamicRules(snapshot: BoeInspectionSnapshot): RuleEvaluation[] {
  return evaluate(buildDynamicDiagnostics(snapshot));
}

export function evaluateApplyBoeRules(snapshot: BoeInspectionSnapshot): RuleEvaluation[] {
  return evaluate(buildApplyBoeDiagnostics(snapshot));
}
