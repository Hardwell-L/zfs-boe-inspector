import type { JsonValue, TravelInspectionData } from '@zfs-boe-inspector/shared-types';

type RecordValue = Record<string, JsonValue | undefined>;
export interface TransportInvoiceRow {
  key: string;
  source: string;
  employeeName: string;
  date: string;
  city: string;
  seat: string;
  status: 'missing' | 'matched' | 'unmatched' | 'no-standard' | 'unverified';
  result: string;
  controlType: string;
  candidateControlTypes?: string[];
  evidence: string;
  standardCandidates?: Array<{ transportation: string; transportationName: string; controlType: string }>;
}

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  // Serializer 保留 undefined 标记；还原为空值，同时保留票面覆盖主行的语义。
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key, item && typeof item === 'object' && item.__kind === 'undefined' ? undefined : item,
  ]));
}
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}
function date(value: unknown): string {
  return text(value).match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? '';
}
function incomplete(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const kind = (value as RecordValue).__kind;
  if (kind) return kind !== 'undefined';
  return Object.values(value).some(incomplete);
}

// 只读取快照，沿用宿主 InvoiceClass 的票面覆盖、航段和日期取值规则。
export function buildTransportInvoiceRows(travel?: TravelInspectionData): TransportInvoiceRow[] {
  if (!Array.isArray(travel?.transportInvoices)) return [];
  const personId = travel.currentPerson?.employeeId;
  // 日历中的人员不能证明发票归属，必须有组件或发票上的明确身份。
  const sourcePersonId = travel.transportInvoiceEmployeeId;
  const scopedPerson = Boolean(personId && sourcePersonId === personId);
  return travel.transportInvoices.flatMap((item, index) => {
    const bill = record(item);
    if (bill.__kind) return [{
      key: `${index}`, source: `第 ${index + 1} 行`, employeeName: '待确认', date: '—', city: '—', seat: '—',
      status: 'unverified' as const, result: '关联信息不完整', controlType: '—', evidence: '发票数据采集不完整，无法核对。',
    }];
    if (bill.attribute !== 'CLJT' || bill.typeOfBusiness || ['Returned', 'Changed', 'Change'].includes(text(bill.flightStatus))) return [];
    const billPersonId = text(bill.employeeId).trim();
    const personConflict = Boolean(personId && ((billPersonId && billPersonId !== personId)
      || (sourcePersonId && sourcePersonId !== personId)));
    const knownPerson = Boolean(personId && !personConflict && !incomplete(bill.employeeId)
      && (scopedPerson || billPersonId === personId));
    const invoicePersonName = text(bill.employeeName) || text(bill.passengerName) || billPersonId;
    const employeeName = personConflict ? `${invoicePersonName || '发票人员待确认'}（人员归属冲突）`
      : knownPerson ? travel.currentPerson?.employeeName || invoicePersonName || personId || '待确认'
        : invoicePersonName ? `${invoicePersonName}（归属待确认）` : '待确认';
    const ticket = record(bill.ticketData);
    const info = { ...bill, ...ticket };
    const type = text(bill.billTypeInvoice);
    const segments = bill.opTicketDetailsList;
    // 宿主有航段列表时不再用发票主行坐席替代航段坐席。
    const useSegments = Boolean(segments);
    const validSegments = Array.isArray(segments) && segments.length > 0 && ['4', '38'].includes(type);
    const travels: RecordValue[] = useSegments
      ? validSegments ? segments.map((segment) => {
        const source = record(segment);
        // 保留当前航段的采集标记，不能将截断对象转换成“坐席为空”。
        if (source.__kind) return source;
        const details = source.ticketDetailsData;
        return details && typeof details === 'object' && !Array.isArray(details)
          ? record(details) : { __kind: 'unavailable' };
      }) : [{ __kind: 'unavailable' }]
      : [info];
    return travels.map((entry, segmentIndex): TransportInvoiceRow => {
      const seatCode = text(entry.seatLevel);
      const seatName = text(entry.seatLevelName);
      const cityValue = useSegments ? entry.destinationName : info.arriveCityName;
      const dateValue = useSegments ? entry.departDate
        : ['5', '2', '10', '8', '39'].includes(type) ? ticket.tripDate
          : ['23', '6', '37'].includes(type) ? bill.tripDate : type === '7' ? bill.checkinDate : undefined;
      const city = text(cityValue);
      const tripDate = useSegments ? text(dateValue) : date(dateValue);
      const code = bill.operationSubTypeCode;
      const cacheKey = `${city}_${tripDate}`;
      const rawStandards = travel.standardResults?.[cacheKey];
      const standards = Array.isArray(rawStandards) ? rawStandards.map(record) : [];
      const sameBusiness = standards.filter((standard) => !code || standard.bizCategorySmallCode === code);
      const candidateEvidence = sameBusiness.map((standard) => text(standard.transportation)).filter(Boolean).join('；');
      const basis = `缓存键：${cacheKey}；业务小类：${text(bill.operationSubTypeName) || '—'}（${text(code) || '未提供，不筛选小类'}）；seatLevel：${seatCode || '空'}。`;
      const row: TransportInvoiceRow = {
        key: `${index}-${segmentIndex}`, source: `第 ${index + 1} 行${useSegments ? ` / 航段 ${segmentIndex + 1}` : ''}`,
        employeeName,
        date: tripDate || '—', city: city || '—', seat: seatName && seatCode ? `${seatName}（${seatCode}）` : seatCode || seatName || '—',
        status: 'unverified', result: '关联信息不完整', controlType: '—', evidence: basis,
      };
      if (personConflict) row.evidence += '发票或来源组件人员与当前标准人员不一致，不使用当前人员标准核对。';
      // 只检查当前坐席来源；附件或其他航段不完整，不应掩盖明确的空坐席。
      const seatSourceUnavailable = Boolean(entry.__kind || (!useSegments && ticket.__kind))
        || incomplete(entry.seatLevel);
      if (seatSourceUnavailable) {
        row.evidence += '当前票面或航段坐席数据未完整采集，无法核对。';
      } else if (!seatCode.trim()) {
        row.status = 'missing'; row.result = '坐席缺失';
        row.evidence += 'seatLevel 为空，无法进行交通标准匹配。';
      } else if ((travel.collection && travel.collection.status !== 'complete') || travel.inspectionMode === 'legacy' || !knownPerson || !city.trim() || !date(tripDate)
        || [cityValue, dateValue, code, bill.billTypeInvoice, bill.flightStatus].some(incomplete)) {
        row.evidence += '人员、日期或地点关联未确认，或仅有低版本候选缓存，不判定最终匹配。';
        const legacyCandidates = travel.inspectionMode === 'legacy' ? travel.standardResults?.[city] : undefined;
        const candidates = candidateEvidence || (Array.isArray(legacyCandidates) ? legacyCandidates.map(record)
          .filter((standard) => !code || standard.bizCategorySmallCode === code)
          .map((standard) => text(standard.transportation)).filter(Boolean).join('；') : '');
        if (candidates) row.evidence += `候选坐席：${candidates}。`;
      } else if (incomplete(rawStandards)) {
        row.evidence += '标准采集不完整，无法核对。';
      } else if (!sameBusiness.length) {
        row.status = 'no-standard'; row.result = '未采集到对应标准';
        row.evidence += '未找到对应日期、到达城市及业务小类的标准。';
      } else {
        // 保留宿主的两次排序及比较器，不能改成简单的允许坐席集合。
        const matches = sameBusiness.filter((standard) => text(standard.transportation).split('^').includes(seatCode))
          .sort((a, b) => Number(b.priority) - Number(a.priority))
          .sort((a, b) => {
            if (a.controlType === 'FORBID' && b.controlType !== 'FORBID') return -1;
            if (a.controlType === 'WARNING' && b.controlType === 'ALLOW') return -1;
            return 0;
          });
        const matched = matches[0];
        row.status = matched ? 'matched' : 'unmatched';
        row.result = matched ? '已命中规则' : '坐席超标';
        row.standardCandidates = sameBusiness.map((standard) => ({
          transportation: text(standard.transportation),
          transportationName: text(standard.transportationName),
          controlType: text(standard.controlType) || '未提供',
        }));
        row.controlType = matched ? text(matched.controlType) || '规则未提供' : '未命中规则';
        if (!matched) {
          // 候选规则的控制方式仅供排查，不能当作该发票已命中的控制方式。
          row.candidateControlTypes = [...new Set(sameBusiness.map((standard) => text(standard.controlType) || '未提供'))];
        }
        row.evidence += matched
          ? `匹配依据：transportation 按 ^ 拆分后精确包含 seatLevel；优先级：${text(matched.priority) || '未提供'}；坐席规则：${text(matched.transportation)}。命中不等于符合标准，需结合控制方式。`
          : `对应规则未包含该坐席编码。候选坐席：${sameBusiness.map((standard) => `${text(standard.transportation) || '未提供'}（控制方式：${text(standard.controlType) || '未提供'}）`).join('；')}。`;
      }
      return row;
    });
  });
}
