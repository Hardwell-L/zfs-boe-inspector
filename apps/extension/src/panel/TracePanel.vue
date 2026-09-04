<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { InspectionSelection, TraceSession } from '@zfs-boe-inspector/shared-types';
import { pageBridge } from './bridge';

const props = defineProps<{ instanceId: string; supported: boolean }>();
const emit = defineEmits<{
  update: [session: TraceSession | undefined];
  analyze: [eventId: string, selection?: InspectionSelection];
}>();
const session = ref<TraceSession>();
const error = ref('');
const busy = ref(false);
const filter = ref('');
let timer: ReturnType<typeof setInterval> | undefined;
let reading = false;
const events = computed(() => [...(session.value?.events ?? [])].sort((a, b) => Number(a.id.split('-')[1]) - Number(b.id.split('-')[1])).filter((event) =>
  `${event.category} ${event.method} ${event.areaCode ?? ''} ${event.fieldCode ?? ''} ${event.error ?? ''}`.toLowerCase().includes(filter.value.toLowerCase())));

async function read() {
  if (reading || !props.supported) return;
  reading = true;
  const instanceId = props.instanceId;
  try {
    const result = await pageBridge.getTrace();
    if (props.instanceId !== instanceId) return;
    session.value = result?.instanceId === instanceId ? result : undefined;
    emit('update', session.value);
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally {
    reading = false;
    if (props.instanceId !== instanceId) void read();
  }
}

async function action(kind: 'start' | 'stop' | 'clear') {
  busy.value = true;
  error.value = '';
  try {
    if (kind === 'start') await pageBridge.startTrace(props.instanceId);
    else if (kind === 'stop') await pageBridge.stopTrace();
    else await pageBridge.clearTrace();
    await read();
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}

watch(() => [props.instanceId, props.supported], () => {
  session.value = undefined;
  emit('update', undefined);
  if (timer) clearInterval(timer);
  if (props.supported) {
    void read();
    timer = setInterval(() => { if (session.value?.active) void read(); }, 1000);
  }
}, { immediate: true });
onBeforeUnmount(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <section class="section trace-panel">
    <h2>过程记录</h2>
    <p>开始记录后，在页面手动复现问题，再停止记录并分析。只观察已接入的方法和页面异常。</p>
    <p v-if="!supported" class="warnings">
      当前 Adapter 不支持过程记录，请升级 Adapter。
    </p>
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
      <input v-model="filter" placeholder="筛选字段、区域、过程或报错">
    </div>
    <p v-if="error" class="error-banner">
      {{ error }}
    </p>
    <template v-if="session">
      <p>{{ session.active ? '记录中' : '已停止' }} · {{ session.events.length }} 条 · {{ session.startedAt }} · {{ session.reason }}</p>
      <details>
        <summary>追踪覆盖与证据缺口</summary>
        <p v-for="capability in session.coverage" :key="capability.method">
          {{ capability.method }}：{{ capability.supported ? '可观察入口（部分覆盖）' : '未支持' }}
        </p>
        <p v-for="limitation in session.limitations" :key="limitation">
          {{ limitation }}
        </p>
      </details>
      <details v-for="event in events" :key="event.id" class="trace-event">
        <summary>{{ event.at }} · {{ event.category }} · {{ event.method }} · {{ event.status }}</summary>
        <p>{{ event.areaCode }} {{ event.fieldCode }} {{ event.rowIndex === undefined ? '' : `第 ${event.rowIndex + 1} 行` }}</p>
        <pre>{{ JSON.stringify(event, null, 2) }}</pre>
        <button :disabled="session.active" @click="emit('analyze', event.id, event.areaCode ? { kind: 'area', areaCode: event.areaCode } : undefined)">
          交给 AI 分析
        </button>
      </details>
      <details><summary>记录前后快照</summary><pre>{{ JSON.stringify({ start: session.startSnapshot, end: session.endSnapshot }, null, 2) }}</pre></details>
    </template>
  </section>
</template>
