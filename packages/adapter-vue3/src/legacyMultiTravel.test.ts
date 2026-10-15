import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachBillTemplateInspector, attachTravelInspector } from './index';
import { createBillTemplateInspectorMixin } from './legacyZfsBoe';
import type { BillTemplateComponentLike } from './collector';

vi.mock('./index', () => ({
  installBoeInspector: vi.fn(),
  attachBillTemplateInspector: vi.fn(() => vi.fn()),
  attachTravelInspector: vi.fn(() => vi.fn()),
}));
// 版本准入由 boeVersion.test.ts 独立验证；此处只检查 Vue2 生命周期和注册边界。
vi.mock('./boeVersion', () => ({ isSupportedBoeVersion: () => true }));

afterEach(() => { vi.clearAllMocks(); });

describe('legacy 多人差旅注册', () => {
  it.each(['2.6.14', '2.7.16'])('Vue %s 外层没有标准数据时仍注册，KeepAlive 不重复注册且可重新进入', (version) => {
    const component: BillTemplateComponentLike = {
      $options: { _base: { version } },
      $parent: { $options: { name: 'MULTITRAVELBOE' } }, data: {},
    };
    const mixin = createBillTemplateInspectorMixin();
    mixin.mounted.call(component);
    mixin.activated.call(component);
    expect(attachTravelInspector).toHaveBeenCalledTimes(1);
    expect(attachTravelInspector).toHaveBeenCalledWith(component.$parent, expect.objectContaining({ legacyMode: true }));
    const dispose = vi.mocked(attachTravelInspector).mock.results[0]!.value;
    mixin.deactivated.call(component);
    mixin.beforeDestroy.call(component);
    expect(dispose).toHaveBeenCalledTimes(1);
    mixin.activated.call(component);
    expect(attachTravelInspector).toHaveBeenCalledTimes(2);
    expect(attachBillTemplateInspector).toHaveBeenCalledTimes(2);
    mixin.beforeDestroy.call(component);
  });
});
