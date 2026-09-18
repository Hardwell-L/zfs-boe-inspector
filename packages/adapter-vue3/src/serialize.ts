import type { JsonValue } from '@zfs-boe-inspector/shared-types';

export interface SerializeOptions {
  maxDepth?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
  maxNodes?: number;
  maxStringLength?: number;
  maxTotalStringLength?: number;
}

export function toSerializable(input: unknown, options: SerializeOptions = {}): JsonValue {
  const maxDepth = options.maxDepth ?? 40;
  const maxArrayLength = options.maxArrayLength ?? 10_000;
  const maxObjectKeys = options.maxObjectKeys ?? 10_000;
  const maxNodes = options.maxNodes ?? Infinity;
  const maxStringLength = options.maxStringLength ?? Infinity;
  const maxTotalStringLength = options.maxTotalStringLength ?? Infinity;
  let nodes = 0;
  let characters = 0;
  const budgetMarker = () => ({ __kind: 'truncated', reason: 'max-nodes' });
  const seen = new WeakMap<object, string>();

  const text = (value: string): JsonValue => {
    const length = Math.max(0, Math.min(maxStringLength, maxTotalStringLength - characters));
    characters += Math.min(value.length, length);
    return value.length > length ? { __kind: 'truncated', reason: 'max-string-length', preview: value.slice(0, length), originalLength: value.length } : value;
  };
  const visit = (value: unknown, path: string, depth: number): JsonValue => {
    if (nodes >= maxNodes) return budgetMarker();
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
    if (depth > maxDepth) return { __kind: 'truncated', reason: 'max-depth', path };
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { __kind: 'error', name: text(value.name), message: text(value.message) };
    if (value instanceof Promise) return { __kind: 'promise', status: 'unknown' };
    if (typeof value !== 'object') return String(value);

    const previousPath = seen.get(value);
    if (previousPath) return { __kind: 'circular', reference: previousPath };
    seen.set(value, path);

    if (Array.isArray(value)) {
      const result: JsonValue[] = [];
      for (let index = 0; index < Math.min(value.length, maxArrayLength); index += 1) {
        if (nodes >= maxNodes) { result.push(budgetMarker()); break; }
        result.push(visit(value[index], `${path}.${index}`, depth + 1));
      }
      if (value.length > maxArrayLength) {
        result.push({ __kind: 'truncated', reason: 'max-array-length', omitted: value.length - maxArrayLength });
      }
      return result;
    }
    if (value instanceof Map) {
      const entries: JsonValue[] = [];
      for (const [key, item] of value) {
        if (entries.length >= maxArrayLength) break;
        if (nodes >= maxNodes) { entries.push(budgetMarker()); break; }
        entries.push([visit(key, `${path}.key${entries.length}`, depth + 1), visit(item, `${path}.value${entries.length}`, depth + 1)]);
      }
      return { __kind: 'map', entries };
    }
    if (value instanceof Set) {
      const values: JsonValue[] = [];
      for (const item of value) {
        if (values.length >= maxArrayLength) break;
        if (nodes >= maxNodes) { values.push(budgetMarker()); break; }
        values.push(visit(item, `${path}.${values.length}`, depth + 1));
      }
      return { __kind: 'set', values };
    }

    const result: Record<string, JsonValue> = {};
    let count = 0;
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue;
      if (count >= maxObjectKeys || nodes >= maxNodes || key.length > maxStringLength || characters + key.length > maxTotalStringLength) {
        result.__truncated__ = { __kind: 'truncated', reason: nodes >= maxNodes ? 'max-nodes' : count >= maxObjectKeys ? 'max-object-keys' : 'max-string-length' };
        break;
      }
      count += 1;
      characters += key.length;
      try {
        result[key] = visit((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
      } catch (error) {
        result[key] = { __kind: 'unreadable', message: text(error instanceof Error ? error.message : String(error)) };
      }
    }
    return result;
  };

  return visit(input, '$', 0);
}
