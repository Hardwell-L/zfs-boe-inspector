import {
  BRIDGE_API_VERSION,
  type AreaDetail,
  type BoeInspectionSnapshot,
  type BridgeStatus,
  type FieldDetail,
  type FieldSelection,
  type PickerState,
} from '@zfs-boe-inspector/shared-types';
import {
  mergeContributions,
  type AdapterOptions,
  type RuntimeCollector,
} from './collector';
import { getAreaDetail, getFieldDetail } from './fieldInspector';
import { FieldPicker } from './picker';

export interface BoeInspectorBridge {
  getStatus(): BridgeStatus;
  getSnapshot(instanceId?: string): BoeInspectionSnapshot;
  getAreaDetail(areaCode: string, instanceId?: string): AreaDetail | undefined;
  getFieldDetail(selection: FieldSelection, instanceId?: string): FieldDetail | undefined;
  startFieldPicker(): PickerState;
  getFieldPickerState(): PickerState;
  cancelFieldPicker(): PickerState;
}

interface CollectorRegistration {
  token: symbol;
  collector: RuntimeCollector;
  order: number;
}

export class BoeInspectorRuntime {
  private readonly options: Required<Pick<AdapterOptions, 'projectCode' | 'environment' | 'adapterVersion'>> & AdapterOptions;
  private readonly registrations: CollectorRegistration[] = [];
  private readonly picker = new FieldPicker();
  private sequence = 0;

  constructor(options: AdapterOptions) {
    this.options = {
      ...options,
      adapterVersion: options.adapterVersion ?? '0.1.0',
    };
  }

  register(collector: RuntimeCollector): () => void {
    const token = Symbol(collector.source);
    this.registrations.push({ token, collector, order: this.sequence += 1 });
    return () => {
      const index = this.registrations.findIndex((registration) => registration.token === token);
      if (index >= 0) this.registrations.splice(index, 1);
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
    return this.picker.start();
  }

  getFieldPickerState(): PickerState {
    return this.picker.getState();
  }

  cancelFieldPicker(): PickerState {
    return this.picker.cancel();
  }

  createBridge(): BoeInspectorBridge {
    return {
      getStatus: () => this.getStatus(),
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
