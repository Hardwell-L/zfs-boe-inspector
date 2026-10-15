<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TravelStandardRow } from '@zfs-boe-inspector/core';
import TravelSeatStandard from './TravelSeatStandard.vue';
import { groupStandards } from './travelStandardGroups';

const props = defineProps<{
  rows: TravelStandardRow[];
  legacy: boolean;
  personKey: string;
  formatAmount: (amount?: number | string, currency?: string) => string;
}>();
const place = ref('');
const type = ref('');
const issuesOnly = ref(false);
const expandedKey = ref('');
function toggleDetail(key: string) { expandedKey.value = expandedKey.value === key ? '' : key; }
const places = computed(() => [...new Set(props.rows.map((row) => row.place))]);
const types = computed(() => [...new Set(props.rows.map((row) => row.standardName))]);
const groups = computed(() => groupStandards(props.rows));
const filtered = computed(() => groups.value.filter(({ row }) => (!place.value || row.place === place.value)
  && (!type.value || row.standardName === type.value) && (!issuesOnly.value || row.dataIssue)));
const visibleCount = computed(() => filtered.value.reduce((total, group) => total + group.rows.length, 0));
const issueCount = computed(() => props.rows.filter((row) => row.dataIssue).length);
function reset() { place.value = ''; type.value = ''; issuesOnly.value = false; expandedKey.value = ''; }
watch(() => props.personKey, reset);
watch(places, (values) => { if (!values.includes(place.value)) place.value = ''; });
watch(types, (values) => { if (!values.includes(type.value)) type.value = ''; });
</script>

<template>
  <div v-if="rows.length">
    <div class="standard-filters">
      <label>地点 <select v-model="place"><option value="">全部地点</option><option v-for="value in places" :key="value" :value="value">{{ value }}</option></select></label>
      <label>标准类型 <select v-model="type"><option value="">全部类型</option><option v-for="value in types" :key="value" :value="value">{{ value }}</option></select></label>
      <label><input v-model="issuesOnly" type="checkbox"> 仅看数据异常（{{ issueCount }}）</label>
      <button type="button" @click="reset">
        重置筛选
      </button>
    </div>
    <p class="muted">
      共 {{ rows.length }} 条记录，合并为 {{ groups.length }} 组；当前显示 {{ filtered.length }} 组 / {{ visibleCount }} 条。仅合并同地点、完整规则一致的记录。
    </p>
    <div v-if="filtered.length" class="table-scroll standards-scroll">
      <table class="data-table standards-table" :class="{ legacy }">
        <colgroup>
          <col class="date-col"><col class="place-col"><col class="type-col"><col>
          <col v-if="legacy" class="condition-col"><col class="control-col"><col class="scheme-col"><col class="detail-col">
        </colgroup>
        <thead>
          <tr>
            <th>{{ legacy ? '缓存日期' : '适用日期' }}</th><th>地点</th><th>标准类型</th><th>金额 / 坐席标准</th><th v-if="legacy">
              适用条件
            </th><th>控制方式</th><th>方案</th><th>明细</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="group in filtered" :key="group.key">
            <tr :class="{ expanded: expandedKey === group.key }">
              <td class="standard-dates">
                <span v-for="range in group.dates.split('、')" :key="range" class="date-range">{{ range }}</span>
              </td><td>{{ group.row.place }}</td>
              <td :class="{ 'text-error': group.row.dataIssue }">
                {{ group.row.standardName }}
                <p v-if="group.row.dataIssue" class="standard-issue">
                  {{ group.row.dataIssue }}
                </p>
              </td>
              <td>
                <TravelSeatStandard v-if="group.row.isTransportation" :transportation="group.row.transportation" :transportation-name="group.row.transportationName" />
                <template v-else>
                  {{ group.row.amount !== undefined ? formatAmount(group.row.amount, group.row.currency) : group.row.standardDiscount ? `折扣：${group.row.standardDiscount}` : '—' }}
                </template>
              </td>
              <td v-if="legacy">
                {{ group.row.conditions || '—' }}
              </td>
              <td>{{ group.row.controlType }}</td><td>{{ group.row.schemeId || group.row.schemeCode }}</td>
              <td>
                <button class="detail-toggle" type="button" :aria-expanded="expandedKey === group.key" @click="toggleDetail(group.key)">
                  {{ expandedKey === group.key ? '收起明细' : '查看明细' }} <span class="record-count">{{ group.rows.length }}</span>
                </button>
              </td>
            </tr>
            <tr v-if="expandedKey === group.key" class="detail-row">
              <td :colspan="legacy ? 9 : 8">
                <section class="standard-detail" aria-label="差旅标准明细">
                  <div class="detail-heading">
                    <strong>{{ group.row.standardName }} · {{ group.row.place }}</strong><span class="muted">共 {{ group.rows.length }} 条适用记录</span>
                  </div>
                  <div class="date-records">
                    <span v-for="(row, index) in group.rows" :key="index" class="date-record">{{ row.date }}</span>
                  </div>
                  <details class="raw-rule">
                    <summary>查看原始规则与缓存来源</summary>
                    <div class="raw-columns">
                      <div><strong>原始规则</strong><pre>{{ JSON.stringify(group.row.raw, null, 2) }}</pre></div><div>
                        <strong>缓存来源</strong><ul>
                          <li v-for="(row, index) in group.rows" :key="index">
                            {{ row.key }}
                          </li>
                        </ul>
                      </div>
                    </div>
                  </details>
                </section>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p v-else class="tab-empty">
      没有符合筛选条件的标准。
    </p>
  </div>
  <p v-else class="tab-empty">
    当前人员尚未采集到差旅标准结果。
  </p>
</template>

<style scoped>
.standard-filters { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.standard-filters label { display: flex; align-items: center; gap: 6px; }
.standard-filters select { max-width: 240px; }
.standards-scroll { max-height: 560px; overflow: auto; }
.standards-scroll th { position: sticky; top: 0; z-index: 1; background: var(--panel-bg, #f5f6fa); }
.standards-table { table-layout: fixed; min-width: 1080px; }
.standards-table.legacy { min-width: 1220px; }
.date-col { width: 230px; }
.place-col { width: 80px; }
.type-col { width: 140px; }
.condition-col { width: 140px; }
.control-col { width: 110px; }
.scheme-col { width: 90px; }
.detail-col { width: 140px; }
.standards-table th { white-space: nowrap; }
.standards-table td { overflow-wrap: anywhere; }
.date-range { display: block; white-space: nowrap; font-size: 13px; }
.standard-issue { white-space: normal; }
.detail-toggle { display: inline-flex; align-items: center; gap: 6px; padding: 4px 0; border: 0; background: transparent; color: #315ac7; white-space: nowrap; }
.record-count { padding: 1px 6px; border-radius: 10px; background: #eaf0ff; font-size: 12px; }
.expanded > td { background: #f8faff; }
.detail-row > td { padding: 0 12px 12px; background: #f8faff; }
.standard-detail { padding: 16px; border: 1px solid #dfe6f3; border-radius: 8px; background: #fff; }
.detail-heading { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 12px; }
.date-records { display: flex; flex-wrap: wrap; gap: 8px; }
.date-record { padding: 5px 10px; border-radius: 6px; background: #f3f5f9; white-space: nowrap; font-variant-numeric: tabular-nums; }
.raw-rule { margin-top: 14px; padding-top: 12px; border-top: 1px solid #eceef3; }
.raw-rule summary { color: #667086; }
.raw-columns { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 20px; margin-top: 12px; }
.raw-columns li { overflow-wrap: anywhere; }

.standard-issue { font-size: 12px; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 300px; overflow: auto; }
summary { cursor: pointer; }
</style>
