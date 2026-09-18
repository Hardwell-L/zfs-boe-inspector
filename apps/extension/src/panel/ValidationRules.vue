<script setup lang="ts">
import { computed, ref } from 'vue';
import { displayValue, validationRows } from './inspectionView';

const props = defineProps<{ value: unknown }>();
const keyword = ref('');
const node = ref('');
const state = ref('');
const model = computed(() => validationRows(props.value));
const states = computed(() => [...new Set(model.value.rows.map((row) => row.state))]);
const rows = computed(() => model.value.rows.filter((row) => (!node.value || row.nodeCodes.includes(node.value))
  && (!state.value || row.state === state.value)
  && `${row.rule.priority ?? ''} ${row.check} ${row.trigger} ${row.remind} ${row.control}`.toLowerCase().includes(keyword.value.trim().toLowerCase())));
</script>

<template>
  <div class="validation-rules-view">
    <div class="tool-actions">
      <input v-model="keyword" placeholder="搜索校验内容、条件或提示语" aria-label="搜索校验规则">
      <select v-model="node" aria-label="控制节点">
        <option value="">
          全部节点
        </option>
        <option value="01">
          提交
        </option><option value="02">
          同意
        </option><option value="03">
          驳回
        </option>
      </select>
      <select v-model="state" aria-label="规则状态">
        <option value="">
          全部状态
        </option>
        <option v-for="item in states" :key="item" :value="item">
          {{ item }}
        </option>
      </select>
      <span class="muted">{{ rows.length }} / {{ model.rows.length }} 条</span>
    </div>
    <p v-if="model.error" role="alert" class="error-banner">
      {{ model.error }}
    </p>
    <div v-else-if="rows.length" class="table-scroll">
      <table class="data-table validation-table">
        <thead><tr><th>优先级</th><th>校验内容</th><th>控制方式</th><th>控制节点</th><th>提示语</th><th>状态</th></tr></thead>
        <tbody>
          <template v-for="row in rows" :key="row.index">
            <tr>
              <td>{{ row.rule.priority ?? '—' }}</td>
              <td><span class="rule-text-preview" :title="row.check">{{ row.error || row.check }}</span></td>
              <td>{{ row.control }}</td><td>{{ row.nodes }}</td>
              <td><span class="rule-text-preview" :title="row.remind">{{ row.remind }}</span></td><td>{{ row.state }}</td>
            </tr>
            <tr>
              <td colspan="6" class="validation-detail-cell">
                <details :id="`validation-rule-${row.index}`">
                  <summary>第 {{ row.index + 1 }} 条规则详情</summary>
                  <p v-if="row.parseErrors.length || row.error" class="error-banner">
                    {{ row.error || `${row.parseErrors.join('、')} 不是有效 JSON` }}
                  </p>
                  <dl class="readable-values">
                    <dt>触发条件</dt><dd>{{ row.trigger }}</dd>
                    <dt>校验内容</dt><dd>{{ row.check }}</dd>
                    <dt>提示语</dt><dd>{{ row.remind }}</dd>
                  </dl>
                  <details><summary>原始规则配置</summary><pre>{{ JSON.stringify(row.raw, null, 2) }}</pre></details>
                </details>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>
    <p v-else class="muted">
      {{ model.rows.length ? '当前筛选条件下没有规则。' : '未配置单据校验规则。' }}
    </p>
    <details v-if="model.error">
      <summary>原始校验规则</summary><pre>{{ displayValue(value) }}</pre>
    </details>
  </div>
</template>
