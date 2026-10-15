<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ modelValue: number; total: number }>();
const emit = defineEmits<{ 'update:modelValue': [value: number] }>();
const pages = computed(() => Math.max(1, Math.ceil(props.total / 50)));
</script>

<template>
  <nav v-if="total > 50" class="table-pager" aria-label="表格分页">
    <button type="button" :disabled="modelValue <= 1" @click="emit('update:modelValue', modelValue - 1)">
      上一页
    </button>
    <span>{{ modelValue }} / {{ pages }} 页，共 {{ total }} 条，每页 50 条</span>
    <button type="button" :disabled="modelValue >= pages" @click="emit('update:modelValue', modelValue + 1)">
      下一页
    </button>
  </nav>
</template>

<style scoped>
.table-pager { display: flex; align-items: center; gap: 12px; margin: 12px 0; }
</style>
