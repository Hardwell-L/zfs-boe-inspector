<script setup lang="ts">
import { computed } from 'vue';
import { record, displayValue } from './inspectionView';
import { comparisonLabels, fieldCaption } from './propertyJsonView';
import ConfigValueTree from './ConfigValueTree.vue';

const props = withDefaults(defineProps<{ value: unknown; areaCode: string; names: Map<string, string>; inheritedAction?: unknown; depth?: number }>(), { depth: 0, inheritedAction: undefined });
const rule = computed<Record<string, unknown>>(() => Array.isArray(props.value) ? { method: 'some', action: '=', conditions: props.value } : record(props.value));
const group = computed(() => Array.isArray(rule.value.conditions) && ['some', 'every'].includes(String(rule.value.method)));
const action = computed(() => rule.value.action === undefined ? props.inheritedAction : rule.value.action);
const leaf = computed(() => typeof rule.value.code === 'string' && rule.value.value !== undefined && typeof action.value === 'string'
  && Object.hasOwn(comparisonLabels, action.value));
const fieldName = computed(() => {
  const code = String(rule.value.code ?? '');
  return props.names.get(code.includes('.') ? code : `${props.areaCode}.${code}`);
});
const comparisonValue = computed(() => {
  const value = rule.value.value;
  return typeof value === 'string' && value !== '' ? JSON.stringify(value).replace(/\$\{([\w.]+)\}/g,
    (_, code: string) => `\${${fieldCaption(code, props.areaCode, props.names)}}`) : displayValue(value);
});
</script>

<template>
  <div class="dynamic-condition-tree">
    <template v-if="group && depth < 6">
      <div class="condition-relation">
        <span>{{ rule.method === 'every' ? '全部满足' : '任一满足' }}</span>
        <small>{{ (rule.conditions as unknown[]).length }} 条条件</small>
      </div>
      <p v-if="!(rule.conditions as unknown[]).length" class="muted">
        未配置判断条件
      </p>
      <ol v-else>
        <li v-for="(condition, index) in (rule.conditions as unknown[])" :key="index">
          <span class="condition-index" aria-hidden="true">{{ index + 1 }}</span>
          <DynamicConditionTree :value="condition" :area-code="areaCode" :names="names" :inherited-action="action" :depth="depth + 1" />
        </li>
      </ol>
    </template>
    <div v-else-if="leaf" class="condition-leaf">
      <span class="condition-field">
        <span>{{ fieldName || rule.code }}</span>
        <small v-if="fieldName">{{ rule.code }}</small>
      </span>
      <strong>{{ comparisonLabels[String(action)] }}</strong>
      <span class="condition-value">{{ comparisonValue }}</span>
    </div>
    <ConfigValueTree v-else :value="value" />
  </div>
</template>

<style scoped>
.dynamic-condition-tree { min-width: 0; }
.condition-relation { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.condition-relation > span { padding: 3px 8px; border-radius: 5px; background: #eceaff; color: #4c3edb; font-weight: 600; }
.condition-relation small { color: #858da0; font-weight: 400; }
ol { margin: 0; padding: 0; list-style: none; border: 1px solid #e7e8ee; border-radius: 6px; overflow: hidden; }
li { display: grid; grid-template-columns: 22px minmax(0, 1fr); gap: 8px; padding: 9px 10px; }
li + li { border-top: 1px solid #e7e8ee; }
li:nth-child(even) { background: #fafbfc; }
.condition-index { padding-top: 2px; color: #858da0; font-size: 12px; }
.condition-leaf { display: grid; grid-template-columns: minmax(0, 1.4fr) 64px minmax(0, 1fr); gap: 10px; align-items: center; line-height: 1.6; }
.condition-field { min-width: 0; color: #1d2433; }
.condition-field small { display: block; color: #858da0; font-size: 11px; }
strong { font-weight: 400; color: #667086; text-align: center; font-size: 12px; }
.condition-value { min-width: 0; white-space: pre-wrap; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
</style>
