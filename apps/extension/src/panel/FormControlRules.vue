<script setup lang="ts">
import { computed } from 'vue';
import { record, structured, displayValue } from './inspectionView';
import { comparisonLabels, fieldCaption } from './propertyJsonView';
import ConfigValueTree from './ConfigValueTree.vue';

const props = defineProps<{ code: string; value: unknown; areaCode: string; names: Map<string, string> }>();
const operators: Record<string, string> = { ...comparisonLabels, '!=': '不等于', contains: '包含', notContains: '不包含', isNull: '为空', isNotNull: '不为空' };
const results: Record<string, string[]> = { formShow: ['显示', '隐藏'], formEdit: ['可编辑', '不可编辑'], formRequire: ['必填', '非必填'] };

function conditionRow(value: unknown) {
  const item = record(value);
  const code = typeof item.code === 'string' ? item.code : '';
  const name = fieldCaption(code, props.areaCode, props.names);
  const type = String(item.type);
  const date = ['date', 'datetime', 'month'].includes(type);
  const fieldReference = (['num', 'amount'].includes(type) && item.compareType === '02') || (date && item.compareType === '03');
  let comparison = displayValue(item.compareValue);
  if (date && item.compareType === '01') comparison = '当前日期';
  else if (fieldReference && typeof item.compareValue === 'string') comparison = `字段：${fieldCaption(item.compareValue, props.areaCode, props.names)}`;
  else if (typeof item.compareValue === 'string' && item.compareValue !== '') comparison = JSON.stringify(item.compareValue);
  if (item.compareLabel !== null && item.compareLabel !== undefined && item.compareLabel !== '') comparison += `（${displayValue(item.compareLabel)}）`;
  const operator = String(item.operator ?? '');
  return {
    '字段': name === code && item.fieldUniqName ? `${item.fieldUniqName}（${code}）` : name || '未配置字段',
    '比较关系': Object.hasOwn(operators, operator) ? operators[operator] : operator || '未配置',
    '比较值': ['isNull', 'isNotNull'].includes(operator) ? '—' : comparison,
  };
}

const rows = computed(() => Array.isArray(props.value) ? props.value.map((value, index) => {
  const rule = record(value);
  const parsed = structured(rule.condition);
  const form = record(parsed.value).form;
  const valid = !parsed.error && Array.isArray(form) && form.every((group) => Array.isArray(group)
    && group.every((item) => typeof record(item).code === 'string' && typeof record(item).operator === 'string'));
  return { index, raw: value, valid,
    result: rule.flag === 1 ? results[props.code]?.[0] : rule.flag === 2 ? results[props.code]?.[1] : `未知控制值：${displayValue(rule.flag)}`,
    groups: valid && Array.isArray(form) ? form.map((group) => (group as unknown[]).map(conditionRow)) : [],
  };
}) : undefined);
</script>

<template>
  <div>
    <template v-if="rows">
      <p class="muted">
        按顺序取首条满足的规则；以下为配置说明，未执行条件判断。
      </p>
      <article v-for="row in rows" :key="row.index" class="form-control-rule">
        <h4>规则 {{ row.index + 1 }} <span>满足后：{{ row.result }}</span></h4>
        <template v-if="row.valid">
          <p v-if="!row.groups.length" class="muted">
            未设置条件，始终满足
          </p>
          <p v-else-if="row.groups.length > 1" class="muted">
            任一分组满足
          </p>
          <section v-for="(group, index) in row.groups" :key="index" class="form-condition-group">
            <div class="group-label">
              {{ row.groups.length > 1 ? `分组 ${index + 1} · ` : '' }}全部满足
            </div>
            <ConfigValueTree v-if="group.length" :value="group" />
            <p v-else class="muted">
              空分组，始终满足
            </p>
          </section>
        </template>
        <template v-else>
          <p class="muted">
            此条件格式暂不支持语义转换，以下保留配置内容。
          </p>
          <ConfigValueTree :value="row.raw" />
        </template>
      </article>
    </template>
    <ConfigValueTree v-else :value="value" />
  </div>
</template>

<style scoped>
.form-control-rule { padding: 12px; border: 1px solid #e7e8ee; border-radius: 6px; }
.form-control-rule + .form-control-rule { margin-top: 12px; }
h4 { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 12px; font-size: 13px; }
h4 span { color: #4c3edb; font-weight: 500; }
.form-condition-group + .form-condition-group { margin-top: 12px; }
.group-label { margin-bottom: 8px; color: #667086; }
</style>
