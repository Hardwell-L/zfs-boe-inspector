import type { JsonValue } from '@zfs-boe-inspector/shared-types';
import type { SerializeOptions } from './serialize';

export interface SerializeBudget {
  nodes: number;
  characters: number;
  deadline: number;
  reasons: Set<string>;
}

export interface MultiSerializeOptions extends SerializeOptions {
  budget: SerializeBudget;
}

export function serializeMultiTravelValue(input: unknown, options: MultiSerializeOptions): JsonValue {
  const maxDepth = options.maxDepth ?? 40;
  const maxArrayLength = options.maxArrayLength ?? 10_000;
  const maxObjectKeys = options.maxObjectKeys ?? 10_000;
  const maxNodes = options.maxNodes ?? Infinity;
  const maxStringLength = options.maxStringLength ?? Infinity;
  const maxTotalStringLength = options.maxTotalStringLength ?? Infinity;
  const budget = options.budget;
  let nodes = budget.nodes;
  let characters = budget.characters;
  const mark = (reason: string) => { budget.reasons.add(reason); return { __kind: 'truncated', reason }; };
  const expired = () => performance.now() >= budget.deadline;
  let halted = false;
  const budgetMarker = () => mark(halted ? 'time-budget' : 'max-nodes');
  const seen = new WeakMap<object, string>();

  const text = (value: string): JsonValue => {
    const length = Math.max(0, Math.min(maxStringLength, maxTotalStringLength - characters));
    characters += Math.min(value.length, length);
    if (value.length > length) budget.reasons.add('max-string-length');
    return value.length > length ? { __kind: 'truncated', reason: 'max-string-length', preview: value.slice(0, length), originalLength: value.length } : value;
  };
  const visitValue = (value: unknown, path: string, depth: number): JsonValue => {
    if (nodes >= maxNodes || halted) return budgetMarker();
    nodes += 1;
    if (typeof value === 'string') return text(value);
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'bigint') return { __kind: 'bigint', value: text(value.toString()) };
    if (typeof value === 'undefined') return { __kind: 'undefined' };
    if (typeof value === 'symbol') return { __kind: 'symbol', description: text(value.description ?? '') };
    if (typeof value === 'function') {
      return { __kind: 'function', name: text(value.name || 'anonymous'), length: value.length };
    }
    if (depth > maxDepth) return { ...mark('max-depth'), path };
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { __kind: 'error', name: text(value.name), message: text(value.message) };
    if (value instanceof Promise) return { __kind: 'promise', status: 'unknown' };
    if (typeof value !== 'object') return String(value);

    const previousPath = seen.get(value);
    if (previousPath) {
      budget.reasons.add('circular');
      return { __kind: 'circular', reference: previousPath };
    }
    seen.set(value, path);
    try {
      if (Array.isArray(value)) {
        const result: JsonValue[] = [];
        for (let index = 0; index < Math.min(value.length, maxArrayLength); index += 1) {
          if (nodes >= maxNodes || halted) { result.push(budgetMarker()); break; }
          result.push(visit(value[index], `${path}.${index}`, depth + 1));
        }
        if (value.length > maxArrayLength) {
          result.push({ ...mark('max-array-length'), omitted: value.length - maxArrayLength });
        }
        return result;
      }
      if (value instanceof Map) {
        const entries: JsonValue[] = [];
        for (const [key, item] of value) {
          if (entries.length >= maxArrayLength) { budget.reasons.add('max-array-length'); break; }
          if (nodes >= maxNodes || halted) { entries.push(budgetMarker()); break; }
          entries.push([visit(key, `${path}.key${entries.length}`, depth + 1), visit(item, `${path}.value${entries.length}`, depth + 1)]);
        }
        return { __kind: 'map', entries };
      }
      if (value instanceof Set) {
        const values: JsonValue[] = [];
        for (const item of value) {
          if (values.length >= maxArrayLength) { budget.reasons.add('max-array-length'); break; }
          if (nodes >= maxNodes || halted) { values.push(budgetMarker()); break; }
          values.push(visit(item, `${path}.${values.length}`, depth + 1));
        }
        return { __kind: 'set', values };
      }

      const result: Record<string, JsonValue> = {};
      let count = 0;
      for (const key in value) {
        if (!Object.hasOwn(value, key)) continue;
        if (count >= maxObjectKeys || nodes >= maxNodes || halted || key.length > maxStringLength || characters + key.length > maxTotalStringLength) {
          result.__truncated__ = mark(halted ? 'time-budget' : nodes >= maxNodes ? 'max-nodes' : count >= maxObjectKeys ? 'max-object-keys' : 'max-string-length');
          break;
        }
        count += 1;
        characters += key.length;
        try {
          result[key] = visit((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
        } catch (error) {
          budget.reasons.add('unreadable');
          result[key] = { __kind: 'unreadable', message: text(error instanceof Error ? error.message : String(error)) };
        }
      }
      return result;
    } finally {
      if (options.expandSharedReferences) seen.delete(value);
    }
  };

  // 多人专用遍历保持独立，避免给原有单人序列化热路径增加计时和共享计数开销。
  const visit = (value: unknown, path: string, depth: number): JsonValue => {
    if (expired()) { halted = true; return budgetMarker(); }
    try { return visitValue(value, path, depth); }
    finally { if (expired()) halted = true; }
  };
  try { return visit(input, '$', 0); }
  finally {
    budget.nodes = nodes;
    budget.characters = characters;
  }
}
