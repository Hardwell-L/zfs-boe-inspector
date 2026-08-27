import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(rootDir, relativePath), 'utf8'));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const manifests = await Promise.all([
  readJson('package.json'),
  readJson('packages/shared-types/package.json'),
  readJson('packages/adapter-vue3/package.json'),
  readJson('packages/core/package.json'),
  readJson('packages/rule-base/package.json'),
  readJson('apps/extension/package.json'),
  readJson('apps/extension/public/manifest.json'),
]);

const [
  rootPackage,
  sharedTypesPackage,
  adapterPackage,
  corePackage,
  ruleBasePackage,
  extensionPackage,
] = manifests;
const version = rootPackage.version;

for (const manifest of manifests) {
  assert(
    manifest.version === version,
    `${manifest.name ?? 'Chrome Extension'} 版本 ${manifest.version} 与根版本 ${version} 不一致`,
  );
}

assert(rootPackage.private === true, '根 workspace 必须保持 private');
assert(corePackage.private === true, '@zfs-boe-inspector/core 必须保持 private');
assert(ruleBasePackage.private === true, '@zfs-boe-inspector/rule-base 必须保持 private');
assert(extensionPackage.private === true, '@zfs-boe-inspector/extension 必须保持 private');
assert(sharedTypesPackage.private !== true, 'shared-types 必须允许发布');
assert(adapterPackage.private !== true, 'adapter-vue3 必须允许发布');

const expectedTag = `v${version}`;
const currentTag = process.env.GITHUB_REF_TYPE === 'tag'
  ? process.env.GITHUB_REF_NAME
  : process.argv[2];
if (currentTag) {
  assert(currentTag === expectedTag, `Tag ${currentTag} 与版本 ${expectedTag} 不一致`);
}

console.log(`发布配置校验通过：${expectedTag}`);
console.log('npm 包：@zfs-boe-inspector/shared-types、@zfs-boe-inspector/adapter-vue3');
console.log('Extension：GitHub Release ZIP');
