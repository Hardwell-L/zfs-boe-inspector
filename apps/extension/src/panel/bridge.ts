import type {
  AreaDetail,
  BoeInspectionSnapshot,
  BridgeStatus,
  FieldDetail,
  FieldSelection,
  PickerState,
  PickerOptions,
  InspectionSelection,
  TraceSession,
} from '@zfs-boe-inspector/shared-types';

type BridgeMethod =
  | 'getStatus'
  | 'getSnapshot'
  | 'getAreaDetail'
  | 'getFieldDetail'
  | 'startFieldPicker'
  | 'getFieldPickerState'
  | 'cancelFieldPicker'
  | 'startPicker' | 'locateSelection' | 'startTrace' | 'stopTrace' | 'getTrace' | 'clearTrace';

interface PageBridgeEnvelope {
  found: boolean;
  href: string;
  value?: unknown;
  error?: string;
}

let cachedBridgeFrame: { tabId: number; frameId: number } | undefined;

function bridgeCall<T>(method: BridgeMethod, args: unknown[] = []): Promise<T> {
  const devtools = (chrome as typeof chrome & { devtools?: typeof chrome.devtools }).devtools;
  if (!devtools?.inspectedWindow) return sidePanelBridgeCall<T>(method, args);
  const expression = `(() => {
    const bridge = window.__ZFS_BOE_INSPECTOR__;
    if (!bridge) throw new Error('页面尚未安装 ZFS BOE Inspector Adapter');
    return bridge[${JSON.stringify(method)}](...${JSON.stringify(args)});
  })()`;
  return new Promise((resolve, reject) => {
    devtools.inspectedWindow.eval(expression, (result, exceptionInfo) => {
      if (exceptionInfo?.isException || exceptionInfo?.isError) {
        reject(new Error(exceptionInfo.value || exceptionInfo.description || 'Bridge 调用失败'));
        return;
      }
      resolve(result as T);
    });
  });
}

function invokePageBridge(method: BridgeMethod, args: unknown[]): PageBridgeEnvelope {
  const pageWindow = window as typeof window & {
    __ZFS_BOE_INSPECTOR__?: Record<string, (...values: unknown[]) => unknown>;
  };
  const bridge = pageWindow.__ZFS_BOE_INSPECTOR__;
  if (!bridge) return { found: false, href: window.location.href };
  const handler = bridge[method];
  if (typeof handler !== 'function') {
    return { found: true, href: window.location.href, error: `页面 Bridge 不支持 ${method}` };
  }
  try {
    return { found: true, href: window.location.href, value: handler(...args) };
  } catch (reason) {
    return {
      found: true,
      href: window.location.href,
      error: reason instanceof Error ? reason.message : String(reason),
    };
  }
}

async function executeBridgeMethod(
  tabId: number,
  method: BridgeMethod,
  args: unknown[],
  frameTarget?: { frameIds: number[] } | { allFrames: true },
) {
  const target: chrome.scripting.InjectionTarget = frameTarget && 'frameIds' in frameTarget
    ? { tabId, frameIds: frameTarget.frameIds }
    : frameTarget?.allFrames
      ? { tabId, allFrames: true }
      : { tabId };
  try {
    return await chrome.scripting.executeScript({
      target,
      world: 'MAIN',
      func: invokePageBridge,
      args: [method, args],
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (/cannot access|permission|host permission/i.test(message)) {
      throw new Error('扩展没有当前 BOE 页面的访问权限，请在 BOE 页面点击扩展图标后重试', { cause: reason });
    }
    throw reason;
  }
}

async function sidePanelBridgeCall<T>(method: BridgeMethod, args: unknown[]): Promise<T> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('未找到当前活动 BOE 页面');
  let results: Awaited<ReturnType<typeof executeBridgeMethod>> | undefined;
  if (cachedBridgeFrame?.tabId === tab.id) {
    try {
      results = await executeBridgeMethod(tab.id, method, args, { frameIds: [cachedBridgeFrame.frameId] });
    } catch {
      cachedBridgeFrame = undefined;
    }
  }
  results ??= await executeBridgeMethod(tab.id, method, args);
  let matched = results.find(({ result }) => result?.found);
  if (!matched) {
    results = await executeBridgeMethod(tab.id, method, args, { allFrames: true });
    matched = results.find(({ result }) => result?.found);
  }
  if (!matched?.result) {
    cachedBridgeFrame = undefined;
    throw new Error('当前活动页面及其 frame 中均未找到 ZFS BOE Inspector Adapter');
  }
  cachedBridgeFrame = { tabId: tab.id, frameId: matched.frameId };
  if (matched.result.error) throw new Error(matched.result.error);
  return matched.result.value as T;
}

export const pageBridge = {
  startPicker: (mode: 'field' | 'area', id: string, options?: PickerOptions) => bridgeCall<PickerState>('startPicker', [mode, id, options]),
  locateSelection: (selection: InspectionSelection, id: string) => bridgeCall<boolean>('locateSelection', [selection, id]),
  startTrace: (id: string) => bridgeCall<TraceSession>('startTrace', [id]),
  stopTrace: () => bridgeCall<TraceSession | undefined>('stopTrace'),
  getTrace: () => bridgeCall<TraceSession | undefined>('getTrace'),
  clearTrace: () => bridgeCall<void>('clearTrace'),
  getStatus: () => bridgeCall<BridgeStatus>('getStatus'),
  getSnapshot: (instanceId?: string) => bridgeCall<BoeInspectionSnapshot>('getSnapshot', instanceId ? [instanceId] : []),
  getAreaDetail: (areaCode: string, instanceId?: string) => bridgeCall<AreaDetail | undefined>(
    'getAreaDetail',
    instanceId ? [areaCode, instanceId] : [areaCode],
  ),
  getFieldDetail: (selection: FieldSelection, instanceId?: string) => bridgeCall<FieldDetail | undefined>(
    'getFieldDetail',
    instanceId ? [selection, instanceId] : [selection],
  ),
  startFieldPicker: () => bridgeCall<PickerState>('startFieldPicker'),
  getFieldPickerState: () => bridgeCall<PickerState>('getFieldPickerState'),
  cancelFieldPicker: () => bridgeCall<PickerState>('cancelFieldPicker'),
};
