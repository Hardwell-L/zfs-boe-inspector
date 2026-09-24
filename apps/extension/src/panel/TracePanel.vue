<script setup lang="ts">
import DismissibleNotice from './DismissibleNotice.vue';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { InspectionSelection, TraceSession } from '@zfs-boe-inspector/shared-types';
import { pageBridge } from './bridge';
import { formatLocalDateTime } from './time';
import { TraceViewCache, mergeTraceUpdate, traceCursor, traceGroups, traceTime } from './traceView';
import TraceEventCard from './TraceEventCard.vue';

const props = defineProps<{ instanceId: string; supported: boolean; pageId: string; incremental: boolean; valuesSupported: boolean; legacyTraceUnavailable?: boolean }>();
const unsupportedMessage = computed(() => props.legacyTraceUnavailable
  ? '当前项目处于低版本兼容模式，默认不支持过程记录。'
  : '当前 Adapter 不支持过程记录，请升级 Adapter。');
const emit = defineEmits<{
  update: [session: TraceSession | undefined];
  analyze: [eventId: string, selection?: InspectionSelection];
}>();
const session = shallowRef<TraceSession>();
const views = shallowRef<ReturnType<TraceViewCache['read']>>([]);
const cache = new TraceViewCache();
const conditionPageSize = 50;
const conditionPages = ref<Record<string, number>>({});
const snapshotsOpen = ref(false);
const snapshots = shallowRef<{ start: TraceSession['startSnapshot']; end?: TraceSession['endSnapshot'] }>();
const snapshotJson = computed(() => snapshotsOpen.value ? JSON.stringify(snapshots.value, null, 2) : '');
let generation = 0;
const error = ref('');
const busy = ref(false);
const filter = ref('');
const filterInput = ref('');
let filterTimer: ReturnType<typeof window.setTimeout> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let reading = false;
let disposed = false;
const conditionSearch = computed(() => new Map((session.value?.conditionDefinitions ?? []).map((definition) => [
  definition.key,
  `${definition.key} ${definition.ruleId ?? ''} ${definition.label ?? ''} ${definition.expression === undefined ? '' : JSON.stringify(definition.expression)}`.toLowerCase(),
])));
const events = computed(() => {
  const keyword = filter.value.trim().toLowerCase();
  return views.value.filter((event) => `${event.search} ${(event.event.conditions ?? []).map((condition) => conditionSearch.value.get(condition.key) ?? condition.key).join(' ')}`.includes(keyword));
});
const groups = computed(() => traceGroups(events.value, session.value?.conditionDefinitions));
const visibleGroups = computed(() => groups.value.map((group) => ({
  ...group,
  conditions: group.conditions.map((condition) => {
    const paginationKey = `${group.key}:${condition.key}`;
    const pageCount = Math.max(1, Math.ceil(condition.events.length / conditionPageSize));
    const page = Math.min(conditionPages.value[paginationKey] ?? 1, pageCount);
    return {
      ...condition,
      paginationKey,
      page,
      pageCount,
      events: condition.events.slice((page - 1) * conditionPageSize, page * conditionPageSize),
    };
  }).filter((condition) => condition.events.length),
})).filter((group) => group.conditions.length));
watch(filterInput, (value) => {
  if (filterTimer) window.clearTimeout(filterTimer);
  filterTimer = window.setTimeout(() => { filter.value = value; }, 150);
});
watch(filter, () => { conditionPages.value = {}; });

function setConditionPage(paginationKey: string, page: number) {
  conditionPages.value = { ...conditionPages.value, [paginationKey]: Math.max(1, page) };
}

function accept(result: TraceSession | undefined, reset = false) {
  const next = result?.instanceId === props.instanceId ? result : undefined;
  const previous = session.value;
  if (reset || previous?.id !== next?.id) { cache.clear(); conditionPages.value = {}; snapshotsOpen.value = false; }
  if (reset || previous?.id !== next?.id || previous?.events.length !== next?.events.length) views.value = cache.read(next);
  if (previous?.startSnapshot !== next?.startSnapshot || previous?.endSnapshot !== next?.endSnapshot) {
    snapshots.value = next ? { start: next.startSnapshot, ...(next.endSnapshot ? { end: next.endSnapshot } : {}) } : undefined;
  }
  session.value = next;
  emit('update', next);
}

async function read() {
  if (reading || busy.value || !props.supported || !props.pageId || disposed) return;
  reading = true;
  const run = generation;
  const instanceId = props.instanceId;
  const pageId = props.pageId;
  try {
    const previous = session.value;
    const result = props.incremental
      ? mergeTraceUpdate(previous, await pageBridge.getTraceUpdate(traceCursor(previous), pageId))
      : await pageBridge.getTrace(pageId);
    if (disposed || run !== generation || props.instanceId !== instanceId || props.pageId !== pageId) return;
    accept(result);
  } catch (reason) {
    if (run === generation && !disposed) error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    reading = false;
    if (run !== generation && !busy.value && !disposed) void read();
  }
}

async function action(kind: 'start' | 'stop' | 'clear') {
  if (!props.pageId || busy.value) return;
  const pageId = props.pageId;
  const run = ++generation;
  busy.value = true;
  error.value = '';
  try {
    if (kind === 'start') {
      const result = await pageBridge.startTrace(props.instanceId, pageId);
      if (!disposed && run === generation) accept(result, true);
    } else if (kind === 'stop') {
      const result = await pageBridge.stopTrace(pageId, props.incremental);
      if (!disposed && run === generation) {
        if (props.incremental) {
          const next = mergeTraceUpdate(session.value, await pageBridge.getTraceUpdate(traceCursor(session.value), pageId));
          if (!disposed && run === generation) accept(next);
        } else accept(result);
      }
    } else {
      await pageBridge.clearTrace(pageId);
      if (!disposed && run === generation) accept(undefined);
    }
  } catch (reason) { if (!disposed && run === generation) error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; if (run !== generation && !disposed) void read(); }
}

watch(() => [props.instanceId, props.supported, props.pageId], () => {
  generation += 1;
  accept(undefined);
  if (timer) clearInterval(timer);
  if (props.supported && props.pageId) {
    void read();
    timer = setInterval(() => { if (session.value?.active) void read(); }, 1000);
  }
}, { immediate: true });
onBeforeUnmount(() => { disposed = true; generation += 1; cache.clear(); if (timer) clearInterval(timer); if (filterTimer) window.clearTimeout(filterTimer); });
</script>

<template>
  <section class="section trace-panel">
    <h2>过程记录</h2>
    <p>开始记录后，在页面手动复现问题，再停止记录并分析。只观察已接入的方法和页面异常。</p>
    <DismissibleNotice v-if="!supported" :notice-key="unsupportedMessage" class="warnings">
      {{ unsupportedMessage }}
    </DismissibleNotice>
    <DismissibleNotice v-if="supported && !valuesSupported" class="warnings">
      当前 Adapter 未声明触发值采集能力。若记录只包含字段名称，请更新业务侧 Adapter、重启业务服务并刷新页面后重新录制；仅更新扩展不会升级页面中的 Adapter。
    </DismissibleNotice>
    <div class="tool-actions">
      <button :disabled="!supported || busy || session?.active" @click="action('start')">
        开始新记录
      </button>
      <button :disabled="busy || !session?.active" @click="action('stop')">
        停止记录
      </button>
      <button :disabled="busy || !session" @click="action('clear')">
        清空
      </button>
      <input v-model="filterInput" placeholder="筛选字段、值、区域、过程或报错">
    </div>
    <DismissibleNotice v-if="error" :notice-key="error" class="error-banner" role="alert" @close="error = ''">
      {{ error }}
    </DismissibleNotice>
    <template v-if="session">
      <p>
        {{ session.active ? '记录中' : '已停止' }} · {{ session.events.length }} 条 · 开始 {{ formatLocalDateTime(session.startedAt) }}<template v-if="session.stoppedAt">
          · 结束 {{ formatLocalDateTime(session.stoppedAt) }}
        </template> · {{ session.reason }}
      </p>
      <DismissibleNotice v-if="session.stopDetail && !['user', 'instance-changed'].includes(session.stopDetail.code)" :notice-key="`${session.id}:${session.stopDetail.code}`" class="warnings">
        记录因{{ session.stopDetail.code === 'recursion-depth' ? '同步调用深度过高' : session.stopDetail.code === 'event-storm' ? '事件速率过高' : session.stopDetail.code === 'event-limit' ? '事件数量达到上限' : session.stopDetail.code === 'size-limit' ? '记录容量达到上限' : '采集保护' }}停止；已保留 {{ session.events.length }} 条事件。
      </DismissibleNotice>
      <details>
        <summary>追踪覆盖与证据缺口</summary>
        <p v-for="capability in session.coverage" :key="capability.method">
          {{ capability.method }}：{{ capability.supported ? '可观察入口（部分覆盖）' : '未支持' }}
        </p>
        <p v-for="limitation in session.limitations" :key="limitation">
          {{ limitation }}
        </p>
      </details>
      <p v-if="!events.length" class="muted">
        {{ session.events.length ? '当前筛选条件下没有记录。' : '尚未记录到事件。' }}
      </p>
      <details v-for="group in visibleGroups" :key="`${session.id}:${group.key}`" class="trace-area-group" open>
        <summary>
          <span class="trace-area-summary">
            <span class="trace-area-label">区域名称：</span>
            <strong>{{ group.areaName }}</strong>
            <span class="trace-group-count">{{ group.total }} 条</span>
            <span class="trace-group-time">· {{ traceTime(group.firstAt) }}—{{ traceTime(group.lastAt) }}</span>
          </span>
        </summary>
        <details v-for="condition in group.conditions" :key="`${group.key}:${condition.key}`" class="trace-condition-group">
          <summary><span class="trace-condition-summary"><strong>{{ condition.label }}</strong><span class="muted">{{ condition.total }} 条</span></span></summary>
          <TraceEventCard v-for="item in condition.events" :key="`${session.id}:${item.event.id}`" :item="item" :active="session.active" @analyze="(id, selection) => emit('analyze', id, selection)" />
          <div v-if="condition.pageCount > 1" class="list-pagination trace-condition-pagination">
            <button :disabled="condition.page === 1" @click.stop="setConditionPage(condition.paginationKey, condition.page - 1)">
              上一页
            </button>
            <span>第 {{ condition.page }} / {{ condition.pageCount }} 页 · {{ condition.total }} 条记录</span>
            <button :disabled="condition.page === condition.pageCount" @click.stop="setConditionPage(condition.paginationKey, condition.page + 1)">
              下一页
            </button>
          </div>
        </details>
      </details>
      <details @toggle="snapshotsOpen = ($event.target as HTMLDetailsElement).open">
        <summary>记录前后快照 · 原始数据</summary><pre v-if="snapshotsOpen">{{ snapshotJson }}</pre>
      </details>
    </template>
  </section>
</template>
