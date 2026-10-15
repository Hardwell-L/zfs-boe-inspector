<script setup lang="ts">
import { computed, ref, watch } from 'vue';
const props = defineProps<{ transportation?: string | undefined; transportationName?: string | undefined }>();
const expanded = ref(false);
const codes = computed(() => (props.transportation || '').split('^').map((item) => item.trim()).filter(Boolean));
watch(() => [props.transportation, props.transportationName], () => { expanded.value = false; });
</script>

<template>
  <div class="seat-standard">
    <div class="seat-name" :class="{ collapsed: !expanded }">
      {{ transportationName || codes.join('、') || '未提供坐席标准' }}
    </div>
    <button v-if="transportationName || codes.length" type="button" :aria-expanded="expanded" @click="expanded = !expanded">
      {{ expanded ? '收起坐席详情' : `查看坐席详情（${codes.length} 项编码）` }}
    </button>
    <div v-if="expanded" class="seat-tags">
      <span v-for="(code, index) in codes" :key="index" class="seat-tag">{{ code }}</span>
      <span v-if="!codes.length" class="muted">未提供坐席编码</span>
    </div>
  </div>
</template>

<style scoped>
.seat-standard { min-width: 180px; max-width: 360px; white-space: normal; }
.seat-name { margin-bottom: 6px; overflow-wrap: anywhere; }
.collapsed { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.seat-tags { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px; }
.seat-tag { border: 1px solid currentColor; border-radius: 4px; padding: 2px 6px; overflow-wrap: anywhere; max-width: 100%; }
button { margin-top: 6px; }
</style>
