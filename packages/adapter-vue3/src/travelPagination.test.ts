import { describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { useTablePage } from '../../../apps/extension/src/panel/useTablePage';

describe('差旅表格分页', () => {
  it('最多展示 50 项，换人重置，刷新后自动约束页码', () => {
    const scope = effectScope();
    scope.run(() => {
      const source = ref(Array.from({ length: 120 }, (_, index) => index));
      const person = ref('E1');
      const pagination = useTablePage(() => source.value, person);
      expect(pagination.rows.value).toHaveLength(50);
      pagination.page.value = 3;
      expect(pagination.rows.value).toEqual(source.value.slice(100));
      source.value = source.value.slice(0, 60);
      expect(pagination.page.value).toBe(2);
      person.value = 'E2';
      expect(pagination.page.value).toBe(1);
      expect(pagination.rows.value).toEqual(source.value.slice(0, 50));
    });
    scope.stop();
  });
});
