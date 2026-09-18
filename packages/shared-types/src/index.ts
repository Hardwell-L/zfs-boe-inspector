export const SNAPSHOT_SCHEMA_VERSION = 1 as const;
export const BRIDGE_API_VERSION = 1 as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface RuntimeMetadata {
  projectCode: string;
  environment: string;
  adapterVersion: string;
  zfsPackages?: Record<string, string>;
  vueVersion?: string;
  boeTypeCode?: string;
  boeStatus?: string;
  operationTypeCode?: string;
  sourceSystemCode?: string;
  pageMode?: string;
}

export interface FieldPropertyDescriptor {
  code: string;
  label: string;
  classify: 'base' | 'advance' | 'data' | string;
  type?: string;
  tips?: string;
}

export interface FieldRuntimeState {
  areaCode: string;
  fieldCode: string;
  rowIndex: number;
  value?: JsonValue;
  visible?: boolean;
  editable?: boolean;
  required?: boolean;
  evaluationError?: string;
}

export interface TravelStandardRequest {
  cacheKey?: string;
  boeDate?: string;
  schemeCode?: string;
  status?: 'pending' | 'fulfilled' | 'rejected' | 'unknown';
}

export interface TravelInspectionData {
  trips?: JsonValue[];
  calendarData?: JsonValue[];
  standardRequests?: TravelStandardRequest[];
  standardResults?: Record<string, JsonValue>;
  standardDates?: JsonValue[];
  standardSummary?: JsonValue;
  travelerNames?: string[];
  claimantNames?: string[];
  currentPerson?: {
    employeeId?: string;
    employeeName?: string;
    postId?: string;
    postName?: string;
  };
}

export interface ApplyBoeEvidenceSnapshot {
  lastApplyBoeData: JsonValue[];
  lastTransData: JsonValue;
  flowStatus?: JsonValue;
}

export interface BoeInspectionSnapshot {
  schemaVersion: typeof SNAPSHOT_SCHEMA_VERSION;
  instanceId: string;
  capturedAt: string;
  meta: RuntimeMetadata;
  runtime: {
    rawBillData: JsonValue;
    formattedBoeDto?: JsonValue;
    formattedDtoStatus?: 'available' | 'unavailable' | 'skipped';
  };
  config: {
    template: JsonValue[];
    areaDescriptors?: Record<string, FieldPropertyDescriptor[]>;
    fieldDescriptors?: Record<string, FieldPropertyDescriptor[]>;
    fieldRuntimeStates?: FieldRuntimeState[];
  };
  travel?: TravelInspectionData;
  applyBoe?: ApplyBoeEvidenceSnapshot;
  warnings?: string[];
}

export type RuleCategory =
  | 'field-config'
  | 'travel-standard'
  | 'validation-rule'
  | 'calculation-rule'
  | 'dynamic-rule'
  | 'apply-boe';
export type RuleStatus = 'passed' | 'issue' | 'skipped';
export type RuleSeverity = 'info' | 'warning' | 'error';

export interface RuleEvaluation {
  ruleId: string;
  category: RuleCategory;
  status: RuleStatus;
  severity?: RuleSeverity;
  summary: string;
  reason?: string;
  actual?: JsonValue;
  expected?: JsonValue;
  evidencePaths: string[];
  suggestion?: string;
}

export interface InspectionReport {
  reportVersion: 1;
  generatedAt: string;
  snapshot: BoeInspectionSnapshot;
  evaluations: RuleEvaluation[];
  summary: {
    passed: number;
    issues: number;
    skipped: number;
    errors: number;
    warnings: number;
    infos: number;
  };
}

export interface FieldSelection {
  areaCode: string;
  fieldCode: string;
  rowIndex: number;
  /** 原始 areaFields 配置索引，与数据行号无关。 */
  fieldIndex?: number;
  domId?: string;
}

export interface FieldDetail {
  selection: FieldSelection;
  field: JsonValue;
  area: JsonValue;
  value?: JsonValue;
  runtimeState?: FieldRuntimeState;
  groups: Array<{
    key: string;
    label: string;
    items: Array<FieldPropertyDescriptor & { value?: JsonValue }>;
  }>;
}

export interface AreaDetail {
  areaCode: string;
  area: JsonValue;
  groups: Array<{
    key: string;
    label: string;
    items: Array<FieldPropertyDescriptor & { value?: JsonValue }>;
  }>;
}

export interface PickerOptions {
  continuous?: boolean;
}

export interface PickerState {
  targets?: InspectionSelection[];
  active: boolean;
  selection?: FieldSelection;
  target?: InspectionSelection;
  hoveredDomId?: string;
  error?: string;
}

export interface BridgeStatus {
  apiVersion: typeof BRIDGE_API_VERSION;
  connected: boolean;
  capabilities?: string[];
  activeInstanceId?: string;
  instances: Array<{
    instanceId: string;
    boeTypeCode?: string;
    sources: string[];
  }>;
}

export type InspectionSelection =
  | ({ kind: 'field' } & FieldSelection)
  | { kind: 'area'; areaCode: string; rowIndexes?: number[] }
  | { kind: 'bill' };

export interface DependencyDetail {
  reference: string;
  areaCode: string;
  areaName: string;
  fieldCode: string;
  fieldName: string;
  purpose: string;
  resolution: string;
  values: Array<{
    rowIndex: number;
    status: 'value' | 'missing' | 'unavailable' | 'truncated';
    value?: JsonValue;
    description?: JsonValue;
    evidencePath: string;
  }>;
  omittedRows: number;
}

export interface TraceTrigger {
  areaCode: string;
  fieldCode: string;
  rowIndex?: number;
  value?: JsonValue;
  source: 'argument' | 'entry-value' | 'event-before' | 'unavailable';
  reason?: 'legacy-adapter' | 'data-unavailable' | 'invalid-row' | 'row-missing' | 'field-missing' | 'read-error';
}

export interface TraceConditionDefinition {
  key: string;
  ruleId?: string;
  label?: string;
  expression?: JsonValue;
}

export interface TraceConditionRef {
  key: string;
  result: 'matched' | 'not-matched' | 'unknown';
}

export interface TraceStopDetail {
  code:
    | 'user'
    | 'event-limit'
    | 'size-limit'
    | 'recursion-depth'
    | 'event-storm'
    | 'resolver-slow'
    | 'instance-changed';
  threshold?: number;
  observed?: number;
  method?: string;
  eventId?: string;
}

export interface TraceEvent {
  id: string;
  parentId?: string;
  at: string;
  method: string;
  category: string;
  status: 'returned' | 'threw' | 'pending' | 'observed';
  input?: JsonValue;
  output?: JsonValue;
  before?: JsonValue;
  after?: JsonValue;
  error?: string;
  areaCode?: string;
  fieldCode?: string;
  rowIndex?: number;
  triggers?: TraceTrigger[];
  triggersOmitted?: number;
  conditions?: TraceConditionRef[];
}

export interface TraceSession {
  id: string;
  instanceId: string;
  active: boolean;
  startedAt: string;
  stoppedAt?: string;
  reason?: string;
  events: TraceEvent[];
  coverage: Array<{ method: string; supported: boolean }>;
  limitations: string[];
  startSnapshot: BoeInspectionSnapshot;
  endSnapshot?: BoeInspectionSnapshot;
  conditionDefinitions?: TraceConditionDefinition[];
  stopDetail?: TraceStopDetail;
  suppressedEvents?: number;
}

/** 按已接收事件数量读取；事件结束顺序可能与 id 顺序不同。 */
export interface TraceCursor {
  sessionId: string;
  offset: number;
  ended?: boolean;
}

export interface TraceUpdate extends Omit<TraceSession, 'startSnapshot' | 'conditionDefinitions'> {
  reset: boolean;
  eventOffset: number;
  startSnapshot?: BoeInspectionSnapshot;
  conditionDefinitions?: TraceConditionDefinition[];
}

export interface ModelInspectionContext {
  snapshot: BoeInspectionSnapshot;
  deterministicResults: RuleEvaluation[];
}

export interface ModelRequestOptions {
  timeout: number;
  maxOutputTokens: number;
}

export interface ModelDiagnosticResult {
  category: string;
  severity: 'info' | 'warning';
  summary: string;
  reason: string;
  evidencePaths: string[];
  suggestion: string;
  confidence: number;
}

export interface ModelProvider {
  id: string;
  name: string;
  check(
    context: ModelInspectionContext,
    options: ModelRequestOptions,
  ): Promise<ModelDiagnosticResult[]>;
}
