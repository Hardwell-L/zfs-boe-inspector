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
  const person = travel?.currentPerson;
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
  };
}
