import {
  getCurrentInstance,
  onBeforeUnmount,
  onMounted,
} from 'vue';
import boePackage from '@zfs/boe/package.json';
import { areaConfig, fieldConfig } from '@zfs/boe/zfs-boe-core/src/config/boeDesign';
import getDynamicConfig from '@zfs/boe/zfs-boe-core/src/utils/fieldDynamicConfig';
import type {
  AdapterOptions,
  BillTemplateComponentLike,
} from './collector';
import {
  attachBillTemplateInspector,
  installBoeInspector,
} from './index';

declare const process: { env?: { NODE_ENV?: string } } | undefined;

export type ZfsBoeInspectorOptions = Partial<AdapterOptions>;

type BillTemplateInstance = BillTemplateComponentLike & object;

const registrations = new WeakMap<BillTemplateInstance, () => void>();

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
    adapterVersion: options.adapterVersion ?? '0.1.0',
    zfsPackages: {
      '@zfs/boe': boePackage.version,
      '@zfs/ui-plus': boePackage.dependencies?.['@zfs/ui-plus'] ?? 'unknown',
      ...options.zfsPackages,
    },
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
  if (registrations.has(component)) return;
  installBoeInspector(resolvedOptions(options, vueVersion));
  const dispose = attachBillTemplateInspector(component, {
    areaConfig,
    fieldConfig,
    getDynamicConfig,
  });
  registrations.set(component, dispose);
}

function unregisterBillTemplate(component: BillTemplateInstance) {
  registrations.get(component)?.();
  registrations.delete(component);
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
