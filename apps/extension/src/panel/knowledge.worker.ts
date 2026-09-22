import { parseKnowledge } from './knowledge';

export interface KnowledgeParseRequest { buffer: ArrayBuffer; name: string; id: string; version: string }
export interface KnowledgeParseResult { text: string; hash: string; parsed: ReturnType<typeof parseKnowledge> }
export type KnowledgeParseResponse = { ok: true; result: KnowledgeParseResult } | { ok: false; error: string };

// 与 DOM 类型共存，不向整个扩展项目引入 WebWorker 全局类型。
const scope = globalThis as unknown as {
  onmessage: (event: MessageEvent<KnowledgeParseRequest>) => void;
  postMessage: (response: KnowledgeParseResponse) => void;
};
scope.onmessage = async ({ data }) => {
  try {
    let text: string;
    try { text = new globalThis.TextDecoder('utf-8', { fatal: true }).decode(data.buffer); }
    catch { throw new Error('文件不是有效 UTF-8，请转换编码后导入'); }
    if (text.includes('\0')) throw new Error('文件含二进制空字符，请确认是 Markdown 文本');
    const hash = [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data.buffer))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    scope.postMessage({ ok: true, result: { text, hash, parsed: parseKnowledge(text, data.name, data.id, data.version) } });
  } catch (error) { scope.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
};
