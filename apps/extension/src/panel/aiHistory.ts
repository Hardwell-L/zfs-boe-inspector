import { createRedactor } from './aiContext';
import type { AiSession } from './useAiWorkspace';

const PREFIX = 'aiHistory.v1.';
export interface AiHistory {
  version: 1; id: string; title: string; createdAt: string; updatedAt: string;
  messages: { id: number; question: { text: string; createdAt: string }; answer: { text: string; status: 'complete' | 'length' | 'stopped' | 'error' }; model: string }[];
}

// 持久化只投影问答白名单；禁止序列化会话对象、请求体或证据。
export function historyFromSession(session: AiSession, secrets: Iterable<string>): AiHistory {
  const redact = createRedactor();
  const keys = [...secrets].filter(Boolean).sort((a, b) => b.length - a.length);
  const text = (value: string) => String(redact(keys.reduce((result, key) => result.split(key).join('[凭据已移除]'), value), true));
  return {
    version: 1, id: session.historyId, title: text(session.title), createdAt: session.createdAt, updatedAt: new Date().toISOString(),
    messages: session.answers.map((item) => ({
      id: item.id, question: { text: text(item.question), createdAt: item.sentAt },
      answer: { text: text(item.answer), status: item.status === 'streaming' ? 'stopped' : item.status }, model: text(item.service.model),
    })),
  };
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function readHistory(value: unknown): AiHistory | undefined {
  const entry = record(value);
  if (entry.version !== 1 || typeof entry.id !== 'string' || !entry.id || typeof entry.title !== 'string'
    || typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string' || !Array.isArray(entry.messages)) return;
  const messages: AiHistory['messages'] = [];
  for (const raw of entry.messages) {
    const item = record(raw); const question = record(item.question); const answer = record(item.answer);
    if (typeof item.id !== 'number' || typeof item.model !== 'string' || typeof question.text !== 'string' || typeof question.createdAt !== 'string'
      || typeof answer.text !== 'string' || !['complete', 'length', 'stopped', 'error'].includes(String(answer.status))) return;
    messages.push({ id: item.id, model: item.model, question: { text: question.text, createdAt: question.createdAt },
      answer: { text: answer.text, status: answer.status as AiHistory['messages'][number]['answer']['status'] } });
  }
  return { version: 1, id: entry.id, title: entry.title, createdAt: entry.createdAt, updatedAt: entry.updatedAt, messages };
}

export async function loadAiHistory(): Promise<AiHistory[]> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const saved = await chrome.storage.local.get(null);
  const entries: AiHistory[] = [];
  for (const [key, value] of Object.entries(saved)) {
    if (!key.startsWith(PREFIX)) continue;
    if (record(value).deleted === true && key === PREFIX + record(value).id) continue;
    const entry = readHistory(value);
    if (!entry || key !== PREFIX + entry.id) throw new Error('部分问答历史无法读取，原记录已保留');
    entries.push(entry);
  }
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function saveAiHistory(entry: AiHistory): Promise<boolean> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  return window.navigator.locks.request(PREFIX + entry.id, async () => {
    const key = PREFIX + entry.id;
    const saved = await chrome.storage.local.get(key);
    if (record(saved[key]).deleted === true) return false;
    await chrome.storage.local.set({ [key]: entry });
    return true;
  });
}

export async function deleteAiHistory(id: string): Promise<void> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await window.navigator.locks.request(PREFIX + id, async () => {
    // 移除所有问答与名称，仅留删除标记，阻止其他面板的迟到保存恢复记录。
    await chrome.storage.local.set({ [PREFIX + id]: { version: 1, id, deleted: true } });
  });
}
