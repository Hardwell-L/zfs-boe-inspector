import {
  getCurrentInstance,
  onBeforeUnmount,
  onMounted,
} from 'vue';
import boePackage from '@zfs/boe/package.json';
import { areaConfig, fieldConfig } from '@zfs/boe/zfs-boe-core/src/config/boeDesign';
import getDynamicConfig from '@zfs/boe/zfs-boe-core/src/utils/fieldDynamicConfig';
import {
  deriveInstanceId,
  type AdapterOptions,
  type BillTemplateCollectorOptions,
  type BillTemplateComponentLike,
  type TravelCollectorOptions,
  type TravelComponentLike,
} from './collector';
import type { TraceConditionResolver } from './trace';
import {
  attachBillTemplateInspector,
  attachTravelInspector,
  installBoeInspector,
} from './index';
import { SharedRegistrationPool } from './sharedRegistration';
import { findTravelOwner } from './travelOwner';
import { isSupportedBoeVersion } from './boeVersion';

declare const process: { env?: { NODE_ENV?: string } } | undefined;

export type ZfsBoeInspectorOptions = Partial<AdapterOptions>
  & Pick<BillTemplateCollectorOptions, 'getApplySnapshot'>
  & {
    getTraceConditions?: TraceConditionResolver;
    autoTravelCollector?: boolean;
    resolveTravelComponent?: (
      component: BillTemplateComponentLike,
    ) => TravelComponentLike | undefined;
  };

type BillTemplateInstance = BillTemplateComponentLike & object;
type TravelInstance = TravelComponentLike & object;

const registrations = new WeakMap<BillTemplateInstance, () => void>();
const travelRegistrations = new SharedRegistrationPool<TravelInstance>();
const automaticTravelReleases = new WeakMap<BillTemplateInstance, () => void>();
const directTravelReleases = new WeakMap<TravelInstance, () => void>();

function inferredEnvironment(): string {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV) return process.env.NODE_ENV;
  if (typeof window === 'undefined') return 'unknown';
  return /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
    ? 'development'
    : 'production';
}

function inferredProjectCode(): string {
  if (typeof window === 'undefined') return 'unknown-project';
  return window.location.host || 'unknown-project';
}

function resolvedOptions(
  options: ZfsBoeInspectorOptions,
  vueVersion?: string,
): AdapterOptions {
  const resolved: AdapterOptions = {
    projectCode: options.projectCode ?? inferredProjectCode(),
    environment: options.environment ?? inferredEnvironment(),
    adapterVersion: options.adapterVersion ?? '0.2.10',
    zfsPackages: {
      '@zfs/boe': boePackage.version,
      '@zfs/ui-plus': boePackage.dependencies?.['@zfs/ui-plus'] ?? 'unknown',
      ...options.zfsPackages,
    },
    compatibility: {
      profile: 'embedded-core',
      fieldRuntime: 'complete',
      trace: 'available',
      collection: { status: 'complete' },
    },
    traceSupported: true,
    legacyMode: false,
  };
  const resolvedVueVersion = options.vueVersion ?? vueVersion;
  if (resolvedVueVersion) resolved.vueVersion = resolvedVueVersion;
  return resolved;
}

function registerBillTemplate(
  component: BillTemplateInstance,
  options: ZfsBoeInspectorOptions,
  vueVersion?: string,
) {
  if (!isSupportedBoeVersion(boePackage.version) || registrations.has(component)) return;
  const resolved = resolvedOptions(options, vueVersion);
  installBoeInspector(resolved);
  const dispose = attachBillTemplateInspector(component, {
    areaConfig,
    fieldConfig,
    getDynamicConfig,
    ...(resolved.compatibility ? { compatibility: resolved.compatibility } : {}),
    ...(options.getApplySnapshot ? { getApplySnapshot: options.getApplySnapshot } : {}),
    ...(options.getTraceConditions ? { getTraceConditions: options.getTraceConditions } : {}),
  });
  registrations.set(component, dispose);

  if (options.autoTravelCollector === false) return;

  let travelComponent: TravelComponentLike | undefined;
  try {
    travelComponent = options.resolveTravelComponent
      ? options.resolveTravelComponent(component)
      : findTravelOwner(component);
  } catch {
    return;
  }

  if (!travelComponent) return;

  const releaseTravel = acquireTravelRegistration(
    travelComponent,
    options,
    vueVersion,
    () => deriveInstanceId(component),
  );
  automaticTravelReleases.set(component, releaseTravel);
}

function unregisterBillTemplate(component: BillTemplateInstance) {
  automaticTravelReleases.get(component)?.();
  automaticTravelReleases.delete(component);
  registrations.get(component)?.();
  registrations.delete(component);
}

function acquireTravelRegistration(
  component: TravelInstance,
  options: ZfsBoeInspectorOptions,
  vueVersion?: string,
  getInstanceId?: TravelCollectorOptions['getInstanceId'],
): () => void {
  return travelRegistrations.acquire(component, () => {
    const resolved = resolvedOptions(options, vueVersion);
    installBoeInspector(resolved);
    const collectorOptions = {
      ...(getInstanceId ? { getInstanceId } : {}),
      ...(resolved.compatibility ? { compatibility: resolved.compatibility } : {}),
    };
    return attachTravelInspector(component, collectorOptions);
  });
}

function registerTravel(
  component: TravelInstance,
  options: ZfsBoeInspectorOptions,
  vueVersion?: string,
) {
  if (!isSupportedBoeVersion(boePackage.version) || directTravelReleases.has(component)) return;
  directTravelReleases.set(
    component,
    acquireTravelRegistration(component, options, vueVersion),
  );
}

function unregisterTravel(component: TravelInstance) {
  directTravelReleases.get(component)?.();
  directTravelReleases.delete(component);
}

export function createBillTemplateInspectorMixin(
  options: ZfsBoeInspectorOptions = {},
) {
  return {
    mounted(this: BillTemplateInstance) {
      const vueVersion = (this as BillTemplateInstance & {
        $?: { appContext?: { app?: { version?: string } } };
      }).$?.appContext?.app?.version;
      registerBillTemplate(this, options, vueVersion);
    },
    beforeUnmount(this: BillTemplateInstance) {
      unregisterBillTemplate(this);
    },
    beforeDestroy(this: BillTemplateInstance) {
      unregisterBillTemplate(this);
    },
  };
}

export function useBillTemplateInspector(
  options: ZfsBoeInspectorOptions = {},
): void {
  const instance = getCurrentInstance();
  if (!instance) {
    throw new Error('useBillTemplateInspector 必须在 setup() 中调用');
  }
  const component = instance.proxy as BillTemplateInstance | null;
  onMounted(() => {
    if (!component) throw new Error('无法获取当前 billTemplate 组件实例');
    registerBillTemplate(component, options, instance.appContext.app.version);
  });
  onBeforeUnmount(() => {
    if (component) unregisterBillTemplate(component);
  });
}

export function createTravelInspectorMixin(
  options: ZfsBoeInspectorOptions = {},
) {
  return {
    mounted(this: TravelInstance) {
      const vueVersion = (this as TravelInstance & {
        $?: { appContext?: { app?: { version?: string } } };
      }).$?.appContext?.app?.version;
      registerTravel(this, options, vueVersion);
    },
    beforeUnmount(this: TravelInstance) {
      unregisterTravel(this);
    },
    beforeDestroy(this: TravelInstance) {
      unregisterTravel(this);
    },
  };
}

export function useTravelInspector(
  options: ZfsBoeInspectorOptions = {},
): void {
  const instance = getCurrentInstance();
  if (!instance) {
    throw new Error('useTravelInspector 必须在 setup() 中调用');
  }
  const component = instance.proxy as TravelInstance | null;
  onMounted(() => {
    if (!component) throw new Error('无法获取当前差旅组件实例');
    registerTravel(component, options, instance.appContext.app.version);
  });
  onBeforeUnmount(() => {
    if (component) unregisterTravel(component);
  });
}
