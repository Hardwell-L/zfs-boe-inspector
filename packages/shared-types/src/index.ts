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

export interface PickerState {
  active: boolean;
  selection?: FieldSelection;
  hoveredDomId?: string;
  error?: string;
}

export interface BridgeStatus {
  apiVersion: typeof BRIDGE_API_VERSION;
  connected: boolean;
  activeInstanceId?: string;
  instances: Array<{
    instanceId: string;
    boeTypeCode?: string;
    sources: string[];
  }>;
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
