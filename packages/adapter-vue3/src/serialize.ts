import type { JsonValue } from '@zfs-boe-inspector/shared-types';

export interface SerializeOptions {
  maxDepth?: number;
  maxArrayLength?: number;
  maxObjectKeys?: number;
}

export function toSerializable(input: unknown, options: SerializeOptions = {}): JsonValue {
  const maxDepth = options.maxDepth ?? 40;
  const maxArrayLength = options.maxArrayLength ?? 10_000;
  const maxObjectKeys = options.maxObjectKeys ?? 10_000;
  const seen = new WeakMap<object, string>();

  const visit = (value: unknown, path: string, depth: number): JsonValue => {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
    if (typeof value === 'bigint') return { __kind: 'bigint', value: value.toString() };
    if (typeof value === 'undefined') return { __kind: 'undefined' };
    if (typeof value === 'symbol') return { __kind: 'symbol', description: value.description ?? '' };
    if (typeof value === 'function') {
      return { __kind: 'function', name: value.name || 'anonymous', length: value.length };
    }
    if (depth > maxDepth) return { __kind: 'truncated', reason: 'max-depth', path };
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) return { __kind: 'error', name: value.name, message: value.message };
    if (value instanceof Promise) return { __kind: 'promise', status: 'unknown' };
    if (typeof value !== 'object') return String(value);

    const previousPath = seen.get(value);
    if (previousPath) return { __kind: 'circular', reference: previousPath };
    seen.set(value, path);

    if (Array.isArray(value)) {
      const result = value.slice(0, maxArrayLength).map((item, index) => visit(item, `${path}.${index}`, depth + 1));
      if (value.length > maxArrayLength) {
        result.push({ __kind: 'truncated', reason: 'max-array-length', omitted: value.length - maxArrayLength });
      }
      return result;
    }
    if (value instanceof Map) {
      return {
        __kind: 'map',
        entries: [...value.entries()].slice(0, maxArrayLength)
          .map(([key, item], index) => [visit(key, `${path}.key${index}`, depth + 1), visit(item, `${path}.value${index}`, depth + 1)]),
      };
    }
    if (value instanceof Set) {
      return {
        __kind: 'set',
        values: [...value.values()].slice(0, maxArrayLength)
          .map((item, index) => visit(item, `${path}.${index}`, depth + 1)),
      };
    }

    const result: Record<string, JsonValue> = {};
    const keys = Object.keys(value).slice(0, maxObjectKeys);
    for (const key of keys) {
      try {
        result[key] = visit((value as Record<string, unknown>)[key], `${path}.${key}`, depth + 1);
      } catch (error) {
        result[key] = {
          __kind: 'unreadable',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
    if (Object.keys(value).length > maxObjectKeys) {
      result.__truncated__ = { __kind: 'truncated', reason: 'max-object-keys' };
    }
    return result;
  };

  return visit(input, '$', 0);
}
