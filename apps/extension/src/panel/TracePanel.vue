<script setup lang="ts">
import DismissibleNotice from './DismissibleNotice.vue';
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import type { InspectionSelection, TraceSession } from '@zfs-boe-inspector/shared-types';
import { pageBridge } from './bridge';
import { formatLocalDateTime } from './time';
import { TraceViewCache, mergeTraceUpdate, traceCursor } from './traceView';
import TraceEventCard from './TraceEventCard.vue';

const props = defineProps<{ instanceId: string; supported: boolean; pageId: string; incremental: boolean; valuesSupported: boolean }>();
const emit = defineEmits<{
  update: [session: TraceSession | undefined];
  analyze: [eventId: string, selection?: InspectionSelection];
}>();
const session = shallowRef<TraceSession>();
const views = shallowRef<ReturnType<TraceViewCache['read']>>([]);
const cache = new TraceViewCache();
const page = ref(1);
const pageSize = 50;
const snapshotsOpen = ref(false);
const snapshots = shallowRef<{ start: TraceSession['startSnapshot']; end?: TraceSession['endSnapshot'] }>();
const snapshotJson = computed(() => snapshotsOpen.value ? JSON.stringify(snapshots.value, null, 2) : '');
let generation = 0;
const error = ref('');
const busy = ref(false);
const filter = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
let reading = false;
let disposed = false;
const events = computed(() => views.value.filter((event) => event.search.includes(filter.value.trim().toLowerCase())));
const pageCount = computed(() => Math.max(1, Math.ceil(events.value.length / pageSize)));
const visibleEvents = computed(() => events.value.slice((page.value - 1) * pageSize, page.value * pageSize));
watch(filter, () => { page.value = 1; });
watch(pageCount, (count) => { page.value = Math.min(page.value, count); });

function accept(result: TraceSession | undefined, reset = false) {
  const next = result?.instanceId === props.instanceId ? result : undefined;
  const previous = session.value;
  if (reset || previous?.id !== next?.id) { cache.clear(); page.value = 1; snapshotsOpen.value = false; }
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
onBeforeUnmount(() => { disposed = true; generation += 1; cache.clear(); if (timer) clearInterval(timer); });
</script>

<template>
  <section class="section trace-panel">
    <h2>过程记录</h2>
    <p>开始记录后，在页面手动复现问题，再停止记录并分析。只观察已接入的方法和页面异常。</p>
    <DismissibleNotice v-if="!supported" class="warnings">
      当前 Adapter 不支持过程记录，请升级 Adapter。
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
      <input v-model="filter" placeholder="筛选字段、值、区域、过程或报错">
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
      <TraceEventCard v-for="item in visibleEvents" :key="`${session.id}:${item.event.id}`" :item="item" :active="session.active" @analyze="(id, selection) => emit('analyze', id, selection)" />
      <div v-if="events.length > pageSize" class="list-pagination">
        <button :disabled="page === 1" @click="page -= 1">
          上一页
        </button>
        <span>第 {{ page }} / {{ pageCount }} 页 · {{ events.length }} 条匹配记录</span>
        <button :disabled="page === pageCount" @click="page += 1">
          下一页
        </button>
      </div>
      <details @toggle="snapshotsOpen = ($event.target as HTMLDetailsElement).open">
        <summary>记录前后快照 · 原始数据</summary><pre v-if="snapshotsOpen">{{ snapshotJson }}</pre>
      </details>
    </template>
  </section>
</template>
