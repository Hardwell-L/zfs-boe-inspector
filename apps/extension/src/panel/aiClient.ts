export const REASONING_EFFORTS = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export interface AiSettings {
  baseUrl: string;
  model: string;
  key: string;
  remember: boolean;
  maxTokens: number;
  maxRequestBytes: number;
  protocol: 'chat' | 'responses';
  addressMode: 'auto' | 'v1' | 'preserve';
  reasoningEffort: typeof REASONING_EFFORTS[number];
  chatTokenMode: 'auto' | 'max_tokens' | 'max_completion_tokens';
}
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }
export const DEFAULT_REQUEST_BYTES = 150_000;
export const MIN_REQUEST_BYTES = 32_000;
export const MAX_REQUEST_BYTES = 2_000_000;
export const defaultAiSettings: AiSettings = {
  baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', key: '', remember: false, maxTokens: 4096,
  maxRequestBytes: DEFAULT_REQUEST_BYTES, protocol: 'chat', addressMode: 'auto', reasoningEffort: 'default', chatTokenMode: 'auto',
};

export function aiEndpoint(settings: Pick<AiSettings, 'baseUrl' | 'addressMode' | 'protocol'>, models = false): string {
  const url = new URL(settings.baseUrl.trim());
  if (url.username || url.password || url.search || url.hash) throw new Error('服务地址不能包含凭据、查询参数或片段');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('请使用 HTTPS 服务地址；本机服务可使用 HTTP');
  }
  let path = url.pathname.replace(/\/+$/, '').replace(/\/(?:chat\/completions|responses)$/, '');
  if ((settings.addressMode === 'v1' && !path.endsWith('/v1'))
    || (settings.addressMode === 'auto' && !path && url.origin !== 'https://api.deepseek.com')) path += '/v1';
  return `${url.origin}${path}/${models ? 'models' : settings.protocol === 'responses' ? 'responses' : 'chat/completions'}`;
}

export function normalizeAiSettings(saved: Partial<AiSettings> = {}): AiSettings {
  let official = false;
  try { official = new URL(saved.baseUrl ?? defaultAiSettings.baseUrl).origin === 'https://api.openai.com'; } catch { /* 保留地址，交由设置页提示。 */ }
  const settings = { ...defaultAiSettings, ...saved };
  return {
    ...settings,
    baseUrl: typeof settings.baseUrl === 'string' ? settings.baseUrl : defaultAiSettings.baseUrl,
    model: typeof settings.model === 'string' ? settings.model : defaultAiSettings.model,
    key: typeof settings.key === 'string' ? settings.key : '', remember: settings.remember === true,
    protocol: saved.protocol === 'responses' ? 'responses' : 'chat',
    addressMode: ['auto', 'v1', 'preserve'].includes(saved.addressMode ?? '') ? saved.addressMode! : saved.baseUrl && !official ? 'preserve' : 'auto',
    reasoningEffort: REASONING_EFFORTS.includes(saved.reasoningEffort!) ? saved.reasoningEffort! : 'default',
    chatTokenMode: ['auto', 'max_tokens', 'max_completion_tokens'].includes(saved.chatTokenMode ?? '') ? saved.chatTokenMode! : saved.baseUrl && !official ? 'max_tokens' : 'auto',
    maxTokens: Number.isInteger(saved.maxTokens) && saved.maxTokens! >= 128 && saved.maxTokens! <= 65536 ? saved.maxTokens! : 4096,
    maxRequestBytes: Number.isInteger(saved.maxRequestBytes) && saved.maxRequestBytes! >= MIN_REQUEST_BYTES && saved.maxRequestBytes! <= MAX_REQUEST_BYTES
      ? saved.maxRequestBytes! : DEFAULT_REQUEST_BYTES,
  };
}
export async function loadAiSettings(): Promise<AiSettings> {
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  const [local, session] = await Promise.all([chrome.storage.local.get('aiSettings'), chrome.storage.session.get('aiKey')]);
  const saved = local.aiSettings as Partial<AiSettings> | undefined;
  const key = saved?.remember ? saved.key : session.aiKey;
  return normalizeAiSettings({ ...saved, key: typeof key === 'string' ? key : '' });
}
function validateSettings(settings: AiSettings) {
  aiEndpoint(settings);
  validateOutputLimit(settings.maxTokens);
  validateRequestLimit(settings.maxRequestBytes);
  if (!['chat', 'responses'].includes(settings.protocol) || !['auto', 'v1', 'preserve'].includes(settings.addressMode)
    || !REASONING_EFFORTS.includes(settings.reasoningEffort) || !['auto', 'max_tokens', 'max_completion_tokens'].includes(settings.chatTokenMode)) {
    throw new Error('模型配置无效，请检查协议、地址及推理设置');
  }
}
export async function saveAiSettings(settings: AiSettings): Promise<void> {
  validateSettings(settings);
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  await chrome.storage.local.set({ aiSettings: { ...settings, key: settings.remember ? settings.key : '' } });
  await chrome.storage.session.set({ aiKey: settings.key });
}
function requestError(status: number): Error {
  const message: Record<number, string> = {
    400: '请求不兼容或内容过大，请检查协议、模型、推理强度与输出参数',
    401: 'API Key 无效或已过期', 402: '账户余额不足', 403: '没有服务或模型访问权限',
    404: '接口或模型不存在，请检查最终请求地址和模型标识',
    429: '请求限流或配额不足，请稍后手动重试',
  };
  return new Error(message[status] ?? `模型服务请求失败（HTTP ${status}），请稍后重试`);
}
const headers = (settings: AiSettings) => ({ Authorization: `Bearer ${settings.key.trim()}`, 'Content-Type': 'application/json' });
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
export async function fetchAiModels(settings: AiSettings, signal: AbortSignal): Promise<string[]> {
  if (!settings.key.trim()) throw new Error('请先填写 API Key');
  const response = await fetch(aiEndpoint(settings, true), {
    headers: headers(settings), redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]),
  });
  if (!response.ok) throw requestError(response.status);
  const result = record(await response.json());
  if (!Array.isArray(result.data)) throw new Error('服务未返回兼容的模型列表，可继续手动填写模型标识');
  return [...new Set<string>(result.data.map((item: unknown) => record(item).id)
    .filter((id: unknown): id is string => typeof id === 'string' && Boolean(id.trim())))].sort();
}

export interface ChatRequestBody {
  model: string; messages: ChatMessage[]; stream: boolean; reasoning_effort?: Exclude<AiSettings['reasoningEffort'], 'default'>;
  max_tokens?: number; max_completion_tokens?: number;
}
export interface ResponsesRequestBody {
  model: string; input: ChatMessage[]; stream: boolean; store: false; max_output_tokens: number;
  reasoning?: { effort: Exclude<AiSettings['reasoningEffort'], 'default'> };
}
export type AiRequestBody = ChatRequestBody | ResponsesRequestBody;
export function aiRequestBody(settings: AiSettings, messages: ChatMessage[], stream = true): AiRequestBody {
  const effort = settings.reasoningEffort === 'default' ? undefined : settings.reasoningEffort;
  if (settings.protocol === 'responses') return {
    model: settings.model.trim(), input: messages, stream, store: false, max_output_tokens: settings.maxTokens,
    ...(effort ? { reasoning: { effort } } : {}),
  };
  let official = false;
  try { official = new URL(settings.baseUrl).origin === 'https://api.openai.com'; } catch { /* 预览期间允许编辑未完成的地址。 */ }
  const tokenField = settings.chatTokenMode === 'auto' ? official ? 'max_completion_tokens' : 'max_tokens' : settings.chatTokenMode;
  return { model: settings.model.trim(), messages, stream, [tokenField]: settings.maxTokens, ...(effort ? { reasoning_effort: effort } : {}) };
}
export interface PreparedAiRequest { body: AiRequestBody; json: string; bytes: number }
export function prepareAiRequest(settings: AiSettings, messages: ChatMessage[], stream = true): PreparedAiRequest {
  const body = aiRequestBody(settings, messages, stream);
  const json = JSON.stringify(body);
  return { body, json, bytes: new TextEncoder().encode(json).length };
}
export interface AiConnectionTestResult { status: 'success' | 'warning'; message: string }
export async function testAiConnection(settings: AiSettings): Promise<AiConnectionTestResult> {
  if (!settings.key.trim() || !settings.model.trim()) throw new Error('请先填写 API Key 和模型标识');
  validateSettings(settings);
  const prepared = prepareAiRequest({ ...settings, maxTokens: 128 }, [{ role: 'user', content: 'Reply only OK.' }], false);
  const response = await fetch(aiEndpoint(settings), {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000), headers: headers(settings), body: prepared.json,
  });
  if (!response.ok) throw requestError(response.status);
  const result = record(await response.json());
  const choices = Array.isArray(result.choices) ? result.choices : [];
  const limited = settings.protocol === 'responses' ? result.status === 'incomplete' && result.incomplete_details?.reason === 'max_output_tokens'
    : choices.some((choice: any) => choice?.finish_reason === 'length');
  if (limited) return { status: 'warning', message: '⚠ 接口已连通，但测试回复达到 128 tokens 上限，尚未验证完整文本回答。' };
  const hasText = settings.protocol === 'responses'
    ? result.status === 'completed' && Array.isArray(result.output) && result.output.some((item: any) => item?.type === 'message'
      && Array.isArray(item.content) && item.content.some((part: any) => part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()))
    : choices.some((choice: any) => choice?.finish_reason === 'stop' && typeof choice?.message?.content === 'string' && choice.message.content.trim());
  if (!hasText) throw new Error('接口已响应，但模型未返回完整可用的文本回答，请检查模型与接口兼容性');
  return { status: 'success', message: '✓ 连接及模型调用成功' };
}
export interface StreamResult { status: 'complete' | 'length' | 'stopped' | 'error'; error?: string }
function validateOutputLimit(value: number) {
  if (!Number.isInteger(value) || value < 128 || value > 65536) throw new Error('输出上限请输入 128—65536 的整数，实际支持范围取决于模型');
}
export function validateRequestLimit(value: number) {
  if (!Number.isInteger(value) || value < MIN_REQUEST_BYTES || value > MAX_REQUEST_BYTES) {
    throw new Error(`请求体上限请输入 ${MIN_REQUEST_BYTES / 1000}—${MAX_REQUEST_BYTES / 1000} KB 的整数`);
  }
}

// 按完整 SSE 事件解析，避免网络分块截断 UTF-8、CRLF 或多行 data。
export async function readAiStream(body: ReadableStream<Uint8Array>, protocol: AiSettings['protocol'], onText: (text: string) => void): Promise<StreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = ''; let data: string[] = []; let eventBytes = 0; let received = false;
  let terminal: StreamResult | undefined;
  const emit = (text: unknown) => { if (typeof text === 'string' && text.length) { received = true; onText(text); } };
  const consume = () => {
    const value = data.join('\n').trim(); data = []; eventBytes = 0;
    if (!value) return;
    if (value === '[DONE]') { if (protocol === 'chat') terminal = { status: 'complete' }; return; }
    const payload = record(JSON.parse(value));
    if (payload.error || payload.type === 'error') throw new Error('模型服务在生成过程中返回错误，已保留收到的内容');
    if (protocol === 'responses') {
      if (payload.type === 'response.output_text.delta') emit(payload.delta);
      if (payload.type === 'response.refusal.delta') throw new Error('模型拒绝了本次请求，已保留收到的内容');
      if (payload.type === 'response.completed') terminal = { status: 'complete' };
      if (payload.type === 'response.incomplete') terminal = payload.response?.incomplete_details?.reason === 'max_output_tokens'
        ? { status: 'length' } : { status: 'error', error: '模型未完成回答，已保留收到的内容' };
      if (payload.type === 'response.failed') terminal = { status: 'error', error: '模型生成失败，已保留收到的内容' };
    } else {
      const choice = payload.choices?.[0];
      emit(choice?.delta?.content);
      if (choice?.delta?.refusal) throw new Error('模型拒绝了本次请求，已保留收到的内容');
      if (choice?.finish_reason) terminal = choice.finish_reason === 'length' ? { status: 'length' }
        : choice.finish_reason === 'stop' ? { status: 'complete' } : { status: 'error', error: '模型提前结束回答，已保留收到的内容' };
    }
  };
  const line = (value: string) => {
    if (!value) { consume(); return; }
    if (value.startsWith('data:')) {
      const part = value.slice(5).replace(/^ /, ''); eventBytes += part.length;
      if (eventBytes > 1_000_000) throw new Error('模型响应事件过大');
      data.push(part);
    }
  };
  try {
    while (!terminal) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let offset = 0;
      for (let i = 0; i < pending.length && !terminal; i += 1) {
        if (pending[i] !== '\n' && pending[i] !== '\r') continue;
        if (pending[i] === '\r' && i === pending.length - 1 && !done) break;
        line(pending.slice(offset, i));
        if (pending[i] === '\r' && pending[i + 1] === '\n') i += 1;
        offset = i + 1;
      }
      pending = pending.slice(offset);
      if (pending.length > 1_000_000) throw new Error('模型响应格式异常');
      if (done) { if (!terminal) { if (pending) line(pending); consume(); } break; }
    }
    if (!terminal || (terminal.status === 'complete' && !received)) throw new Error('模型响应中断或没有可用回答，请手动重试');
    return terminal;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function streamAnswer(
  settings: AiSettings, prepared: PreparedAiRequest, signal: AbortSignal, onText: (text: string) => void,
): Promise<StreamResult> {
  if (!settings.key.trim() || !settings.model.trim()) return { status: 'error', error: '请填写 API Key 和模型名' };
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = window.setTimeout(abort, 120_000);
  try {
    validateSettings(settings);
    if (prepared.bytes > settings.maxRequestBytes) throw new Error('请求超过配置的字节上限，请缩小范围');
    const response = await fetch(aiEndpoint(settings), {
      method: 'POST', redirect: 'error', signal: controller.signal, headers: headers(settings), body: prepared.json,
    });
    if (!response.ok) throw requestError(response.status);
    if (!response.body) throw new Error('模型服务没有返回响应内容');
    if (!response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('服务未返回兼容的 SSE 流');
    return await readAiStream(response.body, settings.protocol, onText);
  } catch (error) {
    if (controller.signal.aborted) return signal.aborted ? { status: 'stopped' } : { status: 'error', error: '请求超过 120 秒，已保留收到的内容' };
    return { status: 'error', error: error instanceof Error ? error.message : String(error) };
  } finally { window.clearTimeout(timeout); signal.removeEventListener('abort', abort); }
}
