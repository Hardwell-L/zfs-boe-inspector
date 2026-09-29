<script setup lang="ts">
import { computed } from 'vue';
import { displayValue } from './inspectionView';

const props = withDefaults(defineProps<{ value: unknown; labels?: Record<string, string> | undefined; depth?: number }>(), { depth: 0, labels: () => ({}) });
const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const entries = computed(() => isObject(props.value) ? Object.entries(props.value) : []);
const rows = computed(() => Array.isArray(props.value) ? props.value.slice(0, 100) : []);
const columns = computed(() => rows.value.length && rows.value.every(isObject)
  ? [...new Set(rows.value.flatMap((row) => Object.keys(row)))].slice(0, 20) : []);
const label = (key: string) => props.labels?.[key] ? `${props.labels[key]} (${key})` : key;
</script>

<template>
  <div class="config-value-tree">
    <details v-if="depth >= 6 && value && typeof value === 'object'">
      <summary>展开深层配置</summary><pre>{{ JSON.stringify(value, null, 2) }}</pre>
    </details>
    <template v-else-if="Array.isArray(value)">
      <span v-if="!value.length" class="muted">空数组（0 项）</span>
      <div v-else-if="columns.length" class="config-table-scroll">
        <table>
          <thead>
            <tr>
              <th v-for="column in columns" :key="column">
                {{ label(column) }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, index) in rows" :key="index">
              <td v-for="column in columns" :key="column">
                <ConfigValueTree :value="(row as Record<string, unknown>)[column]" :depth="depth + 1" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ol v-else>
        <li v-for="(row, index) in rows" :key="index">
          <ConfigValueTree :value="row" :depth="depth + 1" />
        </li>
      </ol>
      <p v-if="value.length > 100 || (columns.length === 20 && rows.some(row => isObject(row) && Object.keys(row).some(key => !columns.includes(key)) ))" class="muted">
        展示最多 100 项、20 列；完整内容请查看原始配置。
      </p>
    </template>
    <template v-else-if="isObject(value)">
      <span v-if="!entries.length" class="muted">空对象（0 项）</span>
      <div v-for="[key, entry] in entries" :key="key" class="config-entry">
        <div class="config-key">
          {{ label(key) }}
        </div>
        <ConfigValueTree :value="entry" :depth="depth + 1" :labels="['field', 'fields', 'query'].includes(key) ? { code: '编码', label: '名称' } : undefined" />
      </div>
    </template>
    <span v-else class="config-scalar">{{ displayValue(value) }}</span>
  </div>
</template>

<style scoped>
.config-value-tree { min-width: 0; overflow-wrap: anywhere; }
.config-entry + .config-entry { margin-top: 10px; }
.config-key { color: #667086; margin-bottom: 5px; }
.config-scalar { white-space: pre-wrap; }
.config-table-scroll { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; font-size: 12px; }
th, td { text-align: left; vertical-align: top; padding: 7px 9px; border: 1px solid #e7e8ee; }
th { background: #f5f6f9; color: #667086; font-weight: 500; }
ol { margin: 0; padding-left: 22px; }
li + li { margin-top: 6px; }
</style>
