import { describe, expect, it } from 'vitest';
import { toSerializable } from './serialize';

describe('toSerializable', () => {
  it('安全处理循环引用、function 与 Promise', () => {
    const source: Record<string, unknown> = {
      handler() {},
      pending: Promise.resolve(1),
    };
    source.self = source;
    const result = toSerializable(source) as Record<string, any>;
    expect(result.handler.__kind).toBe('function');
    expect(result.pending.__kind).toBe('promise');
    expect(result.self.__kind).toBe('circular');
  });

  it('捕获 getter 读取异常', () => {
    const source = Object.defineProperty({}, 'broken', {
      enumerable: true,
      get() { throw new Error('boom'); },
    });
    const result = toSerializable(source) as Record<string, any>;
    expect(result.broken).toMatchObject({ __kind: 'unreadable', message: 'boom' });
  });
});

describe('序列化采集预算', () => {
  it('总节点预算限制深层宽对象的遍历，达到上限后不再触发 getter', () => {
    let reads = 0;
    const make = (depth: number): object => Object.fromEntries(Array.from({ length: 20 }, (_, i) => [i, depth ? make(depth - 1) : { get value() { reads += 1; return 1; } }]));
    const result = toSerializable(make(2), { maxNodes: 80, maxDepth: 8, maxObjectKeys: 50 });
    expect(reads).toBeLessThan(80);
    expect(JSON.stringify(result)).toContain('max-nodes');
    expect(JSON.stringify(result).length).toBeLessThan(10000);
  });

  it('长字符串及累计字符预算不保留无界文本', () => {
    const result = toSerializable({ a: 'a'.repeat(100000), b: 'b'.repeat(100000) }, { maxStringLength: 50, maxTotalStringLength: 60 });
    expect(JSON.stringify(result)).toContain('max-string-length');
    expect(JSON.stringify(result).length).toBeLessThan(400);
  });

  it('异常元数据也遵守文本预算', () => {
    const result = toSerializable(new Error('x'.repeat(100000)), { maxStringLength: 50, maxTotalStringLength: 60 });
    expect(JSON.stringify(result)).toContain('max-string-length');
    expect(JSON.stringify(result).length).toBeLessThan(250);
  });

  it('Map 和 Set 按上限迭代，保留原有元数据形状', () => {
    expect(toSerializable(new Map([['a', 1], ['b', 2]]), { maxArrayLength: 1 })).toEqual({ __kind: 'map', entries: [['a', 1]] });
    expect(toSerializable(new Set([1, 2]), { maxArrayLength: 1 })).toEqual({ __kind: 'set', values: [1] });
  });
});
