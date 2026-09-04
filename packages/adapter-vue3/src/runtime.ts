import {
  BRIDGE_API_VERSION,
  type AreaDetail,
  type BoeInspectionSnapshot,
  type BridgeStatus,
  type FieldDetail,
  type FieldSelection,
  type PickerState,
  type PickerOptions,
  type InspectionSelection,
  type TraceSession,
} from '@zfs-boe-inspector/shared-types';
import {
  mergeContributions,
  type AdapterOptions,
  type RuntimeCollector,
} from './collector';
import { getAreaDetail, getFieldDetail } from './fieldInspector';
import { FieldPicker } from './picker';
import { TraceRecorder, type TraceTarget } from './trace';

export interface BoeInspectorBridge {
  getStatus(): BridgeStatus;
  getSnapshot(instanceId?: string): BoeInspectionSnapshot;
  getAreaDetail(areaCode: string, instanceId?: string): AreaDetail | undefined;
  getFieldDetail(selection: FieldSelection, instanceId?: string): FieldDetail | undefined;
  startFieldPicker(): PickerState;
  getFieldPickerState(): PickerState;
  cancelFieldPicker(): PickerState;
  startPicker?(mode: 'field' | 'area', instanceId?: string, options?: PickerOptions): PickerState;
  locateSelection?(selection: InspectionSelection, instanceId?: string): boolean;
  startTrace?(instanceId: string): TraceSession;
  stopTrace?(): TraceSession | undefined;
  getTrace?(): TraceSession | undefined;
  clearTrace?(): void;
}

interface CollectorRegistration {
  token: symbol;
  collector: RuntimeCollector;
  order: number;
  target?: TraceTarget;
}

export class BoeInspectorRuntime {
  private readonly options: Required<Pick<AdapterOptions, 'projectCode' | 'environment' | 'adapterVersion'>> & AdapterOptions;
  private readonly registrations: CollectorRegistration[] = [];
  private readonly picker = new FieldPicker();
  private sequence = 0;
  private readonly trace = new TraceRecorder((id) => this.getSnapshot(id));

  constructor(options: AdapterOptions) {
    this.options = {
      ...options,
      adapterVersion: options.adapterVersion ?? '0.2.2',
    };
  }

  register(collector: RuntimeCollector, component?: object): () => void {
    const token = Symbol(collector.source);
    this.registrations.push({ token, collector, order: this.sequence += 1,
      ...(component ? { target: { component, getInstanceId: () => collector.getInstanceId() } } : {}),
    });
    return () => {
      const index = this.registrations.findIndex((registration) => registration.token === token);
      if (index >= 0) {
        if (this.trace.get()?.instanceId === collector.getInstanceId()) this.trace.stop('组件已注销');
        this.registrations.splice(index, 1);
      }
    };
  }

  getStatus(): BridgeStatus {
    const groups = this.groupCollectors();
    const instances = [...groups.entries()].map(([instanceId, registrations]) => {
      const boeTypeCode = registrations.map(({ collector }) => collector.getBoeTypeCode?.()).find(Boolean);
      return {
        instanceId,
        ...(boeTypeCode ? { boeTypeCode } : {}),
        sources: [...new Set(registrations.map(({ collector }) => collector.source))],
      };
    });
    const activeInstanceId = this.activeInstanceId(groups);
    return {
      apiVersion: BRIDGE_API_VERSION,
      connected: instances.length > 0,
      capabilities: ['continuous-picker', 'area-picker', 'locate-selection', 'trace'],
      instances,
      ...(activeInstanceId ? { activeInstanceId } : {}),
    };
  }

  getSnapshot(instanceId?: string): BoeInspectionSnapshot {
    const groups = this.groupCollectors();
    const resolvedId = instanceId ?? this.activeInstanceId(groups);
    if (!resolvedId) throw new Error('当前页面没有已注册的 BOE 实例');
    const registrations = groups.get(resolvedId);
    if (!registrations?.length) throw new Error(`BOE 实例不存在：${resolvedId}`);
    return mergeContributions(resolvedId, this.options, registrations.map(({ collector }) => collector));
  }

  getFieldDetail(selection: FieldSelection, instanceId?: string): FieldDetail | undefined {
    return getFieldDetail(this.getSnapshot(instanceId), selection);
  }

  getAreaDetail(areaCode: string, instanceId?: string): AreaDetail | undefined {
    return getAreaDetail(this.getSnapshot(instanceId), areaCode);
  }

  startFieldPicker(): PickerState {
    return this.startPicker('field');
  }

  getFieldPickerState(): PickerState {
    return this.picker.getState();
  }

  cancelFieldPicker(): PickerState {
    return this.picker.cancel();
  }

  private instanceRoot(instanceId?: string): Element | undefined {
    const groups = this.groupCollectors();
    const id = instanceId ?? this.activeInstanceId(groups);
    const registration = (id ? groups.get(id) : undefined)?.find(({ collector, target }) => collector.source === 'bill-template' && target);
    const element = (registration?.target?.component as { $el?: unknown } | undefined)?.$el;
    if (element instanceof Element) return element;
    if (groups.size > 1) throw new Error('无法确定当前单据的页面范围，请从配置列表选择');
    return undefined;
  }

  startPicker(mode: 'field' | 'area', instanceId?: string, options?: PickerOptions): PickerState {
    const snapshot = this.getSnapshot(instanceId);
    const areaCodes = snapshot.config.template.flatMap((area) => area && typeof area === 'object' && !Array.isArray(area) && typeof area.areaCode === 'string' ? [area.areaCode] : []);
    return this.picker.startSelection(mode, this.instanceRoot(instanceId), areaCodes, options);
  }

  locateSelection(selection: InspectionSelection, instanceId?: string): boolean {
    if (selection.kind === 'bill') return false;
    const root = this.instanceRoot(instanceId) ?? document;
    const ids = selection.kind === 'area' ? [`${selection.areaCode}.billArea`] : [
      selection.domId ?? `${selection.areaCode}.${selection.rowIndex}.${selection.fieldCode}`,
    ];
    if (selection.kind === 'field') {
      const detail = this.getFieldDetail(selection, instanceId);
      const field = detail?.field as Record<string, unknown> | undefined;
      if (typeof field?.labelCode === 'string') ids.push(`${selection.areaCode}.${selection.rowIndex}.${field.labelCode}`);
    }
    const element = ids.flatMap((id) => Array.from(root.querySelectorAll<HTMLElement>(`[id="${CSS.escape(id)}"]`)))
      .find((node) => node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0);
    if (!element) return false;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.animate([{ outline: '3px solid #635bff' }, { outline: '3px solid transparent' }], { duration: 1600 });
    return true;
  }

  createBridge(): BoeInspectorBridge {
    return {
      getStatus: () => this.getStatus(),
      startPicker: (mode, id, options) => this.startPicker(mode, id, options),
      locateSelection: (selection, id) => this.locateSelection(selection, id),
      startTrace: (id) => this.trace.start(id, this.registrations.flatMap(({ target }) => target ? [target] : [])),
      stopTrace: () => this.trace.stop(),
      getTrace: () => this.trace.get(),
      clearTrace: () => this.trace.clear(),
      getSnapshot: (instanceId) => this.getSnapshot(instanceId),
      getAreaDetail: (areaCode, instanceId) => this.getAreaDetail(areaCode, instanceId),
      getFieldDetail: (selection, instanceId) => this.getFieldDetail(selection, instanceId),
      startFieldPicker: () => this.startFieldPicker(),
      getFieldPickerState: () => this.getFieldPickerState(),
      cancelFieldPicker: () => this.cancelFieldPicker(),
    };
  }

  private groupCollectors(): Map<string, CollectorRegistration[]> {
    const groups = new Map<string, CollectorRegistration[]>();
    for (const registration of this.registrations) {
      const instanceId = registration.collector.getInstanceId();
      const group = groups.get(instanceId) ?? [];
      group.push(registration);
      groups.set(instanceId, group);
    }
    return groups;
  }

  private activeInstanceId(groups: Map<string, CollectorRegistration[]>): string | undefined {
    return [...groups.entries()]
      .sort((left, right) => Math.max(...right[1].map(({ order }) => order)) - Math.max(...left[1].map(({ order }) => order)))
      .at(0)?.[0];
  }
}
