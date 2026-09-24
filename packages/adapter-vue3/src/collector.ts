import {
  SNAPSHOT_SCHEMA_VERSION,
  type ApplyBoeEvidenceSnapshot,
  type BoeInspectionSnapshot,
  type CompatibilityMetadata,
  type FieldPropertyDescriptor,
  type FieldRuntimeState,
  type JsonValue,
  type RuntimeMetadata,
  type TravelInspectionData,
} from '@zfs-boe-inspector/shared-types';
import { toSerializable, type SerializeOptions } from './serialize';
import type { TraceConditionResolver } from './trace';

export interface AdapterOptions {
  projectCode: string;
  environment: string;
  adapterVersion?: string;
  zfsPackages?: Record<string, string>;
  vueVersion?: string;
  compatibility?: CompatibilityMetadata;
  traceSupported?: boolean;
  legacyMode?: boolean;
  serialization?: SerializeOptions;
}

export interface CollectorContribution {
  meta?: Partial<RuntimeMetadata>;
  runtime?: Partial<BoeInspectionSnapshot['runtime']>;
  config?: Partial<BoeInspectionSnapshot['config']>;
  travel?: TravelInspectionData;
  applyBoe?: ApplyBoeEvidenceSnapshot;
  warnings?: string[];
}

export interface RuntimeCollector {
  source: 'bill-template' | 'travel';
  getInstanceId(): string;
  getBoeTypeCode?(): string | undefined;
  collect(): CollectorContribution;
  getTraceConditions?: TraceConditionResolver;
}

export interface BillTemplateComponentLike {
  $parent?: BillTemplateComponentLike | null;
  $children?: BillTemplateComponentLike[];
  $el?: unknown;
  $options?: {
    name?: string;
    _base?: { version?: string };
  };
  $?: {
    type?: {
      name?: string;
    };
  };
  $root?: BillTemplateComponentLike;
  template?: unknown[];
  data?: Record<string, unknown>;
  billInfo?: Record<string, unknown>;
  billStatus?: string | number;
  pageMode?: string;
  operationTypeCode?: string;
  sourceSystemCode?: string;
  shareNode?: boolean;
}

export interface BillTemplateCollectorOptions {
  getInstanceId?: () => string;
  areaConfig?: Record<string, unknown[]>;
  fieldConfig?: Record<string, unknown[]>;
  getFormattedBoeDto?: () => unknown;
  getDynamicConfig?: (args: Record<string, unknown>) => boolean | Record<string, unknown> | void;
  getApplySnapshot?: (
    component: BillTemplateComponentLike,
  ) => ApplyBoeEvidenceSnapshot | undefined;
  getTraceConditions?: TraceConditionResolver;
  compatibility?: CompatibilityMetadata;
  serialization?: SerializeOptions;
  legacyMode?: boolean;
}

export interface TravelComponentLike extends BillTemplateComponentLike {
  standardParams?: Record<string, unknown>;
  calendarData?: unknown[];
  person?: Record<string, unknown>;
  standardAmount?: Record<string, unknown>;
  standardAmountParamsObj?: Record<string, unknown[]>;
  standardDates?: unknown[];
  standardSummary?: unknown;
  summary?: unknown;
  travelList?: unknown[];
}

export interface TravelCollectorOptions {
  getInstanceId?: () => string;
  getTrips?: () => unknown[];
  getTravelerNames?: () => string[];
  getClaimantNames?: () => string[];
  compatibility?: CompatibilityMetadata;
  serialization?: SerializeOptions;
  legacyMode?: boolean;
}

function header(component: BillTemplateComponentLike): Record<string, any> {
  const data = component.data ?? {};
  const rows = data.boeHeader;
  return Array.isArray(rows) && rows[0] && typeof rows[0] === 'object'
    ? rows[0] as Record<string, any>
    : {};
}

const fallbackIds = new WeakMap<object, string>();
let fallbackSequence = 0;

export function deriveInstanceId(component: BillTemplateComponentLike, legacyMode = false): string {
  const info = component.billInfo ?? {};
  const row = header(component);
  const boeTypeCode = String(info.boeTypeCode ?? row.boeTypeCode ?? 'UNKNOWN');
  if (!legacyMode) return `${boeTypeCode}:${String(row.boeId ?? row.id ?? row.billId ?? row.boeNo ?? 'active')}`;
  const billId = info.boeHeaderId ?? info.boeId ?? info.boeNo ?? row.boeId ?? row.id ?? row.billId ?? row.boeNo ?? row.boeHeaderId;
  if (billId === undefined || billId === null || String(billId).trim() === '') {
    const existing = fallbackIds.get(component);
    if (existing) return existing;
    const generated = `${boeTypeCode}:instance-${++fallbackSequence}`;
    fallbackIds.set(component, generated);
    return generated;
  }
  return `${boeTypeCode}:${String(billId)}`;
}

function getMeta(component: BillTemplateComponentLike): Partial<RuntimeMetadata> {
  const info = component.billInfo ?? {};
  const row = header(component);
  const result: Partial<RuntimeMetadata> = {};
  type StringMetaKey = 'boeTypeCode' | 'boeStatus' | 'operationTypeCode' | 'sourceSystemCode' | 'pageMode';
  const values: Array<[StringMetaKey, unknown]> = [
    ['boeTypeCode', info.boeTypeCode ?? row.boeTypeCode],
    ['boeStatus', component.billStatus ?? row.boeStatus],
    ['operationTypeCode', component.operationTypeCode ?? info.operationTypeCode ?? row.operationTypeCode],
    ['sourceSystemCode', component.sourceSystemCode ?? info.sourceSystemCode ?? row.sourceSystemCode],
    ['pageMode', component.pageMode],
  ];
  for (const [key, value] of values) {
    if (value !== undefined && value !== null) result[key] = String(value);
  }
  return result;
}

function normalizeDescriptors(fieldConfig?: Record<string, unknown[]>): Record<string, FieldPropertyDescriptor[]> | undefined {
  if (!fieldConfig) return undefined;
  const result: Record<string, FieldPropertyDescriptor[]> = {};
  for (const [fieldType, descriptors] of Object.entries(fieldConfig)) {
    result[fieldType] = descriptors.flatMap((descriptor) => {
      if (!descriptor || typeof descriptor !== 'object') return [];
      const record = descriptor as Record<string, unknown>;
      if (!record.code) return [];
      const item: FieldPropertyDescriptor = {
        code: String(record.code),
        label: String(record.label ?? record.name ?? record.code),
        classify: String(record.classify ?? 'base'),
      };
      if (record.type !== undefined) item.type = String(record.type);
      if (record.tips !== undefined) item.tips = String(record.tips);
      return [item];
    });
  }
  return result;
}

function collectRuntimeStates(
  component: BillTemplateComponentLike,
  getDynamicConfig?: BillTemplateCollectorOptions['getDynamicConfig'],
): FieldRuntimeState[] | undefined {
  if (!getDynamicConfig || !Array.isArray(component.template)) return undefined;
  const states: FieldRuntimeState[] = [];
  for (const areaValue of component.template) {
    if (!areaValue || typeof areaValue !== 'object') continue;
    const area = areaValue as Record<string, any>;
    const areaCode = String(area.areaCode ?? '');
    const rows = Array.isArray(component.data?.[areaCode]) ? component.data?.[areaCode] as unknown[] : [];
    const fields = Array.isArray(area.areaFields) ? area.areaFields : [];
    const rowCount = Math.max(rows.length, 1);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      for (const fieldValue of fields) {
        if (!fieldValue || typeof fieldValue !== 'object') continue;
        const field = { ...(fieldValue as Record<string, unknown>) };
        const fieldCode = String(field.fieldCode ?? '');
        if (!fieldCode) continue;
        const state: FieldRuntimeState = { areaCode, fieldCode, rowIndex };
        const errors: string[] = [];
        const evaluateControl = (controlName: 'show' | 'edit' | 'require') => {
          try {
            const result = getDynamicConfig({
              billData: {
                data: component.data ?? {},
                billInfo: component.billInfo ?? {},
                billStatus: component.billStatus,
                shareNode: component.shareNode,
              },
              sourceType: 'pc',
              controlName,
              field,
              areaCode,
              rowIndex,
              out: {},
            });
            if (typeof result === 'boolean') return result;
            if (result && typeof result === 'object') {
              const flag = (result as Record<string, unknown>)[`_${controlName}Flag`];
              if (flag === 'on') return true;
              if (flag === 'off') return false;
            }
            return Boolean(result);
          } catch (error) {
            errors.push(`${controlName}: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
          }
        };
        const visible = evaluateControl('show');
        const editable = evaluateControl('edit');
        const required = evaluateControl('require');
        if (visible !== undefined) state.visible = visible;
        if (editable !== undefined) state.editable = editable;
        if (required !== undefined) state.required = required;
        if (errors.length > 0) {
          state.evaluationError = errors.join('; ');
        }
        const row = rows[rowIndex];
        if (row && typeof row === 'object') {
          state.value = toSerializable((row as Record<string, unknown>)[fieldCode]);
        }
        states.push(state);
      }
    }
  }
  return states;
}

export function createBillTemplateCollector(
  component: BillTemplateComponentLike,
  options: BillTemplateCollectorOptions = {},
): RuntimeCollector {
  const areaDescriptors = normalizeDescriptors(options.areaConfig);
  const fieldDescriptors = normalizeDescriptors(options.fieldConfig);
  return {
    source: 'bill-template',
    getInstanceId: () => options.getInstanceId?.() ?? deriveInstanceId(component, options.legacyMode),
    getBoeTypeCode: () => getMeta(component).boeTypeCode,
    ...(options.getTraceConditions ? { getTraceConditions: options.getTraceConditions } : {}),
    collect: () => {
      const warnings: string[] = [];
      let compatibility = options.compatibility;
      if (options.legacyMode && !Array.isArray(component.template)) {
        warnings.push('bill template 尚未加载，字段配置与字段运行时状态暂不可用');
        const reasons = [
          ...(options.compatibility?.collection?.reasons ?? []),
          'template-not-ready',
        ];
        compatibility = {
          ...(options.compatibility ?? {}),
          fieldRuntime: 'unavailable',
          collection: { status: 'unavailable', reasons },
        };
      }
      let formattedBoeDto: JsonValue | undefined;
      let formattedDtoStatus: 'available' | 'unavailable' | 'skipped' = 'skipped';
      if (options.getFormattedBoeDto) {
        try {
          formattedBoeDto = toSerializable(options.getFormattedBoeDto(), options.serialization);
          formattedDtoStatus = 'available';
        } catch (error) {
          formattedDtoStatus = 'unavailable';
          warnings.push(`格式化 DTO 读取失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      const runtime: CollectorContribution['runtime'] = {
        rawBillData: toSerializable(component.data ?? {}, options.serialization),
        formattedDtoStatus,
      };
      if (formattedBoeDto !== undefined) runtime.formattedBoeDto = formattedBoeDto;
      const config: CollectorContribution['config'] = {
        template: toSerializable(component.template ?? [], options.serialization) as JsonValue[],
      };
      if (areaDescriptors) config.areaDescriptors = areaDescriptors;
      if (fieldDescriptors) config.fieldDescriptors = fieldDescriptors;
      const fieldRuntimeStates = options.legacyMode ? undefined : collectRuntimeStates(component, options.getDynamicConfig);
      if (fieldRuntimeStates) config.fieldRuntimeStates = fieldRuntimeStates;
      let applyBoe: ApplyBoeEvidenceSnapshot | undefined;
      if (options.getApplySnapshot) {
        try {
          const snapshot = options.getApplySnapshot(component);
          if (snapshot) {
            applyBoe = toSerializable(snapshot, options.serialization) as unknown as ApplyBoeEvidenceSnapshot;
          }
        } catch (error) {
          warnings.push(`关联申请快照读取失败：${error instanceof Error ? error.message : String(error)}`);
        }
      }
      return {
        meta: { ...getMeta(component), ...(compatibility ? { compatibility } : {}) },
        runtime,
        config,
        ...(applyBoe ? { applyBoe } : {}),
        warnings,
      };
    },
  };
}

function requestMetadata(component: TravelComponentLike) {
  const requests: Array<{ cacheKey?: string; boeDate?: string; schemeCode?: string; status: 'unknown' }> = [];
  for (const [cacheKey, items] of Object.entries(component.standardAmountParamsObj ?? {})) {
    if (!Array.isArray(items)) continue;
    for (const value of items) {
      if (!value || typeof value !== 'object') continue;
      const item = value as Record<string, unknown>;
      const request: { cacheKey?: string; boeDate?: string; schemeCode?: string; status: 'unknown' } = { cacheKey, status: 'unknown' };
      if (item.boeDate !== undefined) request.boeDate = String(item.boeDate).slice(0, 10);
      if (item.schemeCode !== undefined) request.schemeCode = String(item.schemeCode);
      requests.push(request);
    }
  }
  return requests;
}

function cacheMode(value: unknown): CompatibilityMetadata['travelCacheMode'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'unknown';
  const keys = Object.keys(value);
  if (!keys.length) return 'unknown';
  const dated = keys.filter((key) => /\d{4}-\d{2}-\d{2}/.test(key));
  if (dated.length === keys.length) return 'date-site';
  if (dated.length === 0) return 'site';
  return 'mixed';
}

function defaultNames(component: TravelComponentLike, keys: string[]): string[] {
  const row = header(component);
  return keys.flatMap((key) => {
    const value = row[key];
    if (Array.isArray(value)) return value.map(String);
    if (typeof value === 'string') return value.split(/[,，]/).map((item) => item.trim()).filter(Boolean);
    return [];
  });
}

function currentPerson(component: TravelComponentLike): TravelInspectionData['currentPerson'] | undefined {
  const person = component.person ?? {};
  const row = header(component);
  const read = (keys: string[]) => {
    for (const key of keys) {
      const value = person[key] ?? row[key];
      if ((typeof value === 'string' || typeof value === 'number') && String(value).trim()) return String(value).trim();
    }
    return undefined;
  };
  const result: NonNullable<TravelInspectionData['currentPerson']> = {};
  const employeeId = read(['employeeId', 'empId', 'travelerId']);
  const employeeName = read(['employeeName', 'empName', 'travelerName', 'name']);
  const postId = read(['postId', 'employeePostId', 'employeePost', 'postCode']);
  const postName = read(['postName', 'employeePostName']);
  if (employeeId) result.employeeId = employeeId;
  if (employeeName) result.employeeName = employeeName;
  if (postId) result.postId = postId;
  if (postName) result.postName = postName;
  return Object.keys(result).length > 0 ? result : undefined;
}

export function createTravelCollector(
  component: TravelComponentLike,
  options: TravelCollectorOptions = {},
): RuntimeCollector {
  return {
    source: 'travel',
    getInstanceId: () => options.getInstanceId?.() ?? deriveInstanceId(component, options.legacyMode),
    getBoeTypeCode: () => getMeta(component).boeTypeCode,
    collect: () => {
      if (options.legacyMode) return collectLegacyTravel(component, options);
      const requests = requestMetadata(component);
      const travel: TravelInspectionData = {
        trips: toSerializable(options.getTrips?.() ?? component.travelList ?? []) as JsonValue[],
        calendarData: toSerializable(component.calendarData ?? []) as JsonValue[],
        standardRequests: requests,
        standardResults: toSerializable(component.standardAmount ?? {}) as Record<string, JsonValue>,
        standardDates: toSerializable(component.standardDates ?? []) as JsonValue[],
        standardSummary: toSerializable(component.standardSummary ?? component.summary ?? {}),
        travelerNames: options.getTravelerNames?.() ?? defaultNames(component, ['travelerName', 'travelerNames', 'empName', 'employeeName']),
        claimantNames: options.getClaimantNames?.() ?? defaultNames(component, ['claimantName', 'claimantNames', 'empName', 'employeeName']),
      };
      const person = currentPerson(component);
      if (person) travel.currentPerson = person;
      return { meta: getMeta(component), travel };
    },
  };
}

function collectLegacyTravel(component: TravelComponentLike, options: TravelCollectorOptions): CollectorContribution {
  const serialize = (value: unknown) => toSerializable(value, options.serialization);
  const warnings = ['低版本差旅展示现有日历、查询条件与候选标准；请求历史和最终超标结论未验证'];
  const readOptional = <T>(label: string, read: () => T): T | undefined => {
    try { return read(); } catch {
      warnings.push(`${label}读取失败，其余差旅数据仍可查看`);
      return undefined;
    }
  };
  // 行程保留原始明细；逐日金额另从宿主只读计算结果提取。
  const calendar = readOptional('日历', () => component.data?.zfsBoeCalendarDTOS ?? component.calendarData);
  const conditions = readOptional('标准查询条件', () => component.standardParams);
  // 仅在低版本读取宿主已有的逐日计算结果，不调用会改写单据的校验方法。
  const calculatedCalendar = Array.isArray(component.data?.zfsBoeCalendarDTOS) && component.standardAmount && conditions
    ? readOptional('页面逐日标准', () => component.calendarData)
    : undefined;
  const calculatedCalendarStandards = Array.isArray(calculatedCalendar) ? calculatedCalendar.flatMap((day) => {
    if (!day || typeof day !== 'object' || Array.isArray(day)) return [];
    const record = day as Record<string, unknown>;
    const amounts = Object.fromEntries(Object.entries(record).filter(([key, value]) =>
      key.endsWith('_standard') && (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)))));
    if (!Object.keys(amounts).length) return [];
    return [{ expenseDate: record.expenseDate, travelSite: record.travelSite, ...amounts }];
  }) : [];
  const travel: TravelInspectionData = {
    inspectionMode: 'legacy',
    ...(conditions ? { queryConditions: serialize(conditions) } : {}),
    ...(component.travelList != null || options.getTrips ? { trips: serialize(options.getTrips?.() ?? component.travelList) as JsonValue[] } : {}),
    ...(Array.isArray(calendar) ? { calendarData: serialize(calendar) as JsonValue[] } : {}),
    ...(calculatedCalendarStandards.length ? { calculatedCalendarStandards: serialize(calculatedCalendarStandards) as JsonValue[] } : {}),
    ...(component.standardAmount != null ? { standardResults: serialize(component.standardAmount) as Record<string, JsonValue> } : {}),
    ...(component.standardDates != null ? { standardDates: serialize(component.standardDates) as JsonValue[] } : {}),
    ...(component.standardSummary != null ? { standardSummary: serialize(component.standardSummary) } : {}),
    ...(component.data?.zfsBoeSumAmounts != null ? { billSummary: serialize(component.data.zfsBoeSumAmounts) } : {}),
  };
  const person = readOptional('人员', () => currentPerson(component));
  if (person) travel.currentPerson = person;
  return {
    meta: {
      ...getMeta(component),
      compatibility: {
        travelRequestHistory: 'unavailable',
        travelCacheMode: cacheMode(travel.standardResults) ?? 'unknown',
      },
    },
    travel,
    warnings,
  };
}

export function mergeContributions(
  instanceId: string,
  options: Required<Pick<AdapterOptions, 'projectCode' | 'environment' | 'adapterVersion'>> & AdapterOptions,
  collectors: RuntimeCollector[],
): BoeInspectionSnapshot {
  const snapshot: BoeInspectionSnapshot = {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    instanceId,
    capturedAt: new Date().toISOString(),
    meta: {
      projectCode: options.projectCode,
      environment: options.environment,
      adapterVersion: options.adapterVersion,
    },
    runtime: {
      rawBillData: {},
      formattedDtoStatus: 'skipped',
    },
    config: { template: [] },
  };
  if (options.zfsPackages) snapshot.meta.zfsPackages = options.zfsPackages;
  if (options.vueVersion) snapshot.meta.vueVersion = options.vueVersion;
  if (options.compatibility) snapshot.meta.compatibility = options.compatibility;
  for (const collector of collectors) {
    const contribution = collector.collect();
    const compatibility = contribution.meta?.compatibility
      ? { ...snapshot.meta.compatibility, ...contribution.meta.compatibility }
      : snapshot.meta.compatibility;
    Object.assign(snapshot.meta, contribution.meta);
    if (compatibility) snapshot.meta.compatibility = compatibility;
    Object.assign(snapshot.runtime, contribution.runtime);
    Object.assign(snapshot.config, contribution.config);
    if (contribution.travel) snapshot.travel = contribution.travel;
    if (contribution.applyBoe) snapshot.applyBoe = contribution.applyBoe;
    if (contribution.warnings?.length) {
      snapshot.warnings = [...(snapshot.warnings ?? []), ...contribution.warnings];
    }
  }
  return snapshot;
}
