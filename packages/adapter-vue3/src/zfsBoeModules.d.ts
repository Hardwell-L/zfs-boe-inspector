declare module '@zfs/boe/package.json' {
  const value: {
    version: string;
    dependencies?: Record<string, string>;
  };
  export default value;
}

declare module '@zfs/boe/zfs-boe-core/src/config/boeDesign' {
  export const areaConfig: Record<string, unknown[]>;
  export const fieldConfig: Record<string, unknown[]>;
}

declare module '@zfs/boe/zfs-boe-core/src/utils/fieldDynamicConfig' {
  const getDynamicConfig: (
    args: Record<string, unknown>,
  ) => boolean | Record<string, unknown> | void;
  export default getDynamicConfig;
}
