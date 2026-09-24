import {
  deriveInstanceId,
  type AdapterOptions,
  type BillTemplateCollectorOptions,
  type BillTemplateComponentLike,
  type TravelComponentLike,
} from './collector';
import { attachBillTemplateInspector, attachTravelInspector, installBoeInspector } from './index';
import { SharedRegistrationPool } from './sharedRegistration';
import { findTravelOwner } from './travelOwner';
import { isSupportedBoeVersion } from './boeVersion';

declare const process: { env?: { NODE_ENV?: string } } | undefined;
declare const require: ((specifier: string) => unknown) | undefined;

interface LegacyDesign {
  areaConfig?: Record<string, unknown[]>;
  fieldConfig?: Record<string, unknown[]>;
}

let cachedLegacyDesign: LegacyDesign | undefined;

function isSupportedHost(): boolean {
  let version: unknown;
  try {
    if (typeof require === 'function') {
      version = (require('@zfs/boe/package.json') as { version?: unknown } | undefined)?.version;
    }
  } catch {
    // 无法识别宿主版本时跳过采集，不向业务生命周期抛出异常。
  }
  return isSupportedBoeVersion(version);
}

function resolveLegacyDesign(): LegacyDesign {
  if (cachedLegacyDesign) return cachedLegacyDesign;
  if (typeof require !== 'function') {
    cachedLegacyDesign = {};
    return cachedLegacyDesign;
  }
  try {
    const loaded = require('@zfs/boe-core/src/config/boeDesign') as {
      areaConfig?: Record<string, unknown[]>;
      fieldConfig?: Record<string, unknown[]>;
    } | undefined;
    cachedLegacyDesign = {
      ...(loaded?.areaConfig ? { areaConfig: loaded.areaConfig } : {}),
      ...(loaded?.fieldConfig ? { fieldConfig: loaded.fieldConfig } : {}),
    };
  } catch {
    cachedLegacyDesign = {};
  }
  return cachedLegacyDesign;
}

export type ZfsBoeInspectorOptions = Partial<AdapterOptions>
  & Pick<BillTemplateCollectorOptions, 'getApplySnapshot' | 'getTraceConditions'>
  & {
    autoTravelCollector?: boolean;
    resolveTravelComponent?: (component: BillTemplateComponentLike) => TravelComponentLike | undefined;
  };

const registrations = new WeakMap<BillTemplateComponentLike, () => void>();
const travelRegistrations = new SharedRegistrationPool<TravelComponentLike>();
const directTravelReleases = new WeakMap<TravelComponentLike, () => void>();

function resolveOptions(component: BillTemplateComponentLike, options: ZfsBoeInspectorOptions): AdapterOptions {
  const vueVersion = component.$root?.$options?._base?.version ?? component.$options?._base?.version;
  // webpack 4 不读取 exports；该物理入口只服务已核实的 Vue2 样本。
  if (vueVersion && !vueVersion.startsWith('2.')) {
    throw new Error('旧构建入口仅支持 Vue2；Vue3 项目需由支持 package exports 的构建工具加载原有入口');
  }
  const environment = options.environment
    ?? (typeof process !== 'undefined' ? process.env?.NODE_ENV : undefined)
    ?? (typeof window === 'undefined' ? 'unknown' : /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) ? 'development' : 'production');
  const resolvedVueVersion = options.vueVersion ?? vueVersion;
  const design = resolveLegacyDesign();
  return {
    projectCode: options.projectCode ?? (typeof window === 'undefined' ? 'unknown-project' : window.location.host),
    environment,
    adapterVersion: options.adapterVersion ?? '0.2.10',
    ...(options.zfsPackages ? { zfsPackages: options.zfsPackages } : {}),
    ...(resolvedVueVersion ? { vueVersion: resolvedVueVersion } : {}),
    compatibility: {
      profile: design.areaConfig || design.fieldConfig ? 'standalone-core' : 'runtime-only',
      fieldRuntime: 'unavailable',
      trace: 'unavailable',
      collection: { status: 'partial', reasons: ['低版本基础模式：未采集配置描述和字段最终运行态'] },
    },
    legacyMode: true,
    traceSupported: false,
    serialization: {
      maxDepth: 20,
      maxArrayLength: 1_000,
      maxObjectKeys: 1_000,
      maxNodes: 20_000,
      maxStringLength: 8_192,
      maxTotalStringLength: 1_048_576,
    },
  };
}

function collectorOptions(options: AdapterOptions) {
  const design = resolveLegacyDesign();
  return {
    legacyMode: true,
    ...(design.areaConfig ? { areaConfig: design.areaConfig } : {}),
    ...(design.fieldConfig ? { fieldConfig: design.fieldConfig } : {}),
    ...(options.compatibility ? { compatibility: options.compatibility } : {}),
    ...(options.serialization ? { serialization: options.serialization } : {}),
  };
}

function hasTravelData(component: TravelComponentLike): boolean {
  return component.standardAmount != null || component.standardDates != null
    || component.travelList != null || Array.isArray(component.data?.zfsBoeCalendarDTOS)
    || 'calendarData' in component;
}

function acquireTravel(component: TravelComponentLike, resolved: AdapterOptions, getInstanceId?: () => string): () => void {
  return travelRegistrations.acquire(component, () => attachTravelInspector(component, {
    ...collectorOptions(resolved),
    ...(getInstanceId ? { getInstanceId } : {}),
  }));
}

function registerBill(component: BillTemplateComponentLike, options: ZfsBoeInspectorOptions): void {
  if (!isSupportedHost() || registrations.has(component)) return;
  const resolved = resolveOptions(component, options);
  installBoeInspector(resolved);
  const dispose = attachBillTemplateInspector(component, {
    ...collectorOptions(resolved),
    ...(options.getApplySnapshot ? { getApplySnapshot: options.getApplySnapshot } : {}),
  });
  let releaseTravel: (() => void) | undefined;
  if (options.autoTravelCollector !== false) {
    try {
      const owner = options.resolveTravelComponent ? options.resolveTravelComponent(component) : findTravelOwner(component);
      if (owner && hasTravelData(owner)) releaseTravel = acquireTravel(owner, resolved, () => deriveInstanceId(component, true));
    } catch {
      // 自定义宿主解析失败时仍保留基础单据采集。
    }
  }
  registrations.set(component, () => { releaseTravel?.(); dispose(); });
}

function unregisterBill(component: BillTemplateComponentLike): void {
  registrations.get(component)?.();
  registrations.delete(component);
}

export function createBillTemplateInspectorMixin(options: ZfsBoeInspectorOptions = {}) {
  return {
    mounted(this: BillTemplateComponentLike) { registerBill(this, options); },
    activated(this: BillTemplateComponentLike) { registerBill(this, options); },
    deactivated(this: BillTemplateComponentLike) { unregisterBill(this); },
    beforeDestroy(this: BillTemplateComponentLike) { unregisterBill(this); },
  };
}

export function createTravelInspectorMixin(options: ZfsBoeInspectorOptions = {}) {
  const register = (component: TravelComponentLike) => {
    if (!isSupportedHost() || directTravelReleases.has(component) || !hasTravelData(component)) return;
    const resolved = resolveOptions(component, options);
    installBoeInspector(resolved);
    directTravelReleases.set(component, acquireTravel(component, resolved));
  };
  const unregister = (component: TravelComponentLike) => {
    directTravelReleases.get(component)?.();
    directTravelReleases.delete(component);
  };
  return {
    mounted(this: TravelComponentLike) { register(this); },
    activated(this: TravelComponentLike) { register(this); },
    deactivated(this: TravelComponentLike) { unregister(this); },
    beforeDestroy(this: TravelComponentLike) { unregister(this); },
  };
}

export function useBillTemplateInspector(): never {
  throw new Error('Vue2 基础模式请使用 createBillTemplateInspectorMixin()');
}

export function useTravelInspector(): never {
  throw new Error('Vue2 基础模式请使用 createTravelInspectorMixin()');
}
