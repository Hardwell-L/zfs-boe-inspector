import { afterEach, describe, expect, it, vi } from 'vitest';
import { serializeMultiTravelValue, type SerializeBudget } from './multiSerialize';
import { toSerializable } from './serialize';

const budget = (): SerializeBudget => ({ nodes: 0, characters: 0, deadline: Infinity, reasons: new Set() });
afterEach(() => { vi.restoreAllMocks(); });

describe('多人专用有界序列化', () => {
  it('未触及预算时保持通用序列化的输出语义', () => {
    const shared = { amount: 100, date: new Date('2026-10-01T00:00:00Z') };
    const input: Record<string, unknown> = { a: shared, b: shared, items: [null, undefined, Infinity, true], map: new Map([['x', 1]]), set: new Set([2]) };
    input.self = input;
    const options = { expandSharedReferences: true };
    expect(serializeMultiTravelValue(input, { ...options, budget: budget() })).toEqual(toSerializable(input, options));
  });

  it('多次序列化共享节点计数，用尽后不读取下一对象的 getter', () => {
    const sharedBudget = budget();
    const options = { budget: sharedBudget, maxNodes: 4 };
    serializeMultiTravelValue({ a: 1 }, options);
    serializeMultiTravelValue({ b: 2 }, options);
    const read = vi.fn(() => 3);
    const input = Object.defineProperty({}, 'c', { enumerable: true, get: read });
    expect(serializeMultiTravelValue(input, options)).toMatchObject({ __kind: 'truncated' });
    expect(read).not.toHaveBeenCalled();
    expect(sharedBudget.nodes).toBe(4);
  });

  it('前一个属性耗尽时间预算后，不再访问下一属性', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const next = vi.fn(() => 2);
    const input = Object.defineProperties({}, {
      slow: { enumerable: true, get() { vi.mocked(performance.now).mockReturnValue(20); return 1; } },
      next: { enumerable: true, get: next },
    });
    const sharedBudget = { ...budget(), deadline: 16 };
    serializeMultiTravelValue(input, { budget: sharedBudget });
    expect(next).not.toHaveBeenCalled();
    expect(sharedBudget.reasons.has('time-budget')).toBe(true);
  });
});
