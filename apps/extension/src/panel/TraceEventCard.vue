<script setup lang="ts">
import { computed, ref } from 'vue';
import type { InspectionSelection } from '@zfs-boe-inspector/shared-types';
import { traceChanges, type traceEventView } from './traceView';

const props = defineProps<{ item: ReturnType<typeof traceEventView>; active: boolean }>();
const emit = defineEmits<{ analyze: [eventId: string, selection?: InspectionSelection] }>();
const opened = ref(false);
const rawOpened = ref(false);
const changes = computed(() => opened.value ? traceChanges(props.item.event) : []);
const rawJson = computed(() => rawOpened.value ? JSON.stringify(props.item.event, null, 2) : '');
function toggle(event: InstanceType<typeof window.Event>) {
  if (event.target === event.currentTarget) opened.value = (event.target as InstanceType<typeof window.HTMLDetailsElement>).open;
}
</script>

<template>
  <details class="trace-event trace-event-card" :open="opened" @toggle="toggle">
    <summary>
      <span class="trace-event-summary-content">
        <span v-for="(trigger, index) in item.triggers" :key="index" class="trace-trigger-preview">
          <strong>{{ trigger.name }}</strong> · {{ trigger.areaName }} · {{ trigger.areaCode }}.{{ trigger.fieldCode }} · {{ trigger.rowIndex === undefined ? '行号未采集' : `第 ${trigger.rowIndex + 1} 行` }}
          <span>{{ trigger.sourceLabel }}：{{ trigger.preview }}</span>
          <span v-if="trigger.reasonText" class="trace-value-reason">{{ trigger.reasonText }}</span>
        </span>
        <span v-if="!item.triggers.length" class="muted">触发字段／值未采集</span>
        <span v-if="item.event.triggersOmitted" class="muted">另 {{ item.event.triggersOmitted }} 个字段超过采集上限，未展示。</span>
        <span v-if="item.repeatCount > 1" class="trace-repeat-count">重复 {{ item.repeatCount }} 次</span>
      </span>
    </summary>
    <div v-if="opened" class="trace-event-body">
      <p v-if="item.event.error" class="error-banner">
        {{ item.event.error }}
      </p>
      <p v-if="item.event.parentId" class="muted">
        同步调用来源：{{ item.event.parentId }}
      </p>
      <p v-if="['reCalculate', 'reComputed'].includes(item.event.method)" class="muted">
        计算目标：{{ item.event.areaCode }}.{{ item.event.fieldCode }}（实际写入行以字段更新事件为准）
      </p>
      <dl v-if="item.triggers.length" class="readable-values">
        <template v-for="(trigger, index) in item.triggers" :key="index">
          <dt>
            {{ trigger.name }} · {{ trigger.areaName }} · {{ trigger.areaCode }}.{{ trigger.fieldCode }} · {{ trigger.rowIndex === undefined ? '行号未采集' : `第 ${trigger.rowIndex + 1} 行` }}
          </dt>
          <dd>
            {{ trigger.sourceLabel }}：{{ trigger.text }}
            <span v-if="trigger.reasonText" class="trace-value-reason">{{ trigger.reasonText }}</span>
          </dd>
        </template>
      </dl>
      <p v-else class="muted">
        触发字段／值未采集
      </p>
      <p v-if="item.event.triggersOmitted" class="muted">
        另 {{ item.event.triggersOmitted }} 个字段超过采集上限，未展示。
      </p>
      <div v-if="changes.length" class="table-scroll">
        <table class="data-table">
          <thead><tr><th>字段</th><th>进入时值</th><th>同步返回时值</th></tr></thead>
          <tbody>
            <tr v-for="change in changes" :key="change.field">
              <td>{{ change.field }}</td><td>{{ change.before }}</td><td>{{ change.after }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-else class="muted">
        未观察到可比较的同步字段变化。
      </p>
      <details @toggle="rawOpened = ($event.target as HTMLDetailsElement).open">
        <summary>原始数据（保留时间精度）</summary><pre v-if="rawOpened">{{ rawJson }}</pre>
      </details>
      <button :disabled="active" @click="emit('analyze', item.event.id, item.event.areaCode ? { kind: 'area', areaCode: item.event.areaCode } : undefined)">
        交给 AI 分析
      </button>
    </div>
  </details>
</template>
