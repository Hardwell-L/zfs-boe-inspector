import type { BoeInspectorBridge } from './runtime';
import {
  createBillTemplateCollector,
  createTravelCollector,
  type AdapterOptions,
  type BillTemplateCollectorOptions,
  type BillTemplateComponentLike,
  type TravelCollectorOptions,
  type TravelComponentLike,
} from './collector';
import { BoeInspectorRuntime } from './runtime';

export * from './collector';
export * from './fieldInspector';
export * from './runtime';
export * from './serialize';

declare global {
  interface Window {
    __ZFS_BOE_INSPECTOR__?: BoeInspectorBridge;
  }
}

let currentRuntime: BoeInspectorRuntime | undefined;

function exposeRuntime(runtime: BoeInspectorRuntime): BoeInspectorRuntime {
  currentRuntime = runtime;
  const bridge = runtime.createBridge();
  window.__ZFS_BOE_INSPECTOR__ = bridge;
  try {
    if (window.top && window.top !== window) {
      window.top.__ZFS_BOE_INSPECTOR__ = bridge;
    }
  } catch {
    // 跨域 iframe 不在首版支持范围内，保留当前 frame 内的 Bridge。
  }
  return runtime;
}

export function installBoeInspector(options: AdapterOptions): BoeInspectorRuntime {
  if (currentRuntime) return currentRuntime;
  return exposeRuntime(new BoeInspectorRuntime(options));
}

export function createBoeInspector(options: AdapterOptions) {
  const runtime = new BoeInspectorRuntime(options);
  return {
    runtime,
    install() {
      exposeRuntime(runtime);
    },
  };
}

function requireRuntime(): BoeInspectorRuntime {
  if (!currentRuntime) {
    throw new Error('请先安装 Inspector Runtime，或使用 zfs-boe 入口提供的 Mixin/Composable');
  }
  return currentRuntime;
}

export function attachBillTemplateInspector(
  component: BillTemplateComponentLike,
  options: BillTemplateCollectorOptions = {},
): () => void {
  return requireRuntime().register(createBillTemplateCollector(component, options));
}

export function attachTravelInspector(
  component: TravelComponentLike,
  options: TravelCollectorOptions = {},
): () => void {
  return requireRuntime().register(createTravelCollector(component, options));
}
