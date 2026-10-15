import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTravelCollector, type TravelComponentLike } from './collector';

function host(count = 2): TravelComponentLike {
  const people = Array.from({ length: count }, (_, index) => ({ employeeId: `E${index}`, employeeName: `人员${index}`, employeePost: `P${index}` }));
  return {
    $options: { name: 'MULTITRAVELBOE' }, personList: people,
    data: { cost: people.map((person) => ({ employeeId: person.employeeId, attribute: 'CLZS' })), zfsBoeCalendarDTOS: [] },
    $refs: Object.fromEntries(people.map((person, index) => [person.employeeId, [{
      person, calendarData: [{ employeeId: person.employeeId, expenseDate: '2026-10-01', travelSite: '武汉' }],
      travelList: [], standardDates: [], standardAmount: { '武汉_2026-10-01': [{ standardAmount: 100 + index }] },
      standardAmountParamsObj: { key: [{ boeDate: '2026-10-01', get promise() { throw new Error('不得读取 Promise'); } }] },
    }]])),
  };
}

describe('多人差旅隔离采集', () => {
  beforeEach(() => { vi.spyOn(performance, 'now').mockReturnValue(0); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('同日同地的标准和发票按人员隔离，兼容数组与单实例 ref', () => {
    const owner = host();
    const second = owner.$refs!.E1 as TravelComponentLike[];
    owner.$refs!.E1 = second[0]!;
    const result = createTravelCollector(owner).collect().travel!;
    expect(result.collection?.status).toBe('complete');
    expect(result.persons?.map((person) => person.data.standardResults)).toEqual([
      { '武汉_2026-10-01': [{ standardAmount: 100 }] }, { '武汉_2026-10-01': [{ standardAmount: 101 }] },
    ]);
    expect(result.persons?.[1]?.data.transportInvoices).toEqual([{ employeeId: 'E1', attribute: 'CLZS' }]);
    expect(result.currentPerson).toBeUndefined();
  });

  it('重新采集解析新 ref，不保留已删除人员', () => {
    const owner = host();
    const collector = createTravelCollector(owner);
    delete owner.$refs!.E0;
    expect(collector.collect().travel?.persons?.[0]?.collection.status).toBe('unavailable');
    owner.personList = owner.personList!.slice(1);
    expect(collector.collect().travel?.persons?.map((person) => person.person.employeeId)).toEqual(['E1']);
  });

  it('legacy 不读取未经核验的 computed 或请求缓存', () => {
    const owner = host(1);
    const card = (owner.$refs!.E0 as TravelComponentLike[])[0]!;
    for (const key of ['calendarData', 'travelList', 'standardAmountParamsObj']) {
      Object.defineProperty(card, key, { get() { throw new Error('不得读取'); } });
    }
    card.standardAmount = { 武汉: [{ standardAmount: 100 }] };
    const person = createTravelCollector(owner, { legacyMode: true }).collect().travel?.persons?.[0];
    expect(person?.collection.status).toBe('complete');
    expect(person?.data).toMatchObject({ inspectionMode: 'legacy', standardResults: { 武汉: [{ standardAmount: 100 }] } });
    expect(person?.data.standardRequests).toBeUndefined();
  });

  it('岗位不一致时不读取该卡片标准', () => {
    const owner = host(1);
    const card = (owner.$refs!.E0 as TravelComponentLike[])[0]!;
    card.person = { employeeId: 'E0', employeePost: 'wrong' };
    const getter = vi.fn(() => ({}));
    Object.defineProperty(card, 'standardAmount', { get: getter });
    expect(createTravelCollector(owner).collect().travel?.persons?.[0]?.collection.status).toBe('unavailable');
    expect(getter).not.toHaveBeenCalled();
  });

  it.each([1, 10, 50])('%i 人共享节点预算，序列化上限不会乘以人数', (count) => {
    const owner = host(count);
    const result = createTravelCollector(owner, { serialization: { maxNodes: 12 } }).collect().travel!;
    expect(result.diagnostics?.nodes).toBeLessThanOrEqual(12);
    expect(result.collection?.status).toBe('partial');
  });

  it('单个 getter 超出软预算后停止读取后续字段', () => {
    const owner = host(1);
    const card = (owner.$refs!.E0 as TravelComponentLike[])[0]!;
    Object.defineProperty(card, 'standardAmount', { get() { vi.mocked(performance.now).mockReturnValue(20); return {}; } });
    const later = vi.fn(() => []);
    Object.defineProperty(card, 'calendarData', { get: later });
    expect(createTravelCollector(owner).collect().travel?.collection?.status).toBe('partial');
    expect(later).not.toHaveBeenCalled();
  });
});

// Array.filter / for...of 会先读取下一项，再进入回调或循环体，不能用于预算边界。
describe('多人采集停止边界', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('ref 身份读取耗尽预算后，不再读取下一项 ref', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const owner = host(1);
    const later = vi.fn(() => ({ person: { employeeId: 'E0' } }));
    const refs: TravelComponentLike[] = [{ get person() {
      vi.mocked(performance.now).mockReturnValue(20);
      return { employeeId: 'E0', employeePost: 'P0' };
    } }];
    Object.defineProperty(refs, 1, { get: later });
    owner.$refs!.E0 = refs;
    createTravelCollector(owner).collect();
    expect(later).not.toHaveBeenCalled();
  });

  it('缓存元信息读取耗尽预算后，不再读取下一项缓存', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const owner = host(1);
    const later = vi.fn(() => ({ boeDate: '2026-10-02' }));
    const entries: unknown[] = [{ get boeDate() {
      vi.mocked(performance.now).mockReturnValue(20);
      return '2026-10-01';
    } }];
    Object.defineProperty(entries, 1, { get: later });
    (owner.$refs!.E0 as TravelComponentLike[])[0]!.standardAmountParamsObj = { key: entries };
    createTravelCollector(owner).collect();
    expect(later).not.toHaveBeenCalled();
  });
});
