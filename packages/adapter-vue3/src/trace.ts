import type { BoeInspectionSnapshot, JsonValue, TraceEvent, TraceSession } from '@zfs-boe-inspector/shared-types';
import { toSerializable } from './serialize';

const METHODS: Record<string, string> = {
  updateBoeData: '字段更新',
  triggerComputeMixin: '计算触发',
  initComputeMixin: '初始化计算',
  reCalculate: '条件计算',
  reComputed: '公式计算',
  beforeValidateRules: '校验',
  getValidateRulesTips: '校验提示',
  transApplyBoeData: '关联申请转换',
  setDataTransToBill: '关联申请写入',
  getApplyBoeDataById: '关联申请请求',
  checkStandard: '差旅标准',
};

export interface TraceTarget {
  component: object;
  getInstanceId(): string;
}

// 这里只观察现有调用。Promise 不追加处理器，避免改变宿主 unhandledrejection 行为。
export class TraceRecorder {
  private session: TraceSession | undefined;
  private restores: Array<() => void> = [];
  private stack: string[] = [];
  private size = 0;
  private counter = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly snapshot: (instanceId: string) => BoeInspectionSnapshot) {}

  start(instanceId: string, targets: TraceTarget[]): TraceSession {
    this.stop('已开始新的记录');
    const startSnapshot = this.snapshot(instanceId);
    const startBytes = new TextEncoder().encode(JSON.stringify(startSnapshot)).length;
    if (startBytes >= 5 * 1024 * 1024) throw new Error('开始快照超过 5 MB，无法记录此单据');
    const selected = targets.filter((target) => target.getInstanceId() === instanceId);
    const coverage = Object.keys(METHODS).map((method) => ({
      method, supported: selected.some(({ component }) => typeof (component as Record<string, unknown>)[method] === 'function'),
    }));
    this.session = {
      id: `trace-${Date.now()}`, instanceId, active: true, startedAt: new Date().toISOString(),
      events: [], coverage, startSnapshot,
      limitations: [
        '只观察实际存在的组件方法入口，不保证覆盖内部表达式、被捕获的异常或服务端过程。',
        '异步返回仅记录为 pending；后续字段更新独立记录，无法确认的异步因果不连接。',
        '浏览器异常属于当前页面，多个单据并存时不能确定归属。',
        '开始/结束快照包含 Inspector 采集状态，不代表规则执行时的完整输入；事件数据有截断上限。',
      ],
    };
    this.counter = 0;
    this.size = startBytes;
    for (const target of selected) {
      for (const method of Object.keys(METHODS)) this.wrap(target, method);
    }
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
    window.addEventListener('pagehide', this.onPageHide);
    this.timer = setInterval(() => {
      try {
        if (selected.some((target) => target.getInstanceId() !== instanceId)) this.stop('单据已切换');
      } catch { this.stop('单据实例不可读取'); }
    }, 500);
    return this.get()!;
  }

  get(): TraceSession | undefined {
    return this.session;
  }

  stop(reason = '用户停止记录'): TraceSession | undefined {
    const session = this.session;
    if (!session?.active) return session;
    session.active = false;
    session.stoppedAt = new Date().toISOString();
    session.reason = reason;
    for (const restore of this.restores.splice(0)) {
      try { restore(); } catch { /* 宿主已销毁时不影响其清理。 */ }
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
    window.removeEventListener('pagehide', this.onPageHide);
    try {
      const end = this.snapshot(session.instanceId);
      if (this.size + new TextEncoder().encode(JSON.stringify(end)).length < 5 * 1024 * 1024) session.endSnapshot = end;
      else session.limitations.push('结束快照超过总容量限制，未保存。');
    } catch { session.limitations.push('停止时单据已不可读取，未取得结束快照。'); }
    return session;
  }

  clear(): void {
    this.stop();
    this.session = undefined;
  }

  private safe(value: unknown): JsonValue {
    try {
      const result = toSerializable(value, { maxDepth: 8, maxArrayLength: 30, maxObjectKeys: 50 });
      return JSON.stringify(result).length > 32_768 ? { __kind: 'truncated', reason: 'event-value-limit' } : result;
    }
    catch { return { __kind: 'unreadable' }; }
  }

  private add(event: TraceEvent) {
    const session = this.session;
    if (!session?.active) return;
    const bytes = new TextEncoder().encode(JSON.stringify(event)).length;
    if (session.events.length >= 1000 || this.size + bytes > 5 * 1024 * 1024) {
      this.stop('已达到 1,000 条事件或 5 MB 上限');
      return;
    }
    session.events.push(event);
    this.size += bytes;
    if (session.events.length >= 1000) this.stop('已达到 1,000 条事件上限');
  }

  private wrap(target: TraceTarget, method: string) {
    const component = target.component as Record<string, any>;
    const original = component[method];
    if (typeof original !== 'function') return;
    const descriptor = Object.getOwnPropertyDescriptor(component, method);
    const session = this.session;
    const observe = (receiver: unknown, args: unknown[]) => {
      if (!session?.active || this.session !== session) return Reflect.apply(original, receiver, args);
      let currentId: string;
      try { currentId = target.getInstanceId(); }
      catch { return Reflect.apply(original, receiver, args); }
      if (currentId !== session.instanceId) {
        try { this.stop('单据已切换'); } catch { /* 清理失败不影响原方法。 */ }
        return Reflect.apply(original, receiver, args);
      }
      const event: TraceEvent = {
        id: `event-${++this.counter}`, at: new Date().toISOString(), method,
        category: METHODS[method]!, status: 'pending', input: this.safe(args),
      };
      const parentId = this.stack.at(-1);
      if (parentId) event.parentId = parentId;
      try {
        const payload = args[0] && typeof args[0] === 'object' ? args[0] as Record<string, any> : {};
        const areaCode = payload.areaCode ?? (['reCalculate', 'reComputed'].includes(method) ? args[0] : undefined);
        const rowIndex = payload.rowIndex ?? (['reCalculate', 'reComputed'].includes(method) ? args[1] : undefined);
        const field = payload.field ?? (['reCalculate', 'reComputed'].includes(method) ? args[2] : undefined);
        const fieldCode = payload.fieldCode ?? field?.fieldCode;
        if (typeof areaCode === 'string') event.areaCode = areaCode;
        if (typeof fieldCode === 'string') event.fieldCode = fieldCode;
        if (typeof rowIndex === 'number') event.rowIndex = rowIndex;
      } catch { /* 无法读取作用域时仍保留方法入口。 */ }
      const readRow = () => component.data?.[event.areaCode ?? '']?.[event.rowIndex ?? 0];
      try { event.before = this.safe(readRow()); } catch { /* 采集不阻断业务。 */ }
      this.stack.push(event.id);
      try {
        const result = Reflect.apply(original, receiver, args);
        event.status = result instanceof Promise ? 'pending' : 'returned';
        event.output = this.safe(result);
        return result;
      } catch (error) {
        event.status = 'threw';
        try { event.error = error instanceof Error ? error.message : String(error); } catch { event.error = '异常信息不可读取'; }
        throw error;
      } finally {
        this.stack.pop();
        try {
          event.after = this.safe(readRow());
          if (this.session === session) this.add(event);
        } catch { /* 采集错误不替代业务返回值或异常。 */ }
      }
    };
    function wrapped(this: unknown, ...args: unknown[]) { return observe(this, args); }
    try {
      component[method] = wrapped;
      if (component[method] !== wrapped) throw new Error('方法不可替换');
      this.restores.push(() => {
        if (component[method] !== wrapped) return;
        if (descriptor) Object.defineProperty(component, method, descriptor);
        else delete component[method];
      });
    } catch {
      const capability = this.session?.coverage.find((item) => item.method === method);
      if (capability) capability.supported = false;
      this.session?.limitations.push(`${method} 无法安装观察器。`);
    }
  }

  private onError = (event: ErrorEvent) => this.add({
    id: `event-${++this.counter}`, at: new Date().toISOString(), category: '页面异常',
    method: 'window.error', status: 'observed', error: event.message,
    output: this.safe({ filename: event.filename, line: event.lineno, stack: event.error?.stack }),
  });

  private onRejection = (event: PromiseRejectionEvent) => this.add({
    id: `event-${++this.counter}`, at: new Date().toISOString(), category: '页面异常',
    method: 'unhandledrejection', status: 'observed', output: this.safe(event.reason),
  });

  private onPageHide = () => { this.stop('页面离开'); };
}
