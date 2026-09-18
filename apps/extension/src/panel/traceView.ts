import type { BoeInspectionSnapshot, TraceCursor, TraceEvent, TraceSession, TraceTrigger, TraceUpdate } from '@zfs-boe-inspector/shared-types';
import { displayValue, fieldAreas, record } from './inspectionView';

export function eventTriggers(event: TraceEvent): TraceTrigger[] {
  if (event.triggers !== undefined) return event.triggers;
  const args = Array.isArray(event.input) ? event.input : [];
  const payload = record(args[0]);
  if (event.method === 'updateBoeData' && typeof payload.areaCode === 'string') {
    return Object.entries(record(payload.value)).filter(([fieldCode]) => !fieldCode.startsWith('__')).slice(0, 30).map(([fieldCode, value]) => ({
      areaCode: String(payload.areaCode), fieldCode, value, source: 'argument',
      ...(typeof payload.rowIndex === 'number' ? { rowIndex: payload.rowIndex } : {}),
    }));
  }
  const source = event.method === 'triggerComputeMixin' ? args[0]
    : ['reCalculate', 'reComputed'].includes(event.method) ? args[3] : undefined;
  if (typeof source !== 'string' || source.lastIndexOf('.') <= 0) return [];
  const split = source.lastIndexOf('.');
  const areaCode = source.slice(0, split);
  const fieldCode = source.slice(split + 1);
  const rowIndex = typeof args[1] === 'number' ? args[1] : undefined;
  const scope = { areaCode, fieldCode, ...(rowIndex === undefined ? {} : { rowIndex }) };
  // 只恢复同一事件明确记录的源行，不能把计算目标行或事后快照当作源值。
  if (event.areaCode === areaCode && rowIndex !== undefined && event.rowIndex === rowIndex && Object.hasOwn(record(event.before), fieldCode)) {
    return [{ ...scope, value: record(event.before)[fieldCode]!, source: 'event-before' }];
  }
  return [{ ...scope, source: 'unavailable', reason: 'legacy-adapter' }];
}

export function createTraceIndex(snapshot?: BoeInspectionSnapshot) {
  const index = new Map<string, { areaName: string; names: Set<string> }>();
  for (const area of fieldAreas(snapshot)) {
    for (const field of area.fields) {
      for (const code of new Set([field.fieldCode, field.labelCode].filter((value): value is string => typeof value === 'string' && !!value))) {
        const key = JSON.stringify([area.areaCode, code]);
        const item = index.get(key) ?? { areaName: area.areaName, names: new Set<string>() };
        item.names.add(String(field.fieldName || field.fieldCode || code));
        index.set(key, item);
      }
    }
  }
  return index;
}

const missingReasons = {
  'legacy-adapter': '此记录未包含触发值，请更新业务侧 Adapter 后重新录制',
  'data-unavailable': '组件数据不可用', 'invalid-row': '行号缺失或无效',
  'row-missing': '对应区域或数据行不存在', 'field-missing': '数据行中不存在该字段', 'read-error': '读取字段值失败',
};

export function traceEventView(event: TraceEvent, snapshotOrIndex?: BoeInspectionSnapshot | ReturnType<typeof createTraceIndex>) {
  const index = snapshotOrIndex instanceof Map ? snapshotOrIndex : createTraceIndex(snapshotOrIndex);
  const triggers = eventTriggers(event).map((trigger) => {
    const field = index.get(JSON.stringify([trigger.areaCode, trigger.fieldCode]));
    const name = field ? [...field.names].join('／') : trigger.fieldCode;
    const value = trigger.source === 'unavailable' ? '未采集' : displayValue(trigger.value);
    return { ...trigger, name, areaName: field?.areaName ?? trigger.areaCode, text: value,
      reasonText: trigger.reason ? missingReasons[trigger.reason] : trigger.source === 'unavailable' ? '此记录未提供缺失原因' : '',
      preview: value.length > 100 ? `${value.slice(0, 100)}…` : value,
      sourceLabel: trigger.source === 'argument' ? '传入值' : trigger.source === 'event-before' ? '事件进入时值' : '触发时值' };
  });
  const status = { returned: '已返回', threw: '抛出异常', pending: '异步结果未观察', observed: '已观察' }[event.status];
  return { event, triggers, status,
    search: `${event.category} ${event.method} ${event.status} ${status} ${event.areaCode ?? ''} ${event.fieldCode ?? ''} ${event.error ?? ''} ${triggers.map((item) => `${item.name} ${item.areaName} ${item.areaCode} ${item.fieldCode} ${item.text}`).join(' ')}`.toLowerCase() };
}

/** 仅对已完成并追加的事件构建摘要；搜索不触发模板扫描或前后值比较。 */
export class TraceViewCache {
  private sessionId = '';
  private index = createTraceIndex();
  private views = new Map<string, ReturnType<typeof traceEventView>>();

  clear() { this.sessionId = ''; this.index.clear(); this.views.clear(); }

  read(session?: TraceSession) {
    if (!session) { this.clear(); return []; }
    if (session.id !== this.sessionId) {
      this.clear(); this.sessionId = session.id; this.index = createTraceIndex(session.startSnapshot);
    }
    return session.events.map((event) => {
      let view = this.views.get(event.id);
      if (!view) { view = traceEventView(event, this.index); this.views.set(event.id, view); }
      return view;
    }).sort((a, b) => Number(a.event.id.split('-')[1]) - Number(b.event.id.split('-')[1]));
  }
}

export function traceChanges(event: TraceEvent) {
  const before = record(event.before);
  const after = record(event.after);
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((key) => !key.startsWith('__'));
  return keys.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map((key) => ({ field: key, before: displayValue(before[key]), after: displayValue(after[key]) }));
}

export function traceCursor(session?: TraceSession): TraceCursor | undefined {
  return session ? { sessionId: session.id, offset: session.events.length, ended: !session.active } : undefined;
}

export function mergeTraceUpdate(previous: TraceSession | undefined, update: TraceUpdate | undefined): TraceSession | undefined {
  if (!update) return;
  const { reset, eventOffset, startSnapshot, ...session } = update;
  if (reset) {
    if (!startSnapshot || eventOffset !== 0) throw new Error('过程记录初始数据不完整，请重新读取');
    return { ...session, startSnapshot };
  }
  if (!previous || previous.id !== update.id || previous.events.length !== eventOffset) throw new Error('过程记录游标已失效，请重新读取');
  return { ...previous, ...session, events: update.events.length ? [...previous.events, ...update.events] : previous.events };
}

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23' });
export function traceTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : timeFormatter.format(date);
}
