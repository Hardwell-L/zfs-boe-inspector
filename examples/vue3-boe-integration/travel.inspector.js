import { attachTravelInspector } from '@zfs-boe-inspector/adapter-vue3';

export const travelInspectorLifecycle = {
  mounted() {
    this.disposeTravelInspector = attachTravelInspector(this);
  },
  beforeUnmount() {
    this.disposeTravelInspector?.();
  },
};
