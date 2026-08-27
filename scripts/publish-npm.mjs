import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'https://registry.npmjs.org/';
const packages = [
  {
    name: '@zfs-boe-inspector/shared-types',
    manifest: 'packages/shared-types/package.json',
  },
  {
    name: '@zfs-boe-inspector/adapter-vue3',
    manifest: 'packages/adapter-vue3/package.json',
  },
];

function packageVersion(manifestPath) {
  return JSON.parse(readFileSync(path.join(rootDir, manifestPath), 'utf8')).version;
}

function tarballPath(packageName, version) {
  const filename = `${packageName.replace(/^@/, '').replace('/', '-')}-${version}.tgz`;
  return path.join(rootDir, 'release', 'npm', filename);
}

function isPublished(packageName, version) {
  const result = spawnSync(
    'npm',
    ['view', `${packageName}@${version}`, 'version', '--registry', registry],
    { cwd: rootDir, encoding: 'utf8' },
  );
  if (result.status === 0) return true;
  const output = `${result.stdout}\n${result.stderr}`;
  if (/E404|404 Not Found|is not in this registry/i.test(output)) return false;
  process.stderr.write(output);
  process.exit(result.status ?? 1);
}

for (const packageInfo of packages) {
  const version = packageVersion(packageInfo.manifest);
  if (isPublished(packageInfo.name, version)) {
    console.log(`跳过已发布版本：${packageInfo.name}@${version}`);
    continue;
  }

  const packageTarball = tarballPath(packageInfo.name, version);
  if (!existsSync(packageTarball)) {
    throw new Error(`缺少发布包：${path.relative(rootDir, packageTarball)}；请先运行 pnpm pack:npm`);
  }

  console.log(`发布 ${packageInfo.name}@${version}（Trusted Publishing OIDC）`);
  const result = spawnSync(
    'npm',
    [
      'publish',
      packageTarball,
      '--access',
      'public',
      '--registry',
      registry,
    ],
    { cwd: rootDir, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
