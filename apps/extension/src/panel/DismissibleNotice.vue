<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
const props = withDefaults(defineProps<{ noticeKey?: string | number; autoCloseMs?: number; active?: boolean }>(), {
  noticeKey: '', autoCloseMs: 0, active: true,
});
const emit = defineEmits<{ close: [] }>();
const dismissed = ref(false);
let timer: number | undefined;
function close() {
  window.clearTimeout(timer);
  dismissed.value = true;
  emit('close');
}
function scheduleClose() {
  window.clearTimeout(timer);
  if (!dismissed.value && props.active && props.autoCloseMs > 0) timer = window.setTimeout(close, props.autoCloseMs);
}
watch(() => props.noticeKey, () => { dismissed.value = false; scheduleClose(); });
watch(() => [props.autoCloseMs, props.active], scheduleClose, { immediate: true });
onBeforeUnmount(() => window.clearTimeout(timer));
</script>

<template>
  <div v-if="!dismissed" class="dismissible-notice" role="status">
    <div class="notice-content">
      <slot />
    </div>
    <button class="notice-close" type="button" aria-label="关闭提示" title="关闭提示" @click="close">
      ×
    </button>
  </div>
</template>
