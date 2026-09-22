<script setup lang="ts">
import DismissibleNotice from './DismissibleNotice.vue';
import { computed, ref } from 'vue';
import type { InspectionSelection } from '@zfs-boe-inspector/shared-types';
import type { FrozenEvidence } from './useAiWorkspace';
import AiEvidenceValue from './AiEvidenceValue.vue';
const props = defineProps<{ evidence: FrozenEvidence[]; canLocate: boolean; requests: unknown }>();
const emit = defineEmits<{ locate: [selection: InspectionSelection] }>();
const groups = computed(() => [
  ['context', '单据背景'], ['selected', '所选字段与范围'], ['dependencies', '关联依赖'], ['diagnostics', '诊断'], ['trace', '过程'], ['knowledge', '参考文档'],
].map(([key, label]) => ({ key, label, items: props.evidence.filter((item) => item.group === key) })).filter((group) => group.items.length));
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
const runtimeFlags = [['visible', '显示'], ['editable', '可编辑'], ['required', '必填']] as const;
function runtime(item: FrozenEvidence, key: string) { return record(record(item.value).runtimeState)[key]; }
const copyStatus = ref('');
async function copyTechnical() {
  copyStatus.value = '';
  try { await window.navigator.clipboard.writeText(JSON.stringify(props.requests, null, 2) ?? ''); copyStatus.value = '已复制原始数据'; }
  catch { copyStatus.value = '复制失败，请手动选择文本'; }
}
</script>

<template>
  <section v-for="group in groups" :key="group.key" class="ai-evidence-group">
    <h4>{{ group.label }}</h4>
    <article v-for="item in group.items" :key="item.id" class="ai-evidence-item">
      <strong>[{{ item.id }}] {{ item.title }}</strong>
      <button v-if="item.selection" :disabled="!canLocate" @click="emit('locate', item.selection)">
        定位
      </button>
      <div v-if="item.kind === 'value' && item.selection?.kind === 'field'" class="ai-table">
        <table>
          <tbody>
            <tr><th>区域 / 字段 / 行</th><td>{{ item.selection.areaCode }} / {{ item.selection.fieldCode }} / 第 {{ item.selection.rowIndex + 1 }} 行</td></tr>
            <tr><th>采集状态</th><td><AiEvidenceValue :value="record(item.value).status" field="status" /></td></tr>
            <tr><th>当前值</th><td><AiEvidenceValue :value="record(item.value).value" /></td></tr>
            <tr><th>显示值</th><td><AiEvidenceValue :value="record(item.value).displayValue" /></td></tr>
            <tr v-for="[key, label] in runtimeFlags" :key="key">
              <th>{{ label }}</th><td><AiEvidenceValue :value="runtime(item, key)" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <AiEvidenceValue v-else :expanded="true" :value="item.value" :trace="item.group === 'trace'" />
    </article>
  </section>
  <details class="ai-technical-details">
    <summary>技术详情 · 原始数据（保留时间精度）</summary>
    <button @click="copyTechnical">
      复制原始数据
    </button><DismissibleNotice v-if="copyStatus" :auto-close-ms="copyStatus === '已复制原始数据' ? 3000 : 0" :notice-key="copyStatus" @close="copyStatus = ''">
      {{ copyStatus }}
    </DismissibleNotice>
    <pre>{{ JSON.stringify(requests, null, 2) }}</pre>
  </details>
</template>
