/** 仅格式化有明确时区的事件时间，业务日期由调用方原样展示。 */
export function formatLocalDateTime(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) return '—';
  const [year, month, day, hour, minute] = value.slice(0, 16).split(/[-T:]/i).map(Number);
  if (!year || !month || !day || month > 12 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || hour! > 23 || minute! > 59) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat(undefined, {
    calendar: 'gregory', numberingSystem: 'latn', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}
