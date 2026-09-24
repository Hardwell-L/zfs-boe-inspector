let warned = false;

export function isSupportedBoeVersion(version: unknown): boolean {
  // 项目后缀不参与兼容范围判断，避免 SemVer 预发布匹配排除受支持的宿主。
  if (typeof version === 'string' && /^[34]\.\d+\.\d+(?:[-+].+)?$/.test(version)) return true;
  if (!warned) {
    warned = true;
    console.warn(`[ZFS BOE Inspector] 仅支持 @zfs/boe 3.x、4.x，当前版本：${String(version ?? 'unknown')}；已跳过采集。`);
  }
  return false;
}
