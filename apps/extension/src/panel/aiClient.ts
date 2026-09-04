export interface AiSettings {
  baseUrl: string;
  model: string;
  key: string;
  remember: boolean;
  maxTokens: number;
}

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

export const defaultAiSettings: AiSettings = {
  baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', key: '', remember: false, maxTokens: 4096,
};

function endpoint(settings: AiSettings, path: string): string {
  const url = new URL(settings.baseUrl);
  if (url.username || url.password || url.search || url.hash) throw new Error('服务地址不能包含凭据、查询参数或片段');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('请使用 HTTPS 服务地址；本机服务可使用 HTTP');
  }
  return `${url.href.replace(/\/$/, '')}/${path}`;
}

export async function loadAiSettings(): Promise<AiSettings> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const local = await chrome.storage.local.get('aiSettings');
  const session = await chrome.storage.session.get('aiKey');
  const saved = local.aiSettings as Partial<AiSettings> | undefined;
  const key = saved?.remember ? saved.key : session.aiKey;
  return {
    ...defaultAiSettings, ...saved,
    maxTokens: Number.isInteger(saved?.maxTokens) && saved!.maxTokens! >= 128 && saved!.maxTokens! <= 65536 ? saved!.maxTokens! : 4096,
    key: typeof key === 'string' ? key : '',
  };
}

export async function saveAiSettings(settings: AiSettings): Promise<void> {
  endpoint(settings, 'chat/completions');
  validateOutputLimit(settings.maxTokens);
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.set({ aiSettings: { ...settings, key: settings.remember ? settings.key : '' } });
  await chrome.storage.session.set({ aiKey: settings.key });
}

function requestError(status: number): Error {
  const message: Record<number, string> = {
    400: '请求不兼容或内容过大，请检查模型与接口设置',
    401: 'API Key 无效或已过期', 402: '账户余额不足', 403: '没有服务或模型访问权限',
    404: '接口或模型不存在，请检查 Base URL 和模型名',
    429: '请求限流或配额不足，请稍后手动重试',
  };
  return new Error(message[status] ?? `模型服务请求失败（HTTP ${status}），请稍后重试`);
}

export async function testAiConnection(settings: AiSettings): Promise<void> {
  if (!settings.key.trim()) throw new Error('请先填写 API Key');
  const response = await fetch(endpoint(settings, 'chat/completions'), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${settings.key.trim()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: settings.model.trim(), messages: [{ role: 'user', content: 'Reply OK' }], max_tokens: 8, stream: false }),
  });
  if (!response.ok) throw requestError(response.status);
  const result = await response.json();
  if (!Array.isArray(result.choices)) throw new Error('服务返回了不兼容的响应');
}

export interface StreamResult {
  status: 'complete' | 'length' | 'stopped' | 'error';
  error?: string;
}

function validateOutputLimit(value: number) {
  if (!Number.isInteger(value) || value < 128 || value > 65536) throw new Error('输出上限请输入 128—65536 的整数，实际支持范围取决于模型');
}

export function aiRequestBody(settings: Pick<AiSettings, 'model' | 'maxTokens'>, messages: ChatMessage[]) {
  return { model: settings.model.trim(), messages, stream: true, max_tokens: settings.maxTokens };
}

export async function streamAnswer(
  settings: AiSettings, messages: ChatMessage[], signal: AbortSignal,
  onText: (text: string) => void,
): Promise<StreamResult> {
  if (!settings.key.trim() || !settings.model.trim()) return { status: 'error', error: '请填写 API Key 和模型名' };
  try { validateOutputLimit(settings.maxTokens); }
  catch (error) { return { status: 'error', error: String(error) }; }
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 120_000);
  try {
    const response = await fetch(endpoint(settings, 'chat/completions'), {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { Authorization: `Bearer ${settings.key.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(aiRequestBody(settings, messages)),
    });
    if (!response.ok) throw requestError(response.status);
    if (!response.body) throw new Error('模型服务没有返回响应内容');
    if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('服务未返回兼容的 SSE 流');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let finished = false;
    let received = false;
    let finishReason = '';
    const consume = (line: string) => {
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data) return;
      if (data === '[DONE]') { finished = true; return; }
      const payload = JSON.parse(data);
      if (payload.error) throw new Error('模型服务在生成过程中返回错误，请重试');
      const choice = payload.choices?.[0];
      // 最后一帧可能同时携带文本与结束原因，先保存文本。
      if (typeof choice?.delta?.content === 'string' && choice.delta.content.length > 0) {
        received = true;
        onText(choice.delta.content);
      }
      if (choice?.finish_reason) { finishReason = choice.finish_reason; finished = true; }
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) { consume(line); if (finished) break; }
        if (pending.length > 1_000_000) throw new Error('模型响应格式异常');
        if (done || finished) { if (done && !finished) consume(pending); break; }
      }
      if (finishReason === 'length') return { status: 'length' };
      if (finishReason && finishReason !== 'stop') throw new Error(`模型提前结束回答（${finishReason}），已保留收到的内容`);
      if (!finished || !received) throw new Error('模型响应中断或没有可用回答，请手动重试');
      return { status: 'complete' };
    } finally { await reader.cancel().catch(() => {}); }
  } catch (error) {
    if (controller.signal.aborted) return signal.aborted ? { status: 'stopped' } : { status: 'error', error: '请求超过 120 秒，已保留收到的内容' };
    return { status: 'error', error: error instanceof Error ? error.message : String(error) };
  } finally {
    window.clearTimeout(timeout);
    signal.removeEventListener('abort', abort);
  }
}
