import type { AiEvidence } from './aiContext';
import type { ChatMessage } from './aiClient';

export function bytes(value: unknown): number {
  return new window.TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).length;
}

export function recentHistory(turns: Array<{ question: string; answer: string }>) {
  const retained = turns.slice(-2);
  const messages = () => retained.flatMap((turn): ChatMessage[] => [
    { role: 'user', content: turn.question }, { role: 'assistant', content: turn.answer },
  ]);
  while (retained.length && bytes(messages()) > 16_000) retained.shift();
  return { messages: messages(), omitted: turns.length - retained.length };
}

export function sentEvidence(items: AiEvidence[], redact: (value: unknown, original?: boolean, key?: string, configuration?: boolean) => unknown) {
  const included = new Set(items.map(({ id }) => id));
  return items.map((item) => {
    const value = JSON.parse(JSON.stringify(redact(item.value, item.original, '', item.kind === 'config')));
    if (item.kind === 'diagnostic' && value && Array.isArray(value.dependencyRefs)) {
      for (const dependency of value.dependencyRefs) {
        dependency.unavailableEvidenceIds = dependency.evidenceIds.filter((id: string) => !included.has(id));
        dependency.evidenceIds = dependency.evidenceIds.filter((id: string) => included.has(id));
      }
    }
    return { id: item.id, title: String(redact(item.title, item.original)), path: item.path, value };
  });
}

// 网络增量先合并，避免每个 token 都触发 Markdown 全文解析与滚动布局。
export function createTextBatch(append: (text: string) => void) {
  let pending = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const text = pending; pending = '';
    if (text) append(text);
  };
  return {
    push(text: string) { pending += text; if (timer === undefined) timer = setTimeout(flush, 50); },
    flush,
  };
}
