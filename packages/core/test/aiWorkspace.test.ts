import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAiWorkspace, type AiAnswer, type AiSource } from '../../../apps/extension/src/panel/useAiWorkspace';
import { createRedactor } from '../../../apps/extension/src/panel/aiContext';
import { saveAiHistory } from '../../../apps/extension/src/panel/aiHistory';
vi.mock('../../../apps/extension/src/panel/aiHistory', async (original) => ({
  ...await original<object>(), saveAiHistory: vi.fn().mockResolvedValue(true),
}));
const source: AiSource = {
  pageId: 'page', evaluations: [], snapshot: {
    schemaVersion: 1, instanceId: 'bill', capturedAt: '2026-09-24T00:00:00Z',
    meta: { projectCode: 'test', environment: 'test', adapterVersion: 'test' },
    config: { template: [{ areaCode: 'header', areaFields: [{ fieldCode: 'name', fieldName: '名称', fieldType: 'input' }] }] },
    runtime: { rawBillData: { header: [{ name: '测试' }] } },
  },
};
function setup() {
  const workspace = useAiWorkspace(async () => source);
  workspace.state.settingsReady = true; workspace.state.settings.key = 'test-key';
  workspace.setSource(source);
  const session = workspace.current!;
  workspace.setScopes(session, [{ kind: 'field', areaCode: 'header', fieldCode: 'name', rowIndex: 0 }]);
  session.draft = '解释字段';
  return { workspace, session };
}
const tick = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
beforeEach(() => {
  vi.stubGlobal('window', globalThis);
  // 单元测试仅调用 composable，不挂载组件；卸载行为另做浏览器验证。
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.mocked(saveAiHistory).mockReset().mockResolvedValue(true);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('AI 证据缓存与协议切换', () => {
  it('问题和模型参数变化复用证据，原值选项、值和证据替换使缓存失效', () => {
    const { workspace, session } = setup();
    const first = workspace.requestView(session);
    session.draft = '另一个问题'; workspace.state.settings.protocol = 'responses'; workspace.state.settings.reasoningEffort = 'high';
    const second = workspace.requestView(session);
    expect(second.evidence).toBe(first.evidence);
    expect(second.body).toHaveProperty('input');
    expect(JSON.parse(second.messages.at(-1)!.content).question).toBe('另一个问题');
    session.evidence[0]!.original = !session.evidence[0]!.original;
    const third = workspace.requestView(session); expect(third.evidence).not.toBe(second.evidence);
    session.evidence[0]!.value = { changed: true };
    const fourth = workspace.requestView(session); expect(fourth.evidence).not.toBe(third.evidence);
    session.evidence = [...session.evidence]; expect(workspace.requestView(session).evidence).not.toBe(fourth.evidence);
  });
  it.each([150_000, 2_000_000])('证据约 %i bytes 时修改问题不会重复脱敏大对象', (size) => {
    const { workspace, session } = setup();
    session.evidence[0]!.value = { text: 'a'.repeat(size) };
    const original = session.redact;
    const redact = vi.fn(original); session.redact = redact;
    const first = workspace.requestView(session);
    const objectCalls = () => redact.mock.calls.filter(([value]) => value !== null && typeof value === 'object').length;
    const count = objectCalls();
    for (let i = 0; i < 10; i += 1) {
      session.draft = `问题 ${i}`;
      expect(workspace.requestView(session).evidence).toBe(first.evidence);
    }
    expect(objectCalls()).toBe(count);
  });
  it('取消勾选证据与知识库启停立即刷新缓存', () => {
    const { workspace, session } = setup();
    const first = workspace.requestView(session);
    session.evidence[0]!.included = false;
    const next = workspace.requestView(session);
    expect(next.evidence.length).toBe(first.evidence.length - 1);
    session.knowledgeEnabled = true;
    expect(workspace.requestView(session).evidence).not.toBe(next.evidence);
  });
  it('修改推理强度清除测试结果，并阻止旧参数续写', async () => {
    const { workspace, session } = setup();
    workspace.state.test = { status: 'success', message: 'old' };
    workspace.state.settings.reasoningEffort = 'high';
    expect(workspace.state.test.status).toBe('idle'); expect(session.conditionsChanged).toBe(true);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await workspace.continueAnswer(session, { status: 'length', context: session.context } as AiAnswer);
    expect(session.error).toContain('分析条件已变化'); expect(fetch).not.toHaveBeenCalled();
  });
});

describe('AI 流式停止与历史队列', () => {
  it('停止时提交尚未到 50ms 的尾部文本并保存，停止后不继续追加', async () => {
    vi.useFakeTimers();
    const { workspace, session } = setup();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })));
    const pending = workspace.send(session);
    await tick();
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"尾部"}}]}\n\n'));
    await tick();
    expect(session.answers[0]?.answer).toBe('');
    workspace.stop();
    expect(session.answers[0]?.answer).toBe('尾部'); expect(session.answers[0]?.status).toBe('stopped');
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"迟到"},"finish_reason":"stop"}]}\n\n'));
    await pending; await tick();
    expect(session.answers[0]?.answer).toBe('尾部');
    expect(vi.mocked(saveAiHistory).mock.calls.at(-1)![0].messages[0]!.answer.text).toBe('尾部');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('慢存储期间只保留最新待保存版本', async () => {
    const { workspace, session } = setup();
    session.answers.push({ id: 1, question: '问题', answer: '回答', status: 'complete', sentAt: 'now', service: { model: 'test' } } as AiAnswer);
    let release!: (value: boolean) => void;
    vi.mocked(saveAiHistory).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    workspace.rename(session.id, '版本一'); await tick();
    workspace.rename(session.id, '版本二'); workspace.rename(session.id, '版本三'); await tick();
    expect(saveAiHistory).toHaveBeenCalledTimes(1);
    release(true); await tick();
    expect(saveAiHistory).toHaveBeenCalledTimes(2);
    expect(vi.mocked(saveAiHistory).mock.calls[1]![0].title).toBe('版本三');
    expect(workspace.state.historySaving).toBe(0);
  });
});


describe('大文本脱敏回归', () => {
  it('正常邮箱与重复邮箱维持别名，保留原值仍清除凭据', () => {
    const redact = createRedactor();
    expect(redact('a+b.c@example.co.cn a+b.c@example.co.cn other@test.io')).toBe('[脱敏1] [脱敏1] [脱敏2]');
    expect(redact('a+b.c@example.co.cn Bearer secret-token', true)).toBe('a+b.c@example.co.cn [凭据已移除]');
  });
  it('长残缺邮箱不会反复从局部起点匹配，后面的有效邮箱仍脱敏', () => {
    const text = `${'a'.repeat(150_000)}@${'b'.repeat(150_000)} valid@example.com`;
    expect(createRedactor()(text)).toBe(`${'a'.repeat(150_000)}@${'b'.repeat(150_000)} [脱敏1]`);
  });
});
