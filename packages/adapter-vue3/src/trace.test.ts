import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoeInspectionSnapshot } from '@zfs-boe-inspector/shared-types';
import { TraceRecorder } from './trace';
import { traceTriggers } from './traceContext';

const snapshot: BoeInspectionSnapshot = {
  schemaVersion: 1, instanceId: 'bill', capturedAt: '2026-09-18T00:00:00Z',
  meta: { projectCode: 'test', environment: 'test', adapterVersion: 'test' },
  config: { template: [] }, runtime: { rawBillData: {} },
};

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('window', new EventTarget()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('过程触发上下文', () => {
  it('第二个参数是行号，字段值在进入时复制，保留原始返回值和方法恢复', () => {
    const value = { amount: 0 };
    const component = { data: { boeHeaderChild: [{ spare: value }] }, triggerComputeMixin() { value.amount = 99; return 42; } };
    const original = component.triggerComputeMixin;
    const recorder = new TraceRecorder(() => snapshot);
    recorder.start('bill', [{ component, getInstanceId: () => 'bill' }]);
    expect(Reflect.apply(component.triggerComputeMixin, component, ['boeHeaderChild.spare', 0])).toBe(42);
    expect(recorder.get()?.events[0]).toMatchObject({ areaCode: 'boeHeaderChild', fieldCode: 'spare', rowIndex: 0,
      triggers: [{ value: { amount: 0 }, source: 'entry-value' }], status: 'returned' });
    recorder.stop();
    expect(component.triggerComputeMixin).toBe(original);
  });

  it('字段更新保留多个传入值，零、false、空字符串和 null 不丢失', () => {
    const triggers = traceTriggers('updateBoeData', [{ areaCode: 'detail', rowIndex: 2, value: { a: 0, b: false, c: '', d: null } }], {});
    expect(triggers.map((item) => item.value)).toEqual([0, false, '', null]);
    expect(triggers.every((item) => item.rowIndex === 2 && item.source === 'argument')).toBe(true);
  });

  it('计算源与目标区域独立，缺失行不会读取其他行的值', () => {
    expect(traceTriggers('reComputed', ['target', 1, { fieldCode: 'result' }, 'source.amount'], { source: [{ amount: 100 }, { amount: 5 }] }))
      .toEqual([{ areaCode: 'source', fieldCode: 'amount', rowIndex: 1, value: 5, source: 'entry-value' }]);
    expect(traceTriggers('triggerComputeMixin', ['source.amount', 3], { source: [{ amount: 100 }] })[0]).toMatchObject({ source: 'unavailable', rowIndex: 3 });
  });

  it('保持抛出的异常和 Promise 身份，不添加异步处理器', () => {
    const failure = new Error('原始异常');
    const promise = Promise.resolve('done');
    const then = vi.spyOn(promise, 'then');
    const component = { data: {}, reComputed() { throw failure; }, beforeValidateRules() { return promise; } };
    const recorder = new TraceRecorder(() => snapshot);
    recorder.start('bill', [{ component, getInstanceId: () => 'bill' }]);
    expect(() => component.reComputed()).toThrow(failure);
    expect(component.beforeValidateRules()).toBe(promise);
    expect(then).not.toHaveBeenCalled();
    expect(recorder.get()?.events.map((event) => event.status)).toEqual(['threw', 'pending']);
    recorder.stop();
  });
});

describe('增量记录与缺失原因', () => {
  it('按追加偏移读取嵌套事件，结束快照只发一次，新会话重置游标', () => {
    const component = {
      data: { detail: [{ amount: 0 }] },
      triggerComputeMixin() { component.reComputed(); },
      reComputed() {},
    };
    const recorder = new TraceRecorder(() => snapshot);
    recorder.start('bill', [{ component, getInstanceId: () => 'bill' }]);
    const initial = recorder.getUpdate()!;
    expect(initial.reset).toBe(true);
    expect(initial.startSnapshot).toBe(snapshot);
    component.triggerComputeMixin();
    const update = recorder.getUpdate({ sessionId: initial.id, offset: 0 })!;
    expect(update.events.map((event) => event.id)).toEqual(['event-2', 'event-1']);
    expect(update.startSnapshot).toBeUndefined();
    expect(recorder.getUpdate({ sessionId: initial.id, offset: 2 })?.events).toEqual([]);
    recorder.stop();
    const ended = recorder.getUpdate({ sessionId: initial.id, offset: 2 })!;
    expect(ended.endSnapshot).toBe(snapshot);
    expect(ended.active).toBe(false);
    expect(recorder.getUpdate({ sessionId: initial.id, offset: 2, ended: true })?.endSnapshot).toBeUndefined();
    recorder.start('bill', [{ component, getInstanceId: () => 'bill' }]);
    const reset = recorder.getUpdate({ sessionId: initial.id, offset: 2 })!;
    expect(reset.id).not.toBe(initial.id);
    expect(reset.reset).toBe(true);
    expect(reset.eventOffset).toBe(0);
    recorder.clear();
    expect(recorder.getUpdate()).toBeUndefined();
  });

  it('明确区分数据不可用、行号无效、行缺失、字段缺失和 getter 异常', () => {
    const trigger = (data: unknown, row: unknown = 0) => traceTriggers('triggerComputeMixin', ['detail.amount', row], data)[0];
    expect(trigger(undefined)?.reason).toBe('data-unavailable');
    expect(trigger({}, -1)?.reason).toBe('invalid-row');
    expect(trigger({ detail: [] })?.reason).toBe('row-missing');
    expect(trigger({ detail: [{}] })?.reason).toBe('field-missing');
    expect(trigger({ detail: [{ get amount() { throw new Error('denied'); } }] })?.reason).toBe('read-error');
    expect(trigger({ detail: [{ amount: undefined }] })).toMatchObject({ source: 'entry-value', value: undefined });
  });

  it('超过触发字段上限时不读取剩余字段 getter', () => {
    let reads = 0;
    const values = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`field${i}`, i]));
    Object.defineProperty(values, 'extra', { enumerable: true, get() { reads += 1; return 1; } });
    expect(traceTriggers('updateBoeData', [{ areaCode: 'detail', rowIndex: 0, value: values }], {}).length).toBe(30);
    expect(reads).toBe(0);
  });

  it('条件定义按会话去重，事件只保留引用，并能增量读取新定义', () => {
    const component = { data: {}, triggerComputeMixin() {} };
    const recorder = new TraceRecorder(() => snapshot);
    recorder.start('bill', [{
      component,
      getInstanceId: () => 'bill',
      getTraceConditions: ({ method }) => [{
        definition: { key: 'rule-1', ruleId: 'R1', label: '金额条件', expression: { code: 'amount > 0' } },
        result: method === 'triggerComputeMixin' ? 'matched' : 'unknown',
      }],
    }]);
    component.triggerComputeMixin();
    component.triggerComputeMixin();
    const session = recorder.get()!;
    expect(session.conditionDefinitions).toEqual([{ key: 'rule-1', ruleId: 'R1', label: '金额条件', expression: { code: 'amount > 0' } }]);
    expect(session.events.every((event) => event.conditions?.[0]?.key === 'rule-1')).toBe(true);
    expect(recorder.getUpdate({ sessionId: session.id, offset: 1 })?.conditionDefinitions).toEqual([{ key: 'rule-1', ruleId: 'R1', label: '金额条件', expression: { code: 'amount > 0' } }]);
    recorder.stop();
  });

  it('同步递归达到深度上限时停止采集但不改变业务返回值', () => {
    const component = { data: {}, triggerComputeMixin(depth: number): number { return depth > 0 ? component.triggerComputeMixin(depth - 1) : 7; } };
    const recorder = new TraceRecorder(() => snapshot);
    recorder.start('bill', [{ component, getInstanceId: () => 'bill' }]);
    expect(component.triggerComputeMixin(40)).toBe(7);
    expect(recorder.get()?.stopDetail).toMatchObject({ code: 'recursion-depth', threshold: 32 });
    expect(recorder.get()?.active).toBe(false);
  });

  it('短时间事件风暴停止采集并保留事件上限内的记录', () => {
    const component = { data: {}, triggerComputeMixin() {} };
    const recorder = new TraceRecorder(() => snapshot);
    recorder.start('bill', [{ component, getInstanceId: () => 'bill' }]);
    for (let index = 0; index < 301; index += 1) component.triggerComputeMixin();
    expect(recorder.get()?.stopDetail).toMatchObject({ code: 'event-storm', threshold: 300 });
    expect(recorder.get()?.events.length).toBe(300);
  });
});
