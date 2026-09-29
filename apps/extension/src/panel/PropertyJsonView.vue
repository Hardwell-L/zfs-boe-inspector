<script setup lang="ts">
import { computed } from 'vue';
import { record } from './inspectionView';
import { propertyJson, fieldCaption, hasPropertyJson, popupSettingRows, assignmentRows } from './propertyJsonView';
import ConfigValueTree from './ConfigValueTree.vue';
import DynamicConditionTree from './DynamicConditionTree.vue';
import FormControlRules from './FormControlRules.vue';
import DataSourceRange from './DataSourceRange.vue';

const props = withDefaults(defineProps<{ code: string; value: unknown; areaCode: string; names: Map<string, string>; showRaw?: boolean }>(), { showRaw: true });
const parsed = computed(() => propertyJson(props.value));
const raw = computed(() => JSON.stringify(parsed.value, null, 2));
const isCondition = computed(() => ['edit', 'show', 'requireSet'].includes(props.code));
const mappings = computed(() => {
  if (props.code === 'popSetting') return popupSettingRows(parsed.value);
  if (props.code === 'relateAssignment') return assignmentRows(parsed.value, props.areaCode, props.names);
  if (props.code === 'prev' && parsed.value && !Array.isArray(parsed.value)) {
    return Object.entries(parsed.value).map(([key, value]) => ({ '查询参数': key,
      '来源单据字段': typeof value === 'string' ? fieldCaption(value, props.areaCode, props.names) : value }));
  }
  if (props.code === 'trans' && Array.isArray(parsed.value)
    && parsed.value.every((item) => typeof record(item).from === 'string' && typeof record(item).to === 'string')) {
    return parsed.value.map((item) => {
      const { from, to, ...extra } = record(item);
      const targetArea = typeof extra.leftAreaCode === 'string' ? extra.leftAreaCode : props.areaCode;
      return { '返回字段（from）': from, '回填字段（to）': fieldCaption(String(to), targetArea, props.names), ...extra };
    });
  }
  return undefined;
});
const lovLabels = { singleGrid: '单选（Y 为单选，N 为多选）', autoQuery: '打开时自动查询', isShowFavorites: '显示收藏', field: '展示列', fields: '展示列', query: '查询条件', favoriteKey: '收藏主键', favoriteLabel: '收藏展示字段' };
const sourceLabels: Record<string, string> = {
  labelCode: '展示字段', fieldSet: '字段角色', trans: '字段转换', prev: '前置查询参数', nextField: '后置字段',
  config: 'LOV 配置', lovKey: 'LOV 标识', requestUrl: '接口地址', service: '微服务名', rowKey: '行主键',
  datasourceCode: '数据源编码', datasourceTypeDetail: '数据源类型编码', prevCondition: '前置条件',
  staticCondition: '静态条件', selectField: '查询返回字段',
};
const sourceSections = computed(() => ['dataSource', 'mainDataConfig'].includes(props.code) && parsed.value && !Array.isArray(parsed.value)
  ? Object.entries(parsed.value).map(([key, value]) => ({ key, value,
    label: Object.hasOwn(sourceLabels, key) ? `${sourceLabels[key]} (${key})` : key,
    nested: ['trans', 'prev', 'nextField', 'config'].includes(key) && hasPropertyJson(key, value),
  })) : undefined);
</script>

<template>
  <div class="property-json-view">
    <DynamicConditionTree v-if="isCondition" :value="parsed" :area-code="areaCode" :names="names" />
    <FormControlRules v-else-if="['formShow', 'formEdit', 'formRequire'].includes(code)" :code="code" :value="parsed" :area-code="areaCode" :names="names" />
    <DataSourceRange v-else-if="code === 'dataSourceRange' && !Array.isArray(parsed)" :value="parsed" :area-code="areaCode" :names="names" />
    <template v-else-if="sourceSections">
      <section v-for="section in sourceSections" :key="section.key" class="source-section">
        <h4>{{ section.label }}</h4>
        <PropertyJsonView v-if="section.nested" :code="section.key" :value="section.value" :area-code="areaCode" :names="names" :show-raw="false" />
        <ConfigValueTree v-else :value="section.key === 'labelCode' && typeof section.value === 'string' ? fieldCaption(section.value, areaCode, names) : section.value" :labels="section.key === 'fieldSet' ? { id: '主键字段', code: '编码字段', name: '名称字段' } : undefined" />
      </section>
    </template>
    <ConfigValueTree v-else :value="mappings ?? parsed" :labels="code === 'config' ? lovLabels : undefined" />
    <details v-if="showRaw">
      <summary>原始 JSON</summary>
      <pre>{{ raw }}</pre>
    </details>
  </div>
</template>

<style scoped>
.property-json-view { min-width: 0; }
details { margin-top: 12px; }
summary { color: #667086; cursor: pointer; }
.source-section + .source-section { margin-top: 14px; padding-top: 12px; border-top: 1px solid #e7e8ee; }
.source-section h4 { margin: 0 0 8px; color: #667086; font-size: 12px; font-weight: 500; }
</style>
