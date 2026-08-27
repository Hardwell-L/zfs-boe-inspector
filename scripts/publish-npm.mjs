import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const registry = 'https://registry.npmjs.org/';
const packages = [
  '@zfs-boe-inspector/shared-types',
  '@zfs-boe-inspector/adapter-vue3',
];

function packageVersion(packageName) {
  const result = spawnSync(
    'pnpm',
    ['--filter', packageName, 'exec', 'node', '-p', 'require("./package.json").version'],
    { cwd: rootDir, encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  return result.stdout.trim();
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

for (const packageName of packages) {
  const version = packageVersion(packageName);
  if (isPublished(packageName, version)) {
    console.log(`跳过已发布版本：${packageName}@${version}`);
    continue;
  }

  console.log(`发布 ${packageName}@${version}`);
  const result = spawnSync(
    'pnpm',
    [
      '--filter',
      packageName,
      'publish',
      '--access',
      'public',
      '--no-git-checks',
      '--registry',
      registry,
    ],
    { cwd: rootDir, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
