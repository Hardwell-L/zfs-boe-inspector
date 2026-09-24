// webpack 4 does not consistently resolve package exports for subpaths.
// Keep a physical entry while the declaration continues to come from dist.
export * from './dist/legacy/legacyZfsBoe.js';
