<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TravelViewModel } from '@zfs-boe-inspector/core';
import TablePager from './TablePager.vue';
import { useTablePage } from './useTablePage';
import TravelSeatStandard from './TravelSeatStandard.vue';
const props = defineProps<{ rows: TravelViewModel['transportInvoices']; personKey: string }>();
const pagination = useTablePage(() => props.rows, computed(() => props.personKey));
const expandedKeys = ref(new Set<string>());
function toggle(key: string) {
  if (expandedKeys.value.has(key)) expandedKeys.value.delete(key);
  else expandedKeys.value.add(key);
}
watch(() => props.personKey, () => { expandedKeys.value.clear(); });
function controlName(value: string): string {
  return ({ ALLOW: '允许', WARNING: '警告', FORBID: '禁止' } as Record<string, string>)[value] || value;
}
function submitValidation(row: TravelViewModel['transportInvoices'][number]): string {
  if (row.status === 'unmatched') return '提交不校验（未命中规则）';
  if (row.status !== 'matched') return '提交校验待确认';
  if (row.controlType === 'WARNING') return '提交校验（警告）';
  if (row.controlType === 'FORBID') return '提交校验（禁止）';
  if (row.controlType === 'ALLOW') return '提交不校验（允许）';
  return '提交校验待确认';
}
</script>

<template>
  <div class="table-scroll">
    <table class="data-table invoice-seat-table">
      <colgroup><col class="source-col"><col class="person-col"><col class="date-col"><col class="city-col"><col><col class="result-col"><col class="control-col"></colgroup>
      <thead><tr><th>发票行 / 航段</th><th>人员</th><th>出行日期</th><th>到达城市</th><th>发票坐席</th><th>核对结果</th><th>控制方式</th></tr></thead>
      <tbody>
        <template v-for="row in pagination.rows.value" :key="row.key">
          <tr :class="{ expanded: expandedKeys.has(row.key) }">
            <td>{{ row.source }}</td><td>{{ row.employeeName }}</td><td class="trip-date">
              {{ row.date }}
            </td><td>{{ row.city }}</td><td>{{ row.seat }}</td>
            <td>
              <span class="result-label" :class="{ 'result-error': row.status === 'missing' || row.status === 'unmatched', 'result-neutral': row.status !== 'missing' && row.status !== 'unmatched' }">{{ row.result }}</span>
              <button class="detail-toggle" type="button" :aria-expanded="expandedKeys.has(row.key)" @click="toggle(row.key)">
                {{ expandedKeys.has(row.key) ? '收起核对详情' : '查看核对详情' }}
              </button>
            </td>
            <td>
              <span :class="{ 'text-error': row.controlType === 'FORBID' }">{{ submitValidation(row) }}</span>
              <div v-if="row.candidateControlTypes?.length" class="candidate-control">
                候选标准：{{ row.candidateControlTypes.map(controlName).join(' / ') }}（未命中）
              </div>
            </td>
          </tr>
          <tr v-if="expandedKeys.has(row.key)" class="detail-row">
            <td colspan="7">
              <section class="seat-comparison" aria-label="交通坐席核对详情">
                <div class="comparison-heading">
                  <strong>{{ row.employeeName }}</strong><span>{{ row.date }} · {{ row.city }}</span>
                </div>
                <p v-if="row.status === 'unmatched'" class="result-description">
                  该发票坐席不在此人员对应日期、地点及业务小类的坐席标准中。
                </p>
                <p v-else-if="row.status === 'missing'" class="result-description">
                  发票未提供坐席编码，需补全坐席信息后核对。
                </p>
                <div class="comparison-grid">
                  <div class="actual-seat">
                    <div class="comparison-label">
                      发票坐席
                    </div><strong>{{ row.seat }}</strong>
                  </div>
                  <div>
                    <div class="comparison-label">
                      对应坐席标准
                    </div>
                    <div v-if="row.standardCandidates?.length" class="standard-options">
                      <div v-for="(standard, index) in row.standardCandidates" :key="index" class="standard-option">
                        <div class="candidate-heading">
                          规则 {{ index + 1 }} · {{ controlName(standard.controlType) }}
                        </div>
                        <TravelSeatStandard :transportation="standard.transportation" :transportation-name="standard.transportationName" />
                      </div>
                    </div>
                    <p v-else class="muted">
                      尚无可确认适用的标准，请查看核对依据。
                    </p>
                  </div>
                </div>
                <details class="evidence">
                  <summary>查看核对依据</summary><p>{{ row.evidence }}</p>
                </details>
              </section>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
  </div>
  <TablePager v-model="pagination.page.value" :total="rows.length" />
</template>

<style scoped>
.invoice-seat-table { table-layout: fixed; min-width: 1140px; }
.source-col { width: 125px; }
.person-col { width: 170px; }
.date-col { width: 125px; }
.city-col { width: 90px; }
.result-col { width: 230px; }
.control-col { width: 190px; }
.invoice-seat-table th, .trip-date { white-space: nowrap; }
.invoice-seat-table td { overflow-wrap: anywhere; }
.result-label { display: inline; font: inherit; }
.result-error { color: #b63232; }
.result-neutral { color: inherit; }
.detail-toggle { display: block; padding: 5px 0 0; border: 0; background: transparent; color: #315ac7; font: inherit; }
.candidate-control { color: #667086; margin-top: 6px; font: inherit; }
.expanded > td, .detail-row > td { background: #f8faff; }
.detail-row > td { padding: 0 12px 12px; }
.seat-comparison { padding: 16px; background: #fff; border: 1px solid #dfe6f3; border-radius: 8px; }
.comparison-heading { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
.comparison-heading span, .comparison-label { color: #667086; font-size: 12px; }
.result-description { color: #b63232; margin: 10px 0 14px; }
.comparison-grid { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(0, 3fr); gap: 24px; margin-top: 14px; }
.comparison-label { margin-bottom: 8px; }
.actual-seat { padding-right: 20px; border-right: 1px solid #eceef3; }
.standard-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
.standard-option { padding: 12px; background: #f7f8fb; border-radius: 6px; }
.candidate-heading { font-size: 12px; color: #667086; margin-bottom: 8px; }
.evidence { margin-top: 14px; border-top: 1px solid #eceef3; padding-top: 12px; color: #667086; font-size: 12px; }
.evidence summary { cursor: pointer; }
.evidence p { white-space: normal; overflow-wrap: anywhere; line-height: 1.7; }
</style>
