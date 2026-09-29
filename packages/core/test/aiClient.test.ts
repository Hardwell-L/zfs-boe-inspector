import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiEndpoint, aiRequestBody, defaultAiSettings, fetchAiModels, loadAiSettings, normalizeAiSettings, prepareAiRequest, readAiStream, saveAiSettings, streamAnswer, testAiConnection, type AiSettings } from '../../../apps/extension/src/panel/aiClient';
import { createTextBatch } from '../../../apps/extension/src/panel/aiConversation';
const settings = (values: Partial<AiSettings> = {}): AiSettings => ({ ...defaultAiSettings, key: 'test-key', ...values });
const messages = [{ role: 'user' as const, content: '你好' }];
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
function stream(text: string, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (let i = 0; i < bytes.length; i += chunkSize) controller.enqueue(bytes.slice(i, i + chunkSize));
    controller.close();
  } });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('AI 地址与旧配置迁移', () => {
  it.each([
    ['https://api.openai.com', 'auto', 'https://api.openai.com/v1/chat/completions'],
    ['https://api.deepseek.com/', 'auto', 'https://api.deepseek.com/chat/completions'],
    ['https://relay.test', 'auto', 'https://relay.test/v1/chat/completions'],
    ['https://relay.test/prefix/', 'auto', 'https://relay.test/prefix/chat/completions'],
    ['https://relay.test/prefix', 'v1', 'https://relay.test/prefix/v1/chat/completions'],
    ['https://relay.test/v1///', 'v1', 'https://relay.test/v1/chat/completions'],
    ['https://relay.test', 'preserve', 'https://relay.test/chat/completions'],
    ['http://localhost:8080/v1/responses', 'auto', 'http://localhost:8080/v1/chat/completions'],
  ] as const)('%s · %s', (baseUrl, addressMode, expected) => {
    expect(aiEndpoint(settings({ baseUrl, addressMode }))).toBe(expected);
  });
  it('完整端点切换协议、模型列表均共用根路径', () => {
    const config = settings({ baseUrl: 'https://relay.test/proxy/v1/chat/completions/', protocol: 'responses' });
    expect(aiEndpoint(config)).toBe('https://relay.test/proxy/v1/responses');
    expect(aiEndpoint(config, true)).toBe('https://relay.test/proxy/v1/models');
  });
  it.each(['https://user:password@example.com', 'https://example.com/?key=x', 'https://example.com/#hash', 'http://example.com', 'file:///tmp/model'])('拒绝不安全地址 %s', (baseUrl) => {
    expect(() => aiEndpoint(settings({ baseUrl }))).toThrow();
  });
  it('旧第三方配置保留行为，官方修复路径及 token 参数', () => {
    expect(normalizeAiSettings({ baseUrl: 'https://relay.test', model: 'my-model' })).toMatchObject({ addressMode: 'preserve', chatTokenMode: 'max_tokens', protocol: 'chat', reasoningEffort: 'default', model: 'my-model' });
    expect(normalizeAiSettings({ baseUrl: 'https://api.openai.com' })).toMatchObject({ addressMode: 'auto', chatTokenMode: 'auto' });
    expect(normalizeAiSettings({ maxTokens: 0, maxRequestBytes: Infinity })).toMatchObject({ maxTokens: 4096, maxRequestBytes: 150000 });
  });
  it('新字段持久化，不记住的 Key 只保存在 session', async () => {
    const local = { setAccessLevel: vi.fn(), get: vi.fn().mockResolvedValue({ aiSettings: { baseUrl: 'https://api.openai.com' } }), set: vi.fn() };
    const session = { setAccessLevel: vi.fn(), get: vi.fn().mockResolvedValue({ aiKey: 'session-key' }), set: vi.fn() };
    vi.stubGlobal('chrome', { storage: { local, session } });
    expect(await loadAiSettings()).toMatchObject({ key: 'session-key', addressMode: 'auto' });
    const config = settings({ protocol: 'responses', reasoningEffort: 'high' });
    await saveAiSettings(config);
    expect(local.set).toHaveBeenCalledWith({ aiSettings: { ...config, key: '' } });
    expect(session.set).toHaveBeenCalledWith({ aiKey: 'test-key' });
  });
});

describe('请求构造、模型获取和连接测试', () => {
  it('默认 DeepSeek 请求不增加专用参数', () => {
    expect(aiRequestBody(settings(), messages)).toEqual({ model: 'deepseek-v4-flash', messages, stream: true, max_tokens: 4096 });
  });
  it('官方 Chat 与中转覆盖使用正确 token 字段，none 仍发送', () => {
    expect(aiRequestBody(settings({ baseUrl: 'https://api.openai.com', reasoningEffort: 'none' }), messages)).toMatchObject({ max_completion_tokens: 4096, reasoning_effort: 'none' });
    const body = aiRequestBody(settings({ chatTokenMode: 'max_completion_tokens' }), messages);
    expect(body).toHaveProperty('max_completion_tokens'); expect(body).not.toHaveProperty('max_tokens');
  });
  it('Responses 保留消息顺序、关闭服务端存储且不混入 Chat 字段', () => {
    expect(aiRequestBody(settings({ protocol: 'responses', reasoningEffort: 'high' }), messages)).toEqual({ model: 'deepseek-v4-flash', input: messages, stream: true, store: false, max_output_tokens: 4096, reasoning: { effort: 'high' } });
  });
  it.each([150_000, 2_000_000])('大请求 %i 的 UTF-8 字节与实际发送字符串一致', (size) => {
    const prepared = prepareAiRequest(settings(), [{ role: 'user', content: '中'.repeat(Math.floor(size / 3)) }]);
    expect(prepared.bytes).toBe(new TextEncoder().encode(prepared.json).length);
    expect(JSON.parse(prepared.json)).toEqual(prepared.body);
  });
  it('1000 个模型去重排序、忽略异常 ID，只 GET 模型列表', async () => {
    const data = Array.from({ length: 1000 }, (_, index) => ({ id: `model-${index}` }));
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: [...data, data[0], null, { id: '' }] })); vi.stubGlobal('fetch', fetch);
    const models = await fetchAiModels(settings(), new AbortController().signal);
    expect(models).toHaveLength(1000); expect(models).toEqual([...models].sort());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]![0]).toBe('https://api.deepseek.com/models');
    expect(fetch.mock.calls[0]![1]).not.toHaveProperty('body');
  });
  it.each([401, 404, 429])('模型列表 HTTP %i 不重试', async (status) => {
    const fetch = vi.fn().mockResolvedValue(new Response('', { status })); vi.stubGlobal('fetch', fetch);
    await expect(fetchAiModels(settings(), new AbortController().signal)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('测试携带所选协议和推理配置，达到上限只给 warning', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } })); vi.stubGlobal('fetch', fetch);
    expect((await testAiConnection(settings({ protocol: 'responses', reasoningEffort: 'high' }))).status).toBe('warning');
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toMatchObject({ max_output_tokens: 128, reasoning: { effort: 'high' }, stream: false });
  });
  it.each(['chat', 'responses'] as const)('%s 测试验证完整可用文本', async (protocol) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(protocol === 'chat'
      ? { choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] }
      : { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }] })));
    expect((await testAiConnection(settings({ protocol }))).status).toBe('success');
  });
  it('Responses 测试不将拒绝或失败当成功', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ status: 'failed', output: [] })));
    await expect(testAiConnection(settings({ protocol: 'responses' }))).rejects.toThrow();
  });
  it('正式发送直接复用预算检查过的 JSON', async () => {
    vi.stubGlobal('window', globalThis);
    const fetch = vi.fn().mockResolvedValue(new Response(stream(frame({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] })), { headers: { 'Content-Type': 'text/event-stream' } })); vi.stubGlobal('fetch', fetch);
    const config = settings(); const prepared = prepareAiRequest(config, messages);
    expect(await streamAnswer(config, prepared, new AbortController().signal, () => {})).toEqual({ status: 'complete' });
    expect(fetch.mock.calls[0]![1].body).toBe(prepared.json);
  });
});

describe('SSE、终态与流式更新性能', () => {
  it.each([1, 7, 1000])('Chat 分块 %i，UTF-8 与末帧文本不丢失', async (size) => {
    let text = '';
    const result = await readAiStream(stream(': comment\r\n\r\n' + frame({ choices: [{ delta: { content: '你好' } }] }) + frame({ choices: [{ delta: { content: '世界' }, finish_reason: 'stop' }] }), size), 'chat', (part) => { text += part; });
    expect(result.status).toBe('complete'); expect(text).toBe('你好世界');
  });
  it('Responses 支持多行 data，忽略思考事件，不重复追加 done 文本', async () => {
    let text = '';
    const input = 'event: response.output_text.delta\ndata: {"type":"response.output_text.delta",\ndata: "delta":"答复"}\n\n'
      + frame({ type: 'response.reasoning_text.delta', delta: 'private' })
      + frame({ type: 'response.output_text.done', text: '答复' }) + frame({ type: 'response.completed' });
    expect((await readAiStream(stream(input, 1), 'responses', (part) => { text += part; })).status).toBe('complete');
    expect(text).toBe('答复');
  });
  it.each([
    ['chat', { choices: [{ delta: {}, finish_reason: 'length' }] }, 'length'],
    ['responses', { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } }, 'length'],
    ['responses', { type: 'response.incomplete', response: { incomplete_details: { reason: 'content_filter' } } }, 'error'],
    ['responses', { type: 'response.failed' }, 'error'],
  ] as const)('%s 终态 %j', async (protocol, event, status) => {
    expect((await readAiStream(stream(frame(event)), protocol, () => {})).status).toBe(status);
  });
  it('Responses 的 DONE 不替代完成事件，断流保留已收到的文本', async () => {
    let text = '';
    await expect(readAiStream(stream(frame({ type: 'response.output_text.delta', delta: '部分' }) + 'data: [DONE]\n\n'), 'responses', (part) => { text += part; })).rejects.toThrow('中断');
    expect(text).toBe('部分');
  });
  it('格式损坏及空回答不报成功', async () => {
    await expect(readAiStream(stream('data: {bad}\n\n'), 'chat', () => {})).rejects.toThrow();
    await expect(readAiStream(stream(frame({ type: 'response.completed' })), 'responses', () => {})).rejects.toThrow();
  });
  it('1000 次增量在 50ms 内只提交一次，终态 flush 不丢失且不重复', () => {
    vi.useFakeTimers(); const append = vi.fn(); const batch = createTextBatch(append);
    for (let i = 0; i < 1000; i += 1) batch.push('字');
    expect(append).not.toHaveBeenCalled(); vi.advanceTimersByTime(50);
    expect(append).toHaveBeenCalledExactlyOnceWith('字'.repeat(1000));
    batch.push('末尾'); batch.flush(); batch.flush(); vi.runAllTimers();
    expect(append).toHaveBeenCalledTimes(2); expect(append).toHaveBeenLastCalledWith('末尾');
  });
});
