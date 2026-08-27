import type { BoeInspectionSnapshot, JsonValue, RuleEvaluation } from '@zfs-boe-inspector/shared-types';
import { asRecord, issue, jsonValue, passed, skipped } from './helpers';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TRAVEL_RULE_IDS = [
  'TRAVEL_DATE_MISSING',
  'TRAVEL_DATE_DUPLICATE',
  'TRAVEL_DATE_ORDER_INVALID',
  'TRAVEL_STANDARD_REQUEST_MISSING',
  'TRAVEL_STANDARD_RESULT_MISSING',
  'TRAVEL_STANDARD_DATE_MISMATCH',
  'TRAVEL_STANDARD_KEY_MISS',
  'TRAVEL_STANDARD_TYPE_LOST',
  'TRAVEL_STANDARD_DEDUP_ABNORMAL',
  'TRAVEL_STANDARD_SUMMARY_MISMATCH',
  'TRAVEL_CONTROL_AGGREGATE_MISMATCH',
  'TRAVEL_SUBSIDY_SITE_ABNORMAL',
  'TRAVELER_CLAIMANT_MISMATCH',
] as const;

function dateFrom(value: unknown): string | undefined {
  const record = asRecord(value);
  const candidate = record?.boeDate
    ?? record?.expenseDate
    ?? record?.travelDate
    ?? record?.date
    ?? record?.startDate;
  if (typeof candidate !== 'string') return undefined;
  return DATE_PATTERN.test(candidate.slice(0, 10)) ? candidate.slice(0, 10) : undefined;
}

function textFrom(value: unknown, keys: string[]): string | undefined {
  const record = asRecord(value);
  for (const key of keys) {
    const candidate = record?.[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function numberFrom(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}

function resultDate(key: string, value: JsonValue): string | undefined {
  const fromValue = dateFrom(value);
  if (fromValue) return fromValue;
  return key.match(/\d{4}-\d{2}-\d{2}/)?.[0];
}

function addPassed(results: RuleEvaluation[]): RuleEvaluation[] {
  for (const ruleId of TRAVEL_RULE_IDS) {
    if (!results.some((result) => result.ruleId === ruleId)) {
      results.push(passed(ruleId, 'travel-standard', `${ruleId} 未发现问题`));
    }
  }
  return results;
}

export function evaluateTravelRules(snapshot: BoeInspectionSnapshot): RuleEvaluation[] {
  const travel = snapshot.travel;
  if (!travel) {
    return TRAVEL_RULE_IDS.map((ruleId) => skipped(
      ruleId,
      'travel-standard',
      '当前 Snapshot 未注册差旅 Collector，规则未执行',
      ['travel'],
    ));
  }

  const results: RuleEvaluation[] = [];
  const calendar = travel.calendarData ?? [];
  const trips = travel.trips ?? [];
  const datedItems = calendar.length > 0 ? calendar : trips;
  const dates = datedItems.map(dateFrom);
  dates.forEach((date, index) => {
    if (!date) {
      results.push(issue(
        'TRAVEL_DATE_MISSING',
        'travel-standard',
        'error',
        `差旅行程第 ${index + 1} 项缺少有效日期`,
        [`travel.${calendar.length > 0 ? 'calendarData' : 'trips'}.${index}`],
      ));
    }
  });
  const validDates = dates.filter((date): date is string => Boolean(date));
  const duplicateDates = [...new Set(validDates.filter((date, index) => validDates.indexOf(date) !== index))];
  for (const date of duplicateDates) {
    results.push(issue('TRAVEL_DATE_DUPLICATE', 'travel-standard', 'warning', `差旅日期 ${date} 重复`, ['travel.calendarData'], { actual: date }));
  }
  for (let index = 1; index < validDates.length; index += 1) {
    const previous = validDates[index - 1];
    const current = validDates[index];
    if (previous && current && current < previous) {
      results.push(issue(
        'TRAVEL_DATE_ORDER_INVALID',
        'travel-standard',
        'warning',
        `差旅日期顺序异常：${current} 早于 ${previous}`,
        ['travel.calendarData'],
      ));
      break;
    }
  }

  const requests = travel.standardRequests ?? [];
  const requestDates = new Set(requests.map(({ boeDate }) => boeDate?.slice(0, 10)).filter((date): date is string => Boolean(date)));
  for (const date of new Set(validDates)) {
    if (!requestDates.has(date)) {
      results.push(issue(
        'TRAVEL_STANDARD_REQUEST_MISSING',
        'travel-standard',
        'error',
        `差旅日期 ${date} 没有对应的标准请求`,
        ['travel.calendarData', 'travel.standardRequests'],
        { actual: date },
      ));
    }
  }

  const resultEntries = Object.entries(travel.standardResults ?? {});
  const resultDates = new Set(resultEntries
    .map(([key, value]) => resultDate(key, value))
    .filter((date): date is string => Boolean(date)));
  const cachedDates = new Set((travel.standardDates ?? [])
    .map((value) => typeof value === 'string' ? value.slice(0, 10) : dateFrom(value))
    .filter((date): date is string => Boolean(date)));
  for (const date of new Set([...requestDates, ...cachedDates])) {
    if (!resultDates.has(date)) {
      results.push(issue(
        'TRAVEL_STANDARD_RESULT_MISSING',
        'travel-standard',
        'error',
        `日期 ${date} 已请求或进入缓存，但没有标准结果`,
        ['travel.standardRequests', 'travel.standardDates', 'travel.standardResults'],
        { actual: date },
      ));
    }
  }
  for (const date of resultDates) {
    if (requestDates.size > 0 && !requestDates.has(date)) {
      results.push(issue(
        'TRAVEL_STANDARD_DATE_MISMATCH',
        'travel-standard',
        'warning',
        `标准结果日期 ${date} 未出现在请求日期中`,
        ['travel.standardRequests', 'travel.standardResults'],
      ));
    }
  }

  datedItems.forEach((item, index) => {
    const date = dateFrom(item);
    const site = textFrom(item, ['staySite', 'travelSite', 'cityName', 'site']);
    if (!date || !site || resultEntries.length === 0) return;
    const matched = resultEntries.some(([key, value]) => {
      const record = asRecord(value);
      const resultSite = textFrom(record, ['staySite', 'travelSite', 'cityName', 'site']);
      return key.includes(date) && (key.includes(site) || resultSite === site);
    });
    if (!matched) {
      results.push(issue(
        'TRAVEL_STANDARD_KEY_MISS',
        'travel-standard',
        'warning',
        `${site}_${date} 无法命中标准结果`,
        [`travel.${calendar.length > 0 ? 'calendarData' : 'trips'}.${index}`, 'travel.standardResults'],
      ));
    }
  });

  const expectedTypes = new Set(datedItems
    .map((item) => textFrom(item, ['attribute', 'standardType', 'expenseType']))
    .filter((value): value is string => Boolean(value)));
  const resultTypes = new Set(resultEntries
    .flatMap(([, value]) => Array.isArray(value) ? value : [value])
    .map((value) => textFrom(value, ['attribute', 'standardType', 'expenseType']))
    .filter((value): value is string => Boolean(value)));
  for (const type of expectedTypes) {
    if (resultTypes.size > 0 && !resultTypes.has(type)) {
      results.push(issue('TRAVEL_STANDARD_TYPE_LOST', 'travel-standard', 'error', `业务标准类型 ${type} 在结果中丢失`, ['travel.calendarData', 'travel.standardResults']));
    }
  }

  const summary = asRecord(travel.standardSummary);
  const rawCount = numberFrom(summary?.rawCount);
  const dedupCount = numberFrom(summary?.dedupCount);
  if (rawCount !== undefined && dedupCount !== undefined && (dedupCount > rawCount || dedupCount < 0)) {
    results.push(issue(
      'TRAVEL_STANDARD_DEDUP_ABNORMAL',
      'travel-standard',
      'error',
      '差旅标准去重前后数量异常',
      ['travel.standardSummary.rawCount', 'travel.standardSummary.dedupCount'],
      { expected: `0 <= dedupCount <= ${rawCount}`, actual: dedupCount },
    ));
  } else if (rawCount === undefined || dedupCount === undefined) {
    results.push(skipped('TRAVEL_STANDARD_DEDUP_ABNORMAL', 'travel-standard', 'Snapshot 未提供去重前后计数，无法复核去重过程', ['travel.standardSummary']));
  }

  const declaredTotal = numberFrom(summary?.total ?? summary?.standardAmount);
  const dailyItems = Array.isArray(summary?.daily) ? summary.daily : [];
  const reproducedTotal = dailyItems.reduce((total: number, item: unknown) => {
    const record = asRecord(item);
    return total + (numberFrom(record?.amount ?? record?.standardAmount) ?? 0);
  }, 0);
  if (declaredTotal !== undefined && dailyItems.length > 0 && Math.abs(declaredTotal - reproducedTotal) > 0.01) {
    results.push(issue(
      'TRAVEL_STANDARD_SUMMARY_MISMATCH',
      'travel-standard',
      'error',
      '标准汇总金额无法由逐日标准复算得到',
      ['travel.standardSummary.total', 'travel.standardSummary.daily'],
      { expected: reproducedTotal, actual: declaredTotal },
    ));
  } else if (declaredTotal === undefined || dailyItems.length === 0) {
    results.push(skipped('TRAVEL_STANDARD_SUMMARY_MISMATCH', 'travel-standard', 'Snapshot 未提供逐日金额与汇总金额，无法复算', ['travel.standardSummary']));
  }

  const rank: Record<string, number> = { ALLOW: 0, WARNING: 1, FORBID: 2 };
  const declaredControl = String(summary?.controlType ?? '');
  const dailyControls = dailyItems
    .map((item: unknown) => String(asRecord(item)?.controlType ?? ''))
    .filter((control: string) => control in rank);
  if (declaredControl in rank && dailyControls.length > 0) {
    const strongest = dailyControls.reduce((current: string, value: string) => rank[value]! > rank[current]! ? value : current, 'ALLOW');
    if (strongest !== declaredControl) {
      results.push(issue(
        'TRAVEL_CONTROL_AGGREGATE_MISMATCH',
        'travel-standard',
        'error',
        `控制等级汇总应为 ${strongest}，实际为 ${declaredControl}`,
        ['travel.standardSummary.controlType', 'travel.standardSummary.daily'],
      ));
    }
  } else {
    results.push(skipped('TRAVEL_CONTROL_AGGREGATE_MISMATCH', 'travel-standard', 'Snapshot 缺少逐日及汇总控制等级，无法复核', ['travel.standardSummary']));
  }

  datedItems.forEach((item, index) => {
    const record = asRecord(item);
    const sameDay = record?.sameDay === true || record?.isSameDay === true;
    const subsidySite = textFrom(record, ['subsidySite']);
    const travelSite = textFrom(record, ['travelSite']);
    const staySite = textFrom(record, ['staySite']);
    if (subsidySite && sameDay && travelSite && subsidySite !== travelSite) {
      results.push(issue('TRAVEL_SUBSIDY_SITE_ABNORMAL', 'travel-standard', 'warning', '当天往返补贴地点与出差地点不一致', [`travel.calendarData.${index}`], { expected: travelSite, actual: subsidySite }));
    }
    if (subsidySite && !sameDay && staySite && subsidySite !== staySite) {
      results.push(issue('TRAVEL_SUBSIDY_SITE_ABNORMAL', 'travel-standard', 'warning', '跨天行程补贴地点与住宿地点不一致', [`travel.calendarData.${index}`], { expected: staySite, actual: subsidySite }));
    }
  });

  const travelers = new Set((travel.travelerNames ?? []).map((name) => name.trim()).filter(Boolean));
  const claimants = new Set((travel.claimantNames ?? []).map((name) => name.trim()).filter(Boolean));
  if (travelers.size > 0 && claimants.size > 0) {
    const mismatch = [...travelers].filter((name) => !claimants.has(name));
    if (mismatch.length > 0) {
      results.push(issue(
        'TRAVELER_CLAIMANT_MISMATCH',
        'travel-standard',
        'warning',
        `出行人员与报账人员不一致：${mismatch.join('、')}`,
        ['travel.travelerNames', 'travel.claimantNames'],
        { actual: jsonValue({ travelers: [...travelers], claimants: [...claimants] }) },
      ));
    }
  } else {
    results.push(skipped('TRAVELER_CLAIMANT_MISMATCH', 'travel-standard', 'Snapshot 未同时提供出行人员与报账人员，无法比对', ['travel.travelerNames', 'travel.claimantNames']));
  }

  return addPassed(results);
}
