<script setup lang="ts">
import { computed } from 'vue';
import { calculationRaw, calculationRows } from './calculationView';

const props = defineProps<{ value: unknown }>();
const model = computed(() => calculationRows(props.value));
const raw = computed(() => calculationRaw(props.value));
</script>

<template>
  <div class="calculation-rules-view">
    <p v-if="model.error" role="alert" class="error-banner">
      {{ model.error }}
    </p>
    <template v-else-if="model.rows.length">
      <p class="muted">
        共 {{ model.rows.length }} 条规则 · 字段名称悬停可查看编码
      </p>
      <article v-for="row in model.rows" :key="row.index" class="calculation-card">
        <h4>规则 {{ row.index + 1 }}</h4>
        <p v-if="row.error" class="error-banner">
          {{ row.error }}
        </p>
        <template v-else>
          <div class="calculation-label">
            触发条件
          </div>
          <div class="calculation-condition">
            {{ row.condition }}
          </div>
          <div class="calculation-label">
            计算公式
          </div>
          <div v-if="row.tokens.length" class="calculation-expression">
            <template v-for="(token, index) in row.tokens" :key="index">
              <span v-if="token.fieldCode" class="calculation-field" :title="token.fieldCode">{{ token.text }}</span><template v-else>
                {{ token.text }}
              </template>
            </template>
          </div>
          <p v-else class="muted">
            公式内容不可用，请展开原始配置查看。
          </p>
        </template>
      </article>
    </template>
    <p v-else class="muted">
      {{ model.message }}
    </p>
    <details v-if="value != null && value !== ''">
      <summary>原始计算公式配置</summary>
      <pre>{{ raw }}</pre>
    </details>
  </div>
</template>

<style scoped>
.calculation-rules-view { min-width: 0; }
.calculation-card { margin-bottom: 12px; padding: 12px; border: 1px solid #e1e3ea; border-radius: 8px; }
.calculation-card h4 { margin: 0 0 12px; }
.calculation-label { margin: 10px 0 6px; color: #667086; }
.calculation-condition, .calculation-expression { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.9; }
.calculation-expression { padding: 10px; border-radius: 6px; background: #f5f6f9; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.calculation-field { padding: 2px 4px; border-radius: 4px; background: #eceaff; color: #4c3edb; box-decoration-break: clone; }
summary { cursor: pointer; color: #667086; }
</style>
