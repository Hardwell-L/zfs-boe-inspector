import type { JsonValue, TravelInspectionData, TravelStandardRequest } from '@zfs-boe-inspector/shared-types';

export interface TravelStandardRow {
  key: string;
  place: string;
  date: string;
  standardName: string;
  amount?: number | string;
  currency: string;
  controlType: string;
  schemeCode: string;
  schemeId?: string;
  transportation?: string;
  standardDiscount?: string;
  conditions?: string;
  raw: JsonValue;
}

export interface TravelCalendarRow {
  date: string;
  travelSite: string;
  staySite: string;
  employeeId: string;
  employeeName: string;
  businessType?: string;
  amount?: number | string;
  matchedStandardAmount?: number;
  overAmount?: number;
  matchStatus: 'matched' | 'unmatched' | 'unverified' | 'candidate';
  candidateCount?: number;
  pageStandardAmount?: number | string;
  raw: JsonValue;
}

export interface TravelRequestRow extends TravelStandardRequest {
  matched: boolean;
}

export interface TravelViewModel {
  legacy?: boolean;
  person: { employeeId: string; employeeName: string; postId: string; postName: string };
  standards: TravelStandardRow[];
  calendar: TravelCalendarRow[];
  requests: TravelRequestRow[];
  metrics: { travelDays: number; standardCount: number; requestCount: number; matchedRequestCount: number };
  businessSummary: {
    prerequisites: Array<{ label: string; satisfied: boolean; value: string }>;
    matchedRows: number;
    unmatchedRows: number;
    exceededRows: number;
    conclusion: string;
  };
}

function asRecord(value: unknown): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, JsonValue> : undefined;
}

function firstText(record: Record<string, JsonValue> | undefined, keys: string[]): string {
  for (const key of keys) {
    const value = record?.[key];
    if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
  }
  return '';
}

function firstAmount(record: Record<string, JsonValue> | undefined): number | string | undefined {
  for (const key of ['standardAmount', 'popularStandardAmount', 'amount', 'maxAmount', 'expenseAmount', 'subsidyAmount']) {
    const value = record?.[key];
    if (typeof value === 'number' || typeof value === 'string') return value;
  }
  return undefined;
}

function dateFrom(record: Record<string, JsonValue> | undefined): string {
  return firstText(record, ['boeDate', 'expenseDate', 'travelDate', 'date', 'startDate']).slice(0, 10);
}

function keyIdentity(key: string): { place: string; date: string } {
  const date = key.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
  return { date, place: date ? key.slice(0, Math.max(0, key.indexOf(date) - 1)) : key };
}

function standardRows(travel: TravelInspectionData): TravelStandardRow[] {
  return Object.entries(travel.standardResults ?? {}).flatMap(([key, value]) => {
    const identity = keyIdentity(key);
    return (Array.isArray(value) ? value : [value]).flatMap((item) => {
      const record = asRecord(item);
      if (!record || (travel.inspectionMode === 'legacy' && record.__kind)) return [];
      const row: TravelStandardRow = {
        key,
        place: firstText(record, ['staySite', 'travelSite', 'cityName', 'site']) || identity.place || '—',
        date: dateFrom(record) || identity.date || '—',
        standardName: firstText(record, ['operationSubTypeName', 'bizCategorySmallName', 'standardName', 'attributeName', 'attribute', 'standardType']) || '未命名标准',
        currency: firstText(record, ['currencyName', 'currencyCode', 'currency']) || '—',
        controlType: firstText(record, ['controlTypeName', 'controlType', 'controlLevel']) || '—',
        schemeCode: firstText(record, ['schemeCode', 'standardSchemeCode']) || '—',
        raw: item,
      };
      if (travel.inspectionMode === 'legacy') {
        row.schemeId = firstText(record, ['schemeId']);
        row.transportation = firstText(record, ['transportation']);
        row.standardDiscount = firstText(record, ['standardDiscount']);
        const begin = Number(record.travelDayBegin);
        const end = Number(record.travelDayEnd);
        const conditions = [
          begin > 0 && end >= begin ? end >= 9999 ? `第 ${begin} 天起` : `第 ${begin}–${end} 天` : '',
          firstText(record, ['typeOfSubsidy']) ? `补贴类型 ${firstText(record, ['typeOfSubsidy'])}` : '',
          firstText(record, ['popularMonth']) ? `旺季月份 ${firstText(record, ['popularMonth'])}` : '',
          row.standardDiscount ? `折扣 ${row.standardDiscount}` : '',
          record.priority !== undefined ? `优先级 ${String(record.priority)}` : '',
        ].filter(Boolean);
        row.conditions = conditions.join(' · ');
      }
      const amount = firstAmount(record);
      if (amount !== undefined) row.amount = amount;
      return [row];
    });
  });
}

function calendarRows(travel: TravelInspectionData): TravelCalendarRow[] {
  const source = (travel.calendarData?.length ? travel.calendarData : travel.trips) ?? [];
  const rows = source.flatMap((item) => {
    const record = asRecord(item);
    if (!record || (travel.inspectionMode === 'legacy' && record.__kind)) return [];
    const row: TravelCalendarRow = {
      date: dateFrom(record) || '—',
      travelSite: firstText(record, ['travelSite', 'destination', 'cityName']) || '—',
      staySite: firstText(record, ['staySite', 'accommodationSite']) || '—',
      employeeId: firstText(record, ['employeeId', 'empId', 'travelerId']),
      employeeName: firstText(record, ['employeeName', 'empName', 'travelerName']) || '—',
      ...(travel.inspectionMode === 'legacy' ? { businessType: firstText(record, ['operationSubTypeName', 'bizCategorySmallName']) } : {}),
      matchStatus: 'unverified',
      raw: item,
    };
    const amount = travel.inspectionMode === 'legacy'
      ? record.expenseAmount ?? record.subsidyAmount ?? record.amount
      : firstAmount(record);
    if (typeof amount === 'string' || typeof amount === 'number') row.amount = amount;
    return [row];
  });
  const employeeId = travel.currentPerson?.employeeId;
  if (travel.inspectionMode === 'legacy') return rows;
  if (!employeeId) return rows;
  const currentRows = rows.filter((row) => row.employeeId === employeeId);
  return currentRows.length > 0 ? currentRows : rows;
}

export function buildTravelView(travel?: TravelInspectionData): TravelViewModel {
  const standards = travel ? standardRows(travel) : [];
  const calendar = travel ? calendarRows(travel) : [];
  if (travel?.inspectionMode === 'legacy') return buildLegacyTravelView(travel, standards, calendar);
  const resultDates = new Set(standards.map(({ date }) => date).filter((date) => date !== '—'));
  const requests = (travel?.standardRequests ?? []).map((request) => ({
    ...request,
    matched: Boolean(request.boeDate && resultDates.has(request.boeDate.slice(0, 10))),
  }));
  for (const row of calendar) {
    const candidates = standards.filter((standard) => {
      if (standard.date !== row.date) return false;
      return standard.place === '—'
        || row.staySite === standard.place
        || row.travelSite === standard.place;
    });
    if (candidates.length === 0) {
      row.matchStatus = standards.length > 0 ? 'unmatched' : 'unverified';
      continue;
    }
    row.matchStatus = 'matched';
    const standardAmounts = candidates
      .map(({ amount }) => Number(amount))
      .filter((amount) => Number.isFinite(amount));
    const expenseAmount = Number(row.amount);
    if (standardAmounts.length > 0) row.matchedStandardAmount = Math.max(...standardAmounts);
    if (Number.isFinite(expenseAmount) && row.matchedStandardAmount !== undefined) {
      row.overAmount = Math.max(0, Number((expenseAmount - row.matchedStandardAmount).toFixed(2)));
    }
  }
  const person = travel?.currentPerson;
  const exceededRows = calendar.filter(({ overAmount }) => (overAmount ?? 0) > 0).length;
  const matchedRows = calendar.filter(({ matchStatus }) => matchStatus === 'matched').length;
  const unmatchedRows = calendar.filter(({ matchStatus }) => matchStatus === 'unmatched').length;
  const prerequisites = [
    { label: '人员', satisfied: Boolean(person?.employeeId || person?.employeeName), value: person?.employeeName ?? person?.employeeId ?? '未识别' },
    { label: '日期', satisfied: calendar.some(({ date }) => date !== '—'), value: `${new Set(calendar.map(({ date }) => date).filter((date) => date !== '—')).size} 天` },
    { label: '地点', satisfied: calendar.some(({ travelSite, staySite }) => travelSite !== '—' || staySite !== '—'), value: calendar.map(({ travelSite, staySite }) => staySite !== '—' ? staySite : travelSite).filter((value) => value !== '—').join('、') || '未识别' },
    { label: '标准请求', satisfied: requests.length > 0, value: `${requests.length} 条` },
  ];
  return {
    person: {
      employeeId: person?.employeeId ?? '',
      employeeName: person?.employeeName ?? '',
      postId: person?.postId ?? '',
      postName: person?.postName ?? '',
    },
    standards,
    calendar,
    requests,
    metrics: {
      travelDays: new Set(calendar.map(({ date }) => date).filter((date) => date !== '—')).size,
      standardCount: standards.length,
      requestCount: requests.length,
      matchedRequestCount: requests.filter(({ matched }) => matched).length,
    },
    businessSummary: {
      prerequisites,
      matchedRows,
      unmatchedRows,
      exceededRows,
      conclusion: prerequisites.some(({ satisfied }) => !satisfied)
        ? '标准匹配前置条件不完整，请先核对人员、日期、地点和请求参数。'
        : unmatchedRows > 0
          ? `有 ${unmatchedRows} 行未匹配到差旅标准。`
          : exceededRows > 0
            ? `有 ${exceededRows} 行费用超过已匹配标准。`
            : matchedRows > 0 ? '当前行程均已匹配标准，未发现明确超标准记录。' : '暂无可核对的行程。',
    },
  };
}

function buildLegacyTravelView(
  travel: TravelInspectionData,
  standards: TravelStandardRow[],
  calendar: TravelCalendarRow[],
): TravelViewModel {
  const person = travel.currentPerson;
  const city = (value: string) => value.split(',').pop()?.trim() ?? '';
  // 城市缓存只表示候选来源；不能用其中的最大金额推断最终标准或超标金额。
  const byCity = new Map<string, TravelStandardRow[]>();
  for (const standard of standards) {
    if (standard.place === '—') continue;
    const key = city(standard.place);
    const items = byCity.get(key) ?? [];
    items.push(standard);
    byCity.set(key, items);
  }
  const datePersons = new Map<string, Set<string>>();
  for (const row of calendar) {
    const people = datePersons.get(row.date) ?? new Set<string>();
    people.add(row.employeeId);
    datePersons.set(row.date, people);
  }
  const calculatedByDateAndCity = new Map<string, Record<string, JsonValue>>();
  for (const item of travel.calculatedCalendarStandards ?? []) {
    const record = asRecord(item);
    if (!record) continue;
    calculatedByDateAndCity.set(`${dateFrom(record)}:${city(firstText(record, ['travelSite']))}`, record);
  }
  const queryEmployeeId = firstText(asRecord(travel.queryConditions), ['empId', 'employeeId']);
  for (const row of calendar) {
    const raw = asRecord(row.raw);
    const code = firstText(raw, ['operationSubTypeCode']);
    const attribute = firstText(raw, ['attribute']);
    const places = new Set([row.travelSite, row.staySite].filter((place) => place !== '—').map(city));
    const candidates = [...places].flatMap((place) => byCity.get(place) ?? []).filter((standard) => {
      const source = asRecord(standard.raw);
      if (standard.date !== '—' && standard.date !== row.date) return false;
      if (code && firstText(source, ['bizCategorySmallCode', 'operationSubTypeCode']) !== code) return false;
      if (attribute && firstText(source, ['attribute']) !== attribute) return false;
      return true;
    });
    row.candidateCount = candidates.length;
    row.matchStatus = candidates.length ? 'candidate' : 'unverified';
    if (person?.employeeId && row.employeeId === person.employeeId && row.employeeName === '—') {
      row.employeeName = person.employeeName ?? '—';
    }
    const matchingPerson = Boolean(person?.employeeId && row.employeeId === person.employeeId && queryEmployeeId === person.employeeId);
    const singlePersonDate = datePersons.get(row.date)?.size === 1;
    const calculatedRecord = matchingPerson && singlePersonDate
      ? [...places].map((place) => calculatedByDateAndCity.get(`${row.date}:${place}`)).find(Boolean)
      : undefined;
    const amount = code ? calculatedRecord?.[`${code}_standard`] : undefined;
    if (typeof amount === 'string' || (typeof amount === 'number' && Number.isFinite(amount))) {
      row.pageStandardAmount = amount;
    }
    // 多人行程不能用报账人覆盖行内身份。
    if (!row.employeeId && row.employeeName === '—') row.employeeName = '行内未提供';
  }
  const travelDays = new Set(calendar.map(({ date }) => date).filter((date) => date !== '—')).size;
  const candidateRows = calendar.filter(({ matchStatus }) => matchStatus === 'candidate').length;
  const calculatedRows = calendar.filter(({ pageStandardAmount }) => pageStandardAmount !== undefined).length;
  return {
    legacy: true,
    person: {
      employeeId: person?.employeeId ?? '', employeeName: person?.employeeName ?? '',
      postId: person?.postId ?? '', postName: person?.postName ?? '',
    },
    standards, calendar, requests: [],
    metrics: { travelDays, standardCount: standards.length, requestCount: 0, matchedRequestCount: 0 },
    businessSummary: {
      prerequisites: [
        { label: '人员', satisfied: Boolean(person?.employeeId || person?.employeeName), value: person?.employeeName ?? person?.employeeId ?? '未识别' },
        { label: '日期', satisfied: travelDays > 0, value: `${travelDays} 天` },
        { label: '标准缓存', satisfied: standards.length > 0, value: `${standards.length} 条候选标准` },
      ],
      matchedRows: 0, unmatchedRows: 0, exceededRows: 0,
      conclusion: `已读取 ${calendar.length} 条行程，${candidateRows} 条找到候选标准，${calculatedRows} 条读取到宿主逐日计算金额。缓存请求历史和项目定制规则尚未完整核验，不据此判定最终匹配或超标。`,
    },
  };
}
