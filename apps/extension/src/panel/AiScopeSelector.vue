<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { BoeInspectionSnapshot, InspectionSelection } from '@zfs-boe-inspector/shared-types';
import { scopeAreas, uniqueScopes } from './aiScopes';
import { scopeIdentity } from './aiContext';

const props = defineProps<{ snapshot: BoeInspectionSnapshot; scopes: InspectionSelection[]; disabled: boolean }>();
const emit = defineEmits<{ change: [scopes: InspectionSelection[]] }>();
const search = ref('');
const rowChoices = ref<Record<string, string>>({});
const areas = computed(() => scopeAreas(props.snapshot));
type Area = ReturnType<typeof scopeAreas>[number];
type Field = Area['fields'][number];
const selectionIndex = computed(() => {
  const fields = new Set<string>();
  const rowsByArea = new Map<string, Set<number> | null>();
  for (const scope of props.scopes) {
    if (scope.kind === 'field') fields.add(JSON.stringify([scope.areaCode, scope.fieldCode, scope.rowIndex]));
    if (scope.kind === 'area') {
      if (!scope.rowIndexes) rowsByArea.set(scope.areaCode, null);
      else if (rowsByArea.get(scope.areaCode) !== null) rowsByArea.set(scope.areaCode, new Set([...(rowsByArea.get(scope.areaCode) ?? []), ...scope.rowIndexes]));
    }
  }
  return { fields, rowsByArea, bill: props.scopes.some((scope) => scope.kind === 'bill') };
});
const visibleAreas = computed(() => {
  const query = search.value.trim().toLowerCase();
  return areas.value.map((area) => ({ ...area, fields: area.fields.filter((field) =>
    `${area.code} ${area.label} ${field.code} ${field.label}`.toLowerCase().includes(query)) })).filter((area) => area.fields.length);
});

watch(() => props.snapshot, () => {
  for (const area of areas.value) {
    const choice = rowChoices.value[area.code];
    if (!area.rows.length || (choice !== 'all' && (!choice || Number(choice) >= area.rows.length))) rowChoices.value[area.code] = '0';
  }
}, { immediate: true });

function rowsFor(area: Area) {
  return rowChoices.value[area.code] === 'all'
    ? Array.from({ length: Math.max(1, area.rows.length) }, (_, index) => index)
    : [Number(rowChoices.value[area.code] ?? 0)];
}
function covered(area: string, field: string, row: number) {
  const index = selectionIndex.value;
  return index.bill || index.rowsByArea.get(area) === null || index.rowsByArea.get(area)?.has(row)
    || index.fields.has(JSON.stringify([area, field, row]));
}
function selectionCount(area: Area, fields: Field[]) {
  return fields.reduce((count, field) => count + rowsFor(area).filter((row) => covered(area.code, field.code, row)).length, 0);
}
function fullySelected(area: Area, fields: Field[]) {
  return selectionCount(area, fields) === fields.length * rowsFor(area).length;
}
function partiallySelected(area: Area, fields: Field[]) {
  return selectionCount(area, fields) > 0 && !fullySelected(area, fields);
}
function expandScope(scope: InspectionSelection): InspectionSelection[] {
  if (scope.kind === 'field') return [scope];
  const matched = scope.kind === 'bill' ? areas.value : areas.value.filter((area) => area.code === scope.areaCode);
  if (!matched.length) return [scope];
  return matched.flatMap((area) => {
    const rows = scope.kind === 'area' && scope.rowIndexes ? scope.rowIndexes
      : Array.from({ length: Math.max(1, area.rows.length) }, (_, index) => index);
    return area.fields.flatMap((field) => rows.map((rowIndex): InspectionSelection => ({ kind: 'field', areaCode: area.code, fieldCode: field.code, rowIndex })));
  });
}
function toggle(area: Area, fields: Field[]) {
  if (props.disabled) return;
  const targets = fields.flatMap((field) => rowsFor(area).map((rowIndex): InspectionSelection => ({ kind: 'field', areaCode: area.code, fieldCode: field.code, rowIndex })));
  if (fullySelected(area, fields)) {
    const keys = new Set(targets.map(scopeIdentity));
    // 从整单或整区域中取消字段时展开范围，避免父级范围继续把该字段带入请求。
    emit('change', uniqueScopes(props.scopes.flatMap(expandScope).filter((scope) => !keys.has(scopeIdentity(scope)))));
  } else emit('change', uniqueScopes([...props.scopes, ...targets.filter((target) => target.kind === 'field' && !covered(target.areaCode, target.fieldCode, target.rowIndex))]));
}
function valueText(value: unknown) {
  if (value === undefined) return '未采集';
  if (value === null) return 'null';
  if (value === '') return '空字符串';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}
function fieldValue(area: Area, field: Field) {
  const row = area.rows[rowsFor(area)[0]!];
  const raw = row?.[field.code];
  const label = field.labelCode ? row?.[field.labelCode] : undefined;
  return `${rowChoices.value[area.code] === 'all' ? '首行：' : ''}${valueText(raw)}${label === undefined || label === raw ? '' : ` · ${valueText(label)}`}`;
}
function rowLabel(area: Area, index: number) {
  const summary = area.fields.slice(0, 2).map((field) => `${field.label}：${valueText(area.rows[index]?.[field.code])}`).join(' · ');
  return `第 ${index + 1} 行 · ${summary}`;
}
</script>

<template>
  <div class="ai-scope-selector">
    <label class="ai-scope-search">搜索区域或字段<input v-model="search" type="search" placeholder="输入名称或编码，可跨区域搜索"></label>
    <p class="muted">
      先选行，再勾选字段；切换行不会清除已选内容。取消勾选可移除对应行的字段。
    </p>
    <p v-if="!visibleAreas.length" class="muted">
      没有匹配的字段。
    </p>
    <section v-for="area in visibleAreas" :key="area.code" class="ai-scope-area">
      <div class="ai-scope-area-header">
        <label><input type="checkbox" :disabled="disabled" :checked="fullySelected(area, area.fields)" :indeterminate="partiallySelected(area, area.fields)" @change="toggle(area, area.fields)"> {{ area.label }} <small>{{ area.code }}</small></label>
        <select v-model="rowChoices[area.code]" :disabled="disabled" :aria-label="`${area.label} 本次勾选的行`">
          <option v-if="!area.rows.length" value="0">
            无数据行 · 仅分析配置
          </option>
          <option v-for="(_row, index) in area.rows" :key="index" :value="String(index)">
            {{ rowLabel(area, index) }}
          </option>
          <option v-if="area.rows.length" value="all">
            全部 {{ area.rows.length }} 行
          </option>
        </select>
      </div>
      <p class="muted">
        {{ search.trim() ? '勾选区域标题仅选择当前搜索结果' : '勾选区域标题可全选下方字段' }} · {{ area.fields.length }} 个字段
      </p>
      <div class="ai-scope-fields">
        <label v-for="field in area.fields" :key="field.code" class="ai-scope-field">
          <input type="checkbox" :disabled="disabled" :checked="fullySelected(area, [field])" :indeterminate="partiallySelected(area, [field])" @change="toggle(area, [field])">
          <span><strong>{{ field.label }}</strong><small>{{ field.code }}</small><span class="ai-scope-value">{{ fieldValue(area, field) }}</span></span>
        </label>
      </div>
    </section>
  </div>
</template>
