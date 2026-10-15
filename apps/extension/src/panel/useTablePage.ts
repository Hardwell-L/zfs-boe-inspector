import { computed, ref, watch, type Ref } from 'vue';

export function useTablePage<T>(source: () => T[], key: Ref<string>) {
  const page = ref(1);
  const rows = computed(() => source().slice((page.value - 1) * 50, page.value * 50));
  watch(key, () => { page.value = 1; }, { flush: 'sync' });
  watch(() => source().length, (length) => { page.value = Math.min(page.value, Math.max(1, Math.ceil(length / 50))); }, { flush: 'sync' });
  return { page, rows };
}
