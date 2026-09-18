import type { BoeInspectionSnapshot, TraceConditionDefinition, TraceCursor, TraceEvent, TraceSession, TraceTrigger, TraceUpdate } from '@zfs-boe-inspector/shared-types';
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
  return { event, triggers, status, repeatCount: 1,
    search: `${event.category} ${event.method} ${event.status} ${status} ${event.areaCode ?? ''} ${event.fieldCode ?? ''} ${event.error ?? ''} ${event.conditions?.map((condition) => `${condition.key} ${condition.result}`).join(' ') ?? ''} ${triggers.map((item) => `${item.name} ${item.areaName} ${item.areaCode} ${item.fieldCode} ${item.text}`).join(' ')}`.toLowerCase() };
}

export interface TraceAreaGroup {
  key: string;
  areaCode: string;
  areaName: string;
  total: number;
  firstAt: string;
  lastAt: string;
  conditions: TraceConditionGroup[];
}

export interface TraceConditionGroup {
  key: string;
  label: string;
  category: string;
  method: string;
  total: number;
  firstAt: string;
  lastAt: string;
  events: ReturnType<typeof traceEventView>[];
}

function groupCondition(view: ReturnType<typeof traceEventView>, definitions: Map<string, TraceConditionDefinition>) {
  const primary = view.event.conditions?.[0];
  const definition = primary ? definitions.get(primary.key) : undefined;
  return primary
    ? { key: `condition:${primary.key}`, label: definition?.label || definition?.ruleId || primary.key }
    : { key: `method:${view.event.category}:${view.event.method}`, label: `${view.event.category} · ${view.event.method}` };
}

function groupArea(view: ReturnType<typeof traceEventView>) {
  const trigger = view.triggers[0];
  const areaCode = trigger?.areaCode ?? view.event.areaCode ?? '__unknown__';
  const rawName = trigger?.areaCode === areaCode ? trigger.areaName : areaCode === '__unknown__' ? '未识别区域' : areaCode;
  const areaName = rawName === '补充信息' ? '附加区' : rawName;
  return { key: areaCode, areaCode, areaName };
}

function repeatedTriggerKey(view: ReturnType<typeof traceEventView>) {
  if (!view.triggers.length || view.triggers.some((trigger) => trigger.source === 'unavailable' || trigger.value === undefined)) return;
  return JSON.stringify([
    view.event.category, view.event.method, view.event.status, view.event.error ?? null,
    view.triggers.map((trigger) => [
      trigger.areaCode, trigger.fieldCode, trigger.rowIndex ?? null, trigger.source, trigger.reason ?? null, trigger.value,
    ]),
  ]);
}

function collapseRepeatedViews(views: ReturnType<typeof traceEventView>[]) {
  const collapsed: ReturnType<typeof traceEventView>[] = [];
  const indexes = new Map<string, number>();
  for (const view of views) {
    const key = repeatedTriggerKey(view);
    if (!key) {
      collapsed.push(view);
      continue;
    }
    const index = indexes.get(key);
    if (index === undefined) {
      indexes.set(key, collapsed.length);
      collapsed.push(view);
      continue;
    }
    const current = collapsed[index]!;
    collapsed[index] = { ...current, repeatCount: current.repeatCount + view.repeatCount };
  }
  return collapsed;
}

/** 只建立事件引用和计数，不复制原始事件值；调用方可用同一结果覆盖分页明细。 */
export function traceGroups(views: ReturnType<typeof traceEventView>[], definitions: TraceConditionDefinition[] = []): TraceAreaGroup[] {
  const definitionIndex = new Map(definitions.map((definition) => [definition.key, definition]));
  const groups = new Map<string, TraceAreaGroup>();
  const conditionIndexes = new Map<string, Map<string, TraceConditionGroup>>();
  for (const view of views) {
    const area = groupArea(view);
    const group = groups.get(area.key) ?? {
      ...area, total: 0, firstAt: view.event.at, lastAt: view.event.at, conditions: [],
    };
    group.total += 1;
    if (view.event.at < group.firstAt) group.firstAt = view.event.at;
    if (view.event.at > group.lastAt) group.lastAt = view.event.at;
    const condition = groupCondition(view, definitionIndex);
    const conditionIndex = conditionIndexes.get(area.key) ?? new Map<string, TraceConditionGroup>();
    conditionIndexes.set(area.key, conditionIndex);
    const conditionGroup = conditionIndex.get(condition.key);
    if (conditionGroup) {
      conditionGroup.total += 1;
      conditionGroup.events.push(view);
      if (view.event.at < conditionGroup.firstAt) conditionGroup.firstAt = view.event.at;
      if (view.event.at > conditionGroup.lastAt) conditionGroup.lastAt = view.event.at;
    } else {
      const nextCondition = {
        ...condition, category: view.event.category, method: view.event.method, total: 1,
        firstAt: view.event.at, lastAt: view.event.at, events: [view],
      };
      conditionIndex.set(condition.key, nextCondition);
      group.conditions.push(nextCondition);
    }
    groups.set(area.key, group);
  }
  return [...groups.values()]
    .map((group) => ({ ...group, conditions: group.conditions.map((condition) => ({ ...condition, events: collapseRepeatedViews(condition.events) })) }))
    .sort((left, right) => left.firstAt.localeCompare(right.firstAt));
}

/** 仅对已完成并追加的事件构建摘要；搜索不触发模板扫描或前后值比较。 */
export class TraceViewCache {
  private sessionId = '';
  private index = createTraceIndex();
  private views = new Map<string, ReturnType<typeof traceEventView>>();
  private ordered: ReturnType<typeof traceEventView>[] = [];
  private eventCount = 0;

  clear() { this.sessionId = ''; this.index.clear(); this.views.clear(); this.ordered = []; this.eventCount = 0; }

  read(session?: TraceSession) {
    if (!session) { this.clear(); return []; }
    if (session.id !== this.sessionId || session.events.length < this.eventCount) {
      this.clear(); this.sessionId = session.id; this.index = createTraceIndex(session.startSnapshot);
    }
    let appended = false;
    for (const event of session.events.slice(this.eventCount)) {
      if (this.views.has(event.id)) continue;
      this.views.set(event.id, traceEventView(event, this.index));
      this.ordered.push(this.views.get(event.id)!);
      appended = true;
    }
    this.eventCount = session.events.length;
    if (appended) this.ordered.sort((a, b) => Number(a.event.id.split('-')[1]) - Number(b.event.id.split('-')[1]));
    return [...this.ordered];
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
  const { reset, eventOffset, startSnapshot, conditionDefinitions, ...session } = update;
  if (reset) {
    if (!startSnapshot || eventOffset !== 0) throw new Error('过程记录初始数据不完整，请重新读取');
    return { ...session, startSnapshot, ...(conditionDefinitions?.length ? { conditionDefinitions } : {}) };
  }
  if (!previous || previous.id !== update.id || previous.events.length !== eventOffset) throw new Error('过程记录游标已失效，请重新读取');
  const definitions = new Map<string, TraceConditionDefinition>((previous.conditionDefinitions ?? []).map((definition) => [definition.key, definition]));
  for (const definition of conditionDefinitions ?? []) definitions.set(definition.key, definition);
  return { ...previous, ...session, events: update.events.length ? [...previous.events, ...update.events] : previous.events,
    ...(definitions.size ? { conditionDefinitions: [...definitions.values()] } : {}) };
}

const timeFormatter = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3, hourCycle: 'h23' });
export function traceTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : timeFormatter.format(date);
}
