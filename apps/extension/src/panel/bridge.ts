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
  TraceCursor,
  TraceUpdate,
} from '@zfs-boe-inspector/shared-types';

type BridgeMethod =
  | 'getStatus'
  | 'getSnapshot'
  | 'getAreaDetail'
  | 'getFieldDetail'
  | 'startFieldPicker'
  | 'getFieldPickerState'
  | 'cancelFieldPicker'
  | 'startPicker' | 'locateSelection' | 'startTrace' | 'stopTrace' | 'getTrace' | 'getTraceUpdate' | 'clearTrace';

interface PageBridgeEnvelope {
  found: boolean;
  href: string;
  pageId?: string;
  value?: unknown;
  error?: string;
}

let cachedBridgeFrame: { tabId: number; frameId: number } | undefined;

function bridgeCall<T>(method: BridgeMethod, args: unknown[] = [], contextual = false, expectedPage = ''): Promise<T> {
  const devtools = (chrome as typeof chrome & { devtools?: typeof chrome.devtools }).devtools;
  if (!devtools?.inspectedWindow) return sidePanelBridgeCall<T>(method, args, contextual, expectedPage);
  const expression = `(() => {
    const bridge = window.__ZFS_BOE_INSPECTOR__;
    if (!bridge) throw new Error('页面尚未安装 ZFS BOE Inspector Adapter');
    const pageId = JSON.stringify([${devtools.inspectedWindow.tabId}, 0, window.location.href, window.performance.timeOrigin]);
    if (${JSON.stringify(expectedPage)} && pageId !== ${JSON.stringify(expectedPage)}) throw new Error('页面已变化，请返回原单据或新建会话');
    const value = bridge[${JSON.stringify(method)}](...${JSON.stringify(args)});
    return ${contextual} ? { snapshot: value, pageId } : value;
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

function invokePageBridge(method: BridgeMethod, args: unknown[], expectedLocation: string): PageBridgeEnvelope {
  const pageWindow = window as typeof window & {
    __ZFS_BOE_INSPECTOR__?: Record<string, (...values: unknown[]) => unknown>;
  };
  const bridge = pageWindow.__ZFS_BOE_INSPECTOR__;
  if (!bridge) return { found: false, href: window.location.href };
  const pageId = JSON.stringify([window.location.href, window.performance.timeOrigin]);
  if (expectedLocation && pageId !== expectedLocation) return { found: true, href: window.location.href, error: '页面已变化，请返回原单据或新建会话' };
  const handler = bridge[method];
  if (typeof handler !== 'function') {
    return { found: true, href: window.location.href, error: `页面 Bridge 不支持 ${method}` };
  }
  try {
    return { found: true, href: window.location.href, pageId, value: handler(...args) };
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
  expectedLocation = '',
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
      args: [method, args, expectedLocation],
    });
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (/cannot access|permission|host permission/i.test(message)) {
      throw new Error('扩展没有当前 BOE 页面的访问权限，请在 BOE 页面点击扩展图标后重试', { cause: reason });
    }
    throw reason;
  }
}

async function sidePanelBridgeCall<T>(method: BridgeMethod, args: unknown[], contextual: boolean, expectedPage: string): Promise<T> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('未找到当前活动 BOE 页面');
  if (expectedPage) {
    const [tabId, frameId, href, timeOrigin] = JSON.parse(expectedPage) as [number, number, string, number];
    if (tab.id !== tabId) throw new Error('请切回对应单据页面');
    const results = await executeBridgeMethod(tabId, method, args, { frameIds: [frameId] }, JSON.stringify([href, timeOrigin]));
    const result = results[0]?.result;
    if (!result?.found || result.error) throw new Error(result?.error || '页面已断开');
    return (contextual ? { snapshot: result.value, pageId: expectedPage } : result.value) as T;
  }
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
  const [href, timeOrigin] = JSON.parse(matched.result.pageId!) as [string, number];
  return (contextual ? { snapshot: matched.result.value, pageId: JSON.stringify([tab.id, matched.frameId, href, timeOrigin]) } : matched.result.value) as T;
}

export const pageBridge = {
  getAiSnapshot: (instanceId?: string, expectedPage = '') => bridgeCall<{ snapshot: BoeInspectionSnapshot; pageId: string }>('getSnapshot', instanceId ? [instanceId] : [], true, expectedPage),
  locateAiSelection: (selection: InspectionSelection, id: string, expectedPage: string) => bridgeCall<boolean>('locateSelection', [selection, id], false, expectedPage),
  startPicker: (mode: 'field' | 'area', id: string, options?: PickerOptions, expectedPage = '') => bridgeCall<PickerState>('startPicker', [mode, id, options], false, expectedPage),
  locateSelection: (selection: InspectionSelection, id: string) => bridgeCall<boolean>('locateSelection', [selection, id]),
  startTrace: (id: string, expectedPage = '') => bridgeCall<TraceSession>('startTrace', [id], false, expectedPage),
  stopTrace: (expectedPage = '', omitData = false) => bridgeCall<TraceSession | undefined>('stopTrace', [omitData], false, expectedPage),
  getTraceUpdate: (cursor: TraceCursor | undefined, expectedPage = '') => bridgeCall<TraceUpdate | undefined>('getTraceUpdate', cursor ? [cursor] : [], false, expectedPage),
  getTrace: (expectedPage = '') => bridgeCall<TraceSession | undefined>('getTrace', [], false, expectedPage),
  clearTrace: (expectedPage = '') => bridgeCall<void>('clearTrace', [], false, expectedPage),
  getStatus: () => bridgeCall<BridgeStatus>('getStatus'),
  getSnapshot: (instanceId?: string) => bridgeCall<BoeInspectionSnapshot>('getSnapshot', instanceId ? [instanceId] : []),
  getAreaDetail: (areaCode: string, instanceId?: string) => bridgeCall<AreaDetail | undefined>(
    'getAreaDetail',
    instanceId ? [areaCode, instanceId] : [areaCode],
  ),
  getFieldDetail: (selection: FieldSelection, instanceId?: string, expectedPage = '') => bridgeCall<FieldDetail | undefined>(
    'getFieldDetail',
    instanceId ? [selection, instanceId] : [selection], false, expectedPage,
  ),
  startFieldPicker: (expectedPage = '') => bridgeCall<PickerState>('startFieldPicker', [], false, expectedPage),
  getFieldPickerState: (expectedPage = '') => bridgeCall<PickerState>('getFieldPickerState', [], false, expectedPage),
  cancelFieldPicker: (expectedPage = '') => bridgeCall<PickerState>('cancelFieldPicker', [], false, expectedPage),
};
