import type {
  BoeInspectionSnapshot,
  JsonValue,
  RuleCategory,
  RuleEvaluation,
  RuleSeverity,
} from '@zfs-boe-inspector/shared-types';

export interface FieldRecord {
  area: Record<string, any>;
  areaIndex: number;
  field: Record<string, any>;
  fieldIndex: number;
  areaCode: string;
  fieldCode: string;
  path: string;
}

export function asRecord(value: unknown): Record<string, any> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, any>
    : undefined;
}

export function collectFields(snapshot: BoeInspectionSnapshot): FieldRecord[] {
  const fields: FieldRecord[] = [];
  snapshot.config.template.forEach((areaValue, areaIndex) => {
    const area = asRecord(areaValue);
    if (!area) return;
    const areaCode = String(area.areaCode ?? '');
    const areaFields = Array.isArray(area.areaFields) ? area.areaFields : [];
    areaFields.forEach((fieldValue: unknown, fieldIndex: number) => {
      const field = asRecord(fieldValue);
      if (!field) return;
      const fieldCode = String(field.fieldCode ?? '');
      fields.push({
        area,
        areaIndex,
        field,
        fieldIndex,
        areaCode,
        fieldCode,
        path: `config.template.${areaIndex}.areaFields.${fieldIndex}`,
      });
    });
  });
  return fields;
}

export function issue(
  ruleId: string,
  category: RuleCategory,
  severity: RuleSeverity,
  summary: string,
  evidencePaths: string[],
  extra: Partial<RuleEvaluation> = {},
): RuleEvaluation {
  return {
    ruleId,
    category,
    status: 'issue',
    severity,
    summary,
    evidencePaths,
    ...extra,
  };
}

export function passed(ruleId: string, category: RuleCategory, summary: string): RuleEvaluation {
  return { ruleId, category, status: 'passed', summary, evidencePaths: [] };
}

export function skipped(
  ruleId: string,
  category: RuleCategory,
  summary: string,
  evidencePaths: string[] = [],
): RuleEvaluation {
  return { ruleId, category, status: 'skipped', summary, evidencePaths };
}

export function jsonValue(value: unknown): JsonValue {
  if (value === undefined) return null;
  return value as JsonValue;
}

export function extractReferenceTokens(input: unknown, currentArea: string): string[] {
  const text = typeof input === 'string' ? input : JSON.stringify(input ?? '');
  if (!text) return [];
  const references = new Set<string>();
  const dotted = /\$\{([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\}/g;
  for (const match of text.matchAll(dotted)) references.add(`${match[1]}.${match[2]}`);
  const formula = /\$\{([A-Za-z0-9_]+)#(?:value|number|string|date|boolean)[^}]*\}/g;
  for (const match of text.matchAll(formula)) references.add(`${currentArea}.${match[1]}`);
  const objectCodes = /"(?:fieldCode|field|sourceField|targetField|prevField)"\s*:\s*"([A-Za-z0-9_.]+)"/g;
  for (const match of text.matchAll(objectCodes)) {
    const reference = match[1] ?? '';
    references.add(reference.includes('.') ? reference : `${currentArea}.${reference}`);
  }
  return [...references];
}

export function parseMaybeJson(value: unknown): { value: unknown; error?: string } {
  if (typeof value !== 'string' || !value.trim()) return { value };
  const trimmed = value.trim();
  if (!['{', '['].includes(trimmed[0] ?? '')) return { value };
  try {
    return { value: JSON.parse(trimmed) };
  } catch (error) {
    return {
      value,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function hasCycle(graph: Map<string, Set<string>>): string[] | undefined {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const visit = (node: string): string[] | undefined => {
    if (visiting.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (visited.has(node)) return undefined;
    visiting.add(node);
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    visiting.delete(node);
    visited.add(node);
    return undefined;
  };
  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return undefined;
}
