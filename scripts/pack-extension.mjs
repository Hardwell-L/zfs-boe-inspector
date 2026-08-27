import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = path.join(rootDir, 'apps', 'extension');
const distDir = path.join(extensionDir, 'dist');
const outputDir = path.join(rootDir, 'release');
const packageJson = JSON.parse(
  await readFile(path.join(extensionDir, 'package.json'), 'utf8'),
);
const zipName = `zfs-boe-inspector-extension-v${packageJson.version}.zip`;
const zipPath = path.join(outputDir, zipName);

await readFile(path.join(distDir, 'manifest.json'));
await mkdir(outputDir, { recursive: true });
await rm(zipPath, { force: true });
await rm(`${zipPath}.sha256`, { force: true });

const result = spawnSync('zip', ['-q', '-r', zipPath, '.'], {
  cwd: distDir,
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

const digest = createHash('sha256').update(await readFile(zipPath)).digest('hex');
await writeFile(`${zipPath}.sha256`, `${digest}  ${zipName}\n`, 'utf8');

console.log(`Extension ZIP 已生成：${path.relative(rootDir, zipPath)}`);
console.log(`SHA-256：${digest}`);
