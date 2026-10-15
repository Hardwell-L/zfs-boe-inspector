import type { JsonValue, TravelInspectionData, TravelPersonInspection } from '@zfs-boe-inspector/shared-types';
import type { TravelCollectorOptions, TravelComponentLike } from './collector';
import { serializeMultiTravelValue, type SerializeBudget, type MultiSerializeOptions } from './multiSerialize';

const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown): string => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';

/** 只访问明确的人员引用；每次快照独立读取，避免持有已删除的宿主组件。 */
export function collectMultiTravel(owner: TravelComponentLike, options: TravelCollectorOptions): TravelInspectionData {
  const start = performance.now();
  const budget: SerializeBudget = { nodes: 0, characters: 0, deadline: start + 16, reasons: new Set() };
  const limits: MultiSerializeOptions = {
    maxDepth: 20, maxArrayLength: 1_000, maxObjectKeys: 1_000, maxNodes: 20_000,
    maxStringLength: 8_192, maxTotalStringLength: 1_048_576,
    ...options.serialization, budget, expandSharedReferences: true,
  };
  const reasons: string[] = [];
  const personKeys = new Set<string>();
  const reads: Record<string, number> = {};
  const persons: TravelPersonInspection[] = [];
  const stopped = () => performance.now() >= budget.deadline || budget.nodes >= limits.maxNodes!
    || budget.characters >= limits.maxTotalStringLength!;
  const read = <T>(path: string, getter: () => T, errors: string[]): T | undefined => {
    if (stopped()) { errors.push(`${path}：采集预算已用尽`); return undefined; }
    const before = performance.now();
    try { return getter(); } catch { errors.push(`${path}：读取失败`); return undefined; }
    finally { reads[path] = performance.now() - before; }
  };
  const serialize = (path: string, value: unknown, errors: string[]): JsonValue | undefined => {
    if (value === undefined) return undefined;
    budget.reasons.clear();
    let result: JsonValue;
    try { result = serializeMultiTravelValue(value, limits); }
    catch { errors.push(`${path}：序列化读取失败`); return undefined; }
    for (const reason of budget.reasons) errors.push(`${path}：${reason}`);
    return result;
  };
  const list = read('personList', () => owner.personList, reasons);
  const refs = read('$refs', () => owner.$refs, reasons);
  const raw = read('data', () => owner.data, reasons);
  // 原始明细只分组一次，不读取每张卡片会再次过滤全表的 data computed。
  const group = (key: string): Map<string, unknown[]> | undefined => {
    const rows = read(`data.${key}`, () => raw?.[key], reasons);
    if (!Array.isArray(rows)) { reasons.push(`data.${key}：未采集`); return undefined; }
    const groups = new Map<string, unknown[]>();
    for (let i = 0; i < rows.length; i += 1) {
      if (i >= limits.maxArrayLength! || stopped()) { reasons.push(`data.${key}：分组预算截断`); break; }
      try {
        const row = rows[i];
        const id = text(record(row)?.employeeId);
        if (!id || id === 'public' || id === 'other') continue;
        const bucket = groups.get(id) ?? [];
        bucket.push(row);
        groups.set(id, bucket);
      } catch { reasons.push(`data.${key}.${i}：归属读取失败`); }
    }
    return groups;
  };
  const invoices = group('cost');
  const calendars = group('zfsBoeCalendarDTOS');
  const sharedReasons = [...reasons];
  if (!Array.isArray(list)) reasons.push('personList：未识别到出行人员');
  for (let index = 0; index < Math.min(list?.length ?? 0, 1_000); index += 1) {
    // 预算用尽后不再读取宿主，包括后续人员的身份 getter。
    if (stopped()) { reasons.push(`personList.${index}：剩余人员未采集，预算已用尽`); break; }
    const errors: string[] = [];
    const identity = read(`persons.${index}.identity`, () => {
      const row = list![index]!;
      return {
        employeeId: text(row.employeeId), employeeName: text(row.employeeName),
        postId: text(row.employeePost), postName: text(row.employeePostName),
      };
    }, errors);
    if (!identity?.employeeId) { reasons.push(`personList.${index}：人员身份不可用`); continue; }
    const key = JSON.stringify([identity.employeeId, identity.postId]);
    if (personKeys.has(key)) { reasons.push(`personList.${index}：人员与岗位重复`); continue; }
    personKeys.add(key);
    serialize(`persons.${index}.identity`, identity, errors);
    if (errors.length) { reasons.push(...errors); continue; }
    const data: TravelPersonInspection['data'] = {
      currentPerson: identity,
      ...(options.legacyMode ? { inspectionMode: 'legacy' as const } : { requestEvidence: 'cache' as const }),
    };
    const item: TravelPersonInspection = { key, person: identity, data, collection: { status: 'complete', reasons: errors } };
    persons.push(item);
    const put = (name: keyof TravelPersonInspection['data'], value: unknown) => {
      const result = serialize(`persons.${index}.${name}`, value, errors);
      if (result === undefined) return;
      if (record(result)?.__kind) { errors.push(`${name}：字段未完整采集或结构不匹配`); return; }
      const arrayField = ['transportInvoices', 'calendarData', 'trips', 'standardDates', 'standardRequests'].includes(name);
      if ((arrayField && !Array.isArray(result)) || (name === 'standardResults' && !record(result))) {
        errors.push(`${name}：宿主数据结构不匹配`);
        return;
      }
      Object.assign(data, { [name]: result });
    };
    put('transportInvoices', invoices?.get(identity.employeeId) ?? (invoices ? [] : undefined));
    data.transportInvoiceEmployeeId = identity.employeeId;
    const card = read(`persons.${index}.ref`, () => {
      const ref = refs?.[identity.employeeId];
      const candidates = Array.isArray(ref) ? ref : ref ? [ref] : [];
      if (candidates.length > 1_000) return undefined;
      const matches: TravelComponentLike[] = [];
      for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        if (stopped()) break;
        const candidate = candidates[candidateIndex];
        if (!candidate || typeof candidate !== 'object') continue;
        const person = candidate.person;
        if (text(person?.employeeId) === identity.employeeId
          && (!identity.postId || text(person?.employeePost) === identity.postId)) matches.push(candidate);
      }
      return matches.length === 1 ? matches[0] : undefined;
    }, errors);
    if (!card) errors.push('人员卡片未就绪或身份、岗位无法唯一确认');
    if (card) {
      const fields: Array<[keyof TravelPersonInspection['data'], keyof TravelComponentLike]> = [
        ['standardResults', 'standardAmount'], ['standardDates', 'standardDates'], ['standardSummary', 'standardSummary'],
      ];
      if (!options.legacyMode) fields.push(['calendarData', 'calendarData'], ['trips', 'travelList']);
      for (const [target, source] of fields) {
        const value = read(`persons.${index}.${source}`, () => card[source], errors);
        if (value === undefined && (source === 'standardAmount' || source === 'calendarData')) errors.push(`${source}：宿主未提供`);
        put(target, value);
      }
      if (!options.legacyMode) {
        const cache = read(`persons.${index}.standardAmountParamsObj`, () => card.standardAmountParamsObj, errors);
        if (cache) {
          // 只摘取元信息，不遍历或等待 promise；所有循环也受同一时间预算限制。
          const requests: NonNullable<TravelInspectionData['standardRequests']> = [];
          let count = 0;
          for (const cacheKey in cache) {
            if (!Object.hasOwn(cache, cacheKey)) continue;
            if (stopped() || count++ >= 1_000) { errors.push('请求缓存：预算截断'); break; }
            const entries = read(`persons.${index}.cache.${count}`, () => cache[cacheKey], errors);
            if (!Array.isArray(entries)) continue;
            for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
              if (stopped() || entryIndex >= 1_000 || requests.length >= 1_000) { errors.push('请求缓存：预算截断'); break; }
              const entry = read(`persons.${index}.cacheEntry.${entryIndex}`, () => entries[entryIndex], errors);
              const metadata = read(`persons.${index}.request.${requests.length}`, () => ({
                cacheKey, boeDate: text(record(entry)?.boeDate).slice(0, 10),
                schemeCode: text(record(entry)?.schemeCode), status: 'unknown' as const,
              }), errors);
              if (metadata) requests.push(metadata);
            }
          }
          put('standardRequests', requests);
          data.requestEvidence = 'cache';
        }
      }
    }
    if (!data.calendarData) put('calendarData', calendars?.get(identity.employeeId) ?? (calendars ? [] : undefined));
    if (stopped()) errors.push('人员采集预算已用尽，结果不完整');
    if (errors.length) item.collection.status = card ? 'partial' : 'unavailable';
    data.collection = item.collection;
  }
  if ((list?.length ?? 0) > 1_000) reasons.push('personList：超过 1,000 人，已截断');
  if (sharedReasons.length) {
    for (const item of persons) {
      item.collection.status = item.collection.status === 'unavailable' ? 'unavailable' : 'partial';
      item.collection.reasons.push(...sharedReasons);
    }
  }
  return {
    mode: 'multi', persons,
    collection: { status: reasons.length || persons.some((item) => item.collection.status !== 'complete') ? 'partial' : 'complete', reasons },
    diagnostics: { elapsedMs: performance.now() - start, nodes: budget.nodes, characters: budget.characters, reads },
    ...(options.legacyMode ? { inspectionMode: 'legacy' } : {}),
  };
}
