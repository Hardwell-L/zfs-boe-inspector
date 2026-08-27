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
