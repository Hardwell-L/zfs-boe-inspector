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
  raw: JsonValue;
}

export interface TravelCalendarRow {
  date: string;
  travelSite: string;
  staySite: string;
  employeeId: string;
  employeeName: string;
  amount?: number | string;
  matchedStandardAmount?: number;
  overAmount?: number;
  matchStatus: 'matched' | 'unmatched' | 'unverified';
  raw: JsonValue;
}

export interface TravelRequestRow extends TravelStandardRequest {
  matched: boolean;
}

export interface TravelViewModel {
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
      if (!record) return [];
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
    if (!record) return [];
    const row: TravelCalendarRow = {
      date: dateFrom(record) || '—',
      travelSite: firstText(record, ['travelSite', 'destination', 'cityName']) || '—',
      staySite: firstText(record, ['staySite', 'accommodationSite']) || '—',
      employeeId: firstText(record, ['employeeId', 'empId', 'travelerId']),
      employeeName: firstText(record, ['employeeName', 'empName', 'travelerName']) || '—',
      matchStatus: 'unverified',
      raw: item,
    };
    const amount = firstAmount(record);
    if (amount !== undefined) row.amount = amount;
    return [row];
  });
  const employeeId = travel.currentPerson?.employeeId;
  if (!employeeId) return rows;
  const currentRows = rows.filter((row) => row.employeeId === employeeId);
  return currentRows.length > 0 ? currentRows : rows;
}

export function buildTravelView(travel?: TravelInspectionData): TravelViewModel {
  const standards = travel ? standardRows(travel) : [];
  const calendar = travel ? calendarRows(travel) : [];
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
