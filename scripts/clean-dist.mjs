import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const packageDir = process.cwd();
const packageJson = JSON.parse(
  await readFile(path.join(packageDir, 'package.json'), 'utf8'),
);

if (!packageJson.name?.startsWith('@zfs-boe-inspector/')) {
  throw new Error('clean-dist 只能在 @zfs-boe-inspector package 目录执行');
}

await rm(path.join(packageDir, 'dist'), { recursive: true, force: true });
