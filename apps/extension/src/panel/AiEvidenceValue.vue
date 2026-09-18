<script setup lang="ts">
import { computed } from 'vue';
import { formatLocalDateTime } from './time';
const props = withDefaults(defineProps<{ value: unknown; field?: string; trace?: boolean; expanded?: boolean }>(), { expanded: false, field: '', trace: false });
const entries = computed(() => props.value !== null && typeof props.value === 'object' ? Object.entries(props.value) : undefined);
const labels: Record<string, string> = {
  status: '采集状态', value: '当前值', displayValue: '显示值', runtimeState: '运行状态', visible: '显示', editable: '可编辑', required: '必填',
  fieldCode: '字段编码', areaCode: '区域编码', rowIndex: '行索引', summary: '结论', evidencePaths: '证据路径', limitations: '采集限制',
  __kind: '采集标记', warnings: '提示', meta: '单据背景', config: '配置', dependencyRefs: '关联依据', technicalDetail: '技术详情',
  startedAt: '开始时间', stoppedAt: '结束时间', at: '发生时间', method: '方法', category: '类别', error: '错误',
  before: '执行前', after: '执行后', input: '输入', output: '输出', note: '说明', missing: '缺失信息',
};
const primitive = computed(() => {
  const value = props.value;
  if (value === undefined) return '未采集';
  if (value === null) return 'null';
  if (value === '') return '空字符串';
  if (props.trace && ['startedAt', 'stoppedAt', 'at'].includes(props.field)) return formatLocalDateTime(value);
  if (['status', '__kind'].includes(props.field) && typeof value === 'string') return ({ unavailable: '未采集', missing: '字段缺失', truncated: '内容已截断', present: '已采集' } as Record<string, string>)[value] ?? value;
  return String(value);
});
</script>

<template>
  <details v-if="entries" class="ai-value-tree" :open="expanded">
    <summary>{{ Array.isArray(value) ? `列表 · ${entries.length} 项` : `属性 · ${entries.length} 项` }}</summary>
    <dl>
      <template v-for="[key, item] in entries" :key="key">
        <dt>{{ Array.isArray(value) ? `第 ${Number(key) + 1} 项` : labels[key] || key }}</dt>
        <dd><AiEvidenceValue :value="item" :field="key" :trace="trace && ['startedAt', 'stoppedAt', 'at'].includes(key)" /></dd>
      </template>
    </dl>
  </details>
  <span v-else class="ai-value-text">{{ primitive }}</span>
</template>
