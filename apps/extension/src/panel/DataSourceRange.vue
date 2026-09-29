<script setup lang="ts">
import { computed } from 'vue';
import { record, structured, displayValue } from './inspectionView';
import { fieldCaption } from './propertyJsonView';
import ConfigValueTree from './ConfigValueTree.vue';

const props = defineProps<{ value: unknown; areaCode: string; names: Map<string, string> }>();
const operators: Record<string, string> = { '1': '为空', '2': '不为空', '3': '包含', '4': '不包含', '5': '大于', '6': '等于', '7': '小于', '8': '不等于', '9': '大于等于', '10': '小于等于' };
function row(value: unknown, associated: boolean) {
  const item = record(value);
  const code = [item.leftAreaCode, item.leftFieldCode].filter(Boolean).join('.');
  const caption = associated ? fieldCaption(code, props.areaCode, props.names) : code;
  const field = caption === code && item.leftFieldName ? `${item.leftFieldName}（${code}）` : caption;
  const operator = String(item.conditionType ?? '');
  let right = typeof item.rightValue === 'string' && item.rightValue !== '' ? JSON.stringify(item.rightValue) : displayValue(item.rightValue);
  if (associated) {
    const path = [item.rightAreaValue, item.rightValue].filter(Boolean).join('.');
    right = item.rightValueName ? `${item.rightValueName}（${path}）` : path;
  }
  return {
    [associated ? '单据字段' : '数据源字段']: field || '未配置',
    '比较关系': Object.hasOwn(operators, operator) ? operators[operator] : `未知编码：${operator}`,
    [associated ? '关联数据源字段' : '比较值']: ['1', '2'].includes(operator) ? '—' : right,
  };
}
const sections = computed(() => Object.entries(record(props.value)).map(([key, raw]) => {
  const parsed = structured(raw);
  const value = parsed.value;
  const known = ['refJson', 'dataLimitJson'].includes(key);
  const valid = known && !parsed.error && Array.isArray(value) && value.every((group) => Array.isArray(group)
    && group.every((item) => typeof record(item).leftFieldCode === 'string' && record(item).conditionType !== undefined));
  return { key, raw: value, title: key === 'refJson' ? '关联条件' : key === 'dataLimitJson' ? '数据范围' : key, valid,
    groups: valid && Array.isArray(value) ? value.map((group) => (group as unknown[]).map((item) => row(item, key === 'refJson'))) : [],
  };
}));
</script>

<template>
  <section v-for="section in sections" :key="section.key" class="range-section">
    <h4>{{ section.title }}</h4>
    <template v-if="section.valid">
      <p v-if="!section.groups.length" class="muted">
        未配置条件
      </p>
      <p v-else-if="section.groups.length > 1" class="muted">
        任一分组满足
      </p>
      <div v-for="(group, index) in section.groups" :key="index" class="range-group">
        <p class="muted">
          {{ section.groups.length > 1 ? `分组 ${index + 1} · ` : '' }}全部满足
        </p>
        <ConfigValueTree v-if="group.length" :value="group" />
        <p v-else class="muted">
          空分组
        </p>
      </div>
    </template>
    <ConfigValueTree v-else :value="section.raw" />
  </section>
</template>

<style scoped>
.range-section + .range-section { margin-top: 16px; padding-top: 12px; border-top: 1px solid #e7e8ee; }
h4 { margin: 0 0 10px; font-size: 13px; }
.range-group + .range-group { margin-top: 12px; }
.range-group > p { margin-bottom: 8px; }
</style>
