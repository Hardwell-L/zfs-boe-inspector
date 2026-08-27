import { mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(rootDir, 'release', 'npm');
const packages = [
  '@zfs-boe-inspector/shared-types',
  '@zfs-boe-inspector/adapter-vue3',
];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

for (const packageName of packages) {
  const result = spawnSync(
    'pnpm',
    ['--filter', packageName, 'pack', '--pack-destination', outputDir],
    { cwd: rootDir, stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`npm tarball 已生成：${path.relative(rootDir, outputDir)}`);
