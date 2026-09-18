import { computed, markRaw, onBeforeUnmount, reactive, watch } from 'vue';
import type { BoeInspectionSnapshot, InspectionSelection, RuleEvaluation, TraceSession } from '@zfs-boe-inspector/shared-types';
import { AI_SYSTEM_PROMPT, buildAiEvidence, createRedactor, scopeIdentity, scopeLabel, type AiEvidence } from './aiContext';
import { aiRequestBody, defaultAiSettings, loadAiSettings, saveAiSettings, streamAnswer, testAiConnection, type AiSettings, type ChatMessage, type StreamResult } from './aiClient';
import { bytes, recentHistory, REQUEST_LIMIT, sentEvidence } from './aiConversation';
import { scopeIssues } from './aiScopes';
import { deleteAiHistory, historyFromSession, loadAiHistory, saveAiHistory, type AiHistory } from './aiHistory';

export interface AiSource { snapshot: BoeInspectionSnapshot; evaluations: RuleEvaluation[]; pageId: string }
export type FrozenEvidence = ReturnType<typeof sentEvidence>[number] & Pick<AiEvidence, 'kind' | 'group'> & { selection?: InspectionSelection };
export interface AiAnswer {
  id: number; context: number; sentAt: string; capturedAt: string; question: string; answer: string;
  status: StreamResult['status'] | 'streaming'; error: string; evidence: FrozenEvidence[];
  scopes: string[]; service: { model: string; baseUrl: string; maxTokens: number };
  baseMessages: ChatMessage[]; requests: ReturnType<typeof aiRequestBody>[]; omitted: number;
}
export interface AiSession {
  id: number; title: string; customTitle: boolean; historyId: string; createdAt: string; binding: string; source: AiSource; draft: string;
  scopes: InspectionSelection[]; eventId: string; trace: TraceSession | undefined; includeFormattedDto: boolean;
  evidence: AiEvidence[]; answers: AiAnswer[]; context: number; basis: string; conditionsChanged: boolean;
  redact: ReturnType<typeof createRedactor>; error: string; note: string; scrollTop: number; followLatest: boolean;
  collapsed: boolean; staleDraft: boolean;
}
interface ActiveRequest { id: number; sessionId: number; phase: 'preparing' | 'generating'; controller: AbortController }
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
export const sourceIdentity = (source: AiSource) => JSON.stringify([source.pageId, source.snapshot.meta.projectCode, source.snapshot.meta.environment, source.snapshot.instanceId,
  // 无业务 ID 时，数据变化也无法排除切换了草稿；保守要求新会话。
  source.snapshot.instanceId.endsWith(':active') ? source.snapshot.runtime.rawBillData : null]);
const evidenceIdentity = (item: AiEvidence) => JSON.stringify([item.path, item.kind, item.selection ? scopeIdentity(item.selection) : '']);
const message = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);

export function useAiWorkspace(readSource: (session: AiSession) => Promise<AiSource>) {
  const initialState = {
    sessions: [] as AiSession[], activeId: 0, tab: 'conversation' as 'conversation' | 'evidence' | 'settings' | 'history',
    source: undefined as AiSource | undefined, request: undefined as ActiveRequest | undefined,
    settings: { ...defaultAiSettings }, settingsReady: false, saving: false, settingsNote: '', settingsError: '',
    test: { status: 'idle' as 'idle' | 'testing' | 'success' | 'warning' | 'error', message: '' },
    closed: undefined as { session: AiSession; index: number } | undefined, pickerSessionId: 0,
    history: [] as AiHistory[], historyReady: false, historySaving: 0, historyError: '', historyDeleting: '',
  };
  // 明确业务状态类型，避免 Vue 对递归 JSON 证据无限展开。
  const state = reactive<object>(initialState) as typeof initialState;
  let sessionSequence = 0;
  let answerSequence = 0;
  let requestSequence = 0;
  let testSequence = 0;
  let disposed = false;
  const historySecrets = new Set<string>();
  const historyTimers = new Map<string, number>();
  const historyWrites = new Map<string, Promise<void>>();
  const failedHistory = reactive(new Map<string, AiHistory>());
  const deletedHistory = reactive(new Set<string>());
  const historyUnsaved = computed(() => failedHistory.size);
  const current = computed(() => state.sessions.find((session) => session.id === state.activeId));
  const busy = computed(() => Boolean(state.request || state.test.status === 'testing' || state.saving || !state.settingsReady));
  const configured = computed(() => Boolean(state.settings.baseUrl.trim() && state.settings.model.trim() && state.settings.key.trim()));
  const available = (session: AiSession) => Boolean(state.source && sourceIdentity(state.source) === session.binding && !session.staleDraft);
  const mutable = (session: AiSession) => !busy.value && available(session) && !state.pickerSessionId;

  function writeHistory(entry: AiHistory) {
    state.historySaving += 1;
    const previous = historyWrites.get(entry.id) ?? Promise.resolve();
    const pending = previous.then(() => saveAiHistory(entry)).then((saved) => {
      if (!saved) forgetHistory(entry.id);
      failedHistory.delete(entry.id);
      if (!failedHistory.size) state.historyError = '';
    }).catch(() => {
      failedHistory.set(entry.id, entry);
      state.historyError = '问答历史保存失败（可能空间不足），内容暂留当前面板，请重试保存。';
    }).finally(() => {
      state.historySaving -= 1;
      if (historyWrites.get(entry.id) === pending) historyWrites.delete(entry.id);
    });
    historyWrites.set(entry.id, pending);
  }
  function persist(session: AiSession) {
    window.clearTimeout(historyTimers.get(session.historyId)); historyTimers.delete(session.historyId);
    if (!session.answers.length || deletedHistory.has(session.historyId) || state.historyDeleting === session.historyId) return;
    const entry = historyFromSession(session, historySecrets);
    const index = state.history.findIndex((item) => item.id === entry.id);
    if (index < 0) state.history.unshift(entry); else state.history.splice(index, 1, entry);
    writeHistory(entry);
  }
  function scheduleHistory(session: AiSession) {
    if (deletedHistory.has(session.historyId) || state.historyDeleting === session.historyId || historyTimers.has(session.historyId)) return;
    historyTimers.set(session.historyId, window.setTimeout(() => persist(session), 1500));
  }
  function retryHistory() {
    if (state.historySaving || state.historyDeleting) return;
    for (const entry of failedHistory.values()) writeHistory(entry);
  }
  function forgetHistory(id: string) {
    deletedHistory.add(id);
    window.clearTimeout(historyTimers.get(id)); historyTimers.delete(id);
    failedHistory.delete(id);
    state.history = state.history.filter((entry) => entry.id !== id);
  }
  const historyDisabled = (session: AiSession) => deletedHistory.has(session.historyId);
  async function deleteHistory(id: string) {
    if (state.historyDeleting || !state.historyReady || !state.history.some((entry) => entry.id === id)) return;
    state.historyDeleting = id;
    window.clearTimeout(historyTimers.get(id)); historyTimers.delete(id);
    try {
      await historyWrites.get(id);
      await deleteAiHistory(id);
      forgetHistory(id);
    } catch {
      state.historyError = '删除问答历史失败，记录已保留，请重新删除。';
      const session = state.sessions.find((item) => item.historyId === id);
      if (session?.answers.length) {
        // 删除期间可能收到新回答；失败时保留最新内容，仍可通过历史页重试保存。
        const entry = historyFromSession(session, historySecrets);
        failedHistory.set(id, entry);
        state.history = state.history.map((item) => item.id === id ? entry : item);
      }
    } finally { state.historyDeleting = ''; }
  }
  async function reloadHistory() {
    if (!state.historyReady || state.historySaving || state.historyDeleting) return;
    state.historyReady = false;
    try {
      const saved = await loadAiHistory();
      // 保存失败的本面板记录仍保留，不能被磁盘旧版本覆盖。
      const entries = new Map(saved.map((item) => [item.id, item]));
      for (const entry of failedHistory.values()) entries.set(entry.id, entry);
      for (const local of state.history) {
        const stored = entries.get(local.id);
        if (stored && local.updatedAt >= stored.updatedAt) entries.set(local.id, local);
      }
      state.history = [...entries.values()];
      if (!failedHistory.size) state.historyError = '';
    } catch (reason) { state.historyError = message(reason); }
    finally { state.historyReady = true; }
  }

  function rebuild(session: AiSession) {
    const previous = new Map(session.evidence.map((item) => [evidenceIdentity(item), item]));
    const source = session.source;
    const evidence = buildAiEvidence(source.snapshot, session.scopes, source.evaluations, session.trace, { includeFormattedDto: session.includeFormattedDto });
    const event = session.trace?.events.find((item) => item.id === session.eventId);
    if (event) {
      const existing = evidence.find((item) => item.path === `trace.events.${event.id}`);
      if (existing) { existing.value = event; existing.automatic = false; existing.title = `所选过程 · ${event.method}`; }
      else evidence.push({ id: `E${evidence.length + 1}`, title: `所选过程 · ${event.method}`, path: `trace.events.${event.id}`, value: event, group: 'trace', kind: 'trace', automatic: false, included: true, original: false });
    }
    for (const item of evidence) {
      const old = previous.get(evidenceIdentity(item));
      if (old) {
        item.included = old.included;
        item.original = old.original && JSON.stringify(old.value) === JSON.stringify(item.value);
      }
    }
    session.evidence = evidence;
  }
  function setSource(source: AiSource | undefined) {
    if (!source || (state.source && state.source.pageId !== source.pageId)) {
      // 无业务 ID 的草稿无法在断连/页面变化后证明仍是同一张单据。
      const sessions = state.closed ? [...state.sessions, state.closed.session] : state.sessions;
      for (const session of sessions) if (session.source.snapshot.instanceId.endsWith(':active')) session.staleDraft = true;
    }
    state.source = source;
    if (state.request) {
      const owner = state.sessions.find((session) => session.id === state.request?.sessionId);
      if (!owner || !available(owner)) stop();
    }
    if (source && !state.sessions.length) create();
  }
  function create(scopes: InspectionSelection[] = [], trace?: TraceSession, eventId = '', source = state.source) {
    if (!source || busy.value || state.pickerSessionId || disposed) return;
    const id = ++sessionSequence;
    state.sessions.push({ id, title: `新会话 ${id}`, customTitle: false, historyId: crypto.randomUUID(), createdAt: new Date().toISOString(), binding: sourceIdentity(source),
      source: clone(source), draft: eventId ? '分析所选报错或过程，说明相关字段、原因、缺失证据及验证方法。' : '',
      scopes: clone(scopes), trace: trace ? clone(trace) : undefined, eventId, includeFormattedDto: false,
      evidence: [], answers: [], context: 0, basis: '', conditionsChanged: false, redact: createRedactor(), error: '', note: '',
      scrollTop: 0, followLatest: true, collapsed: false, staleDraft: false });
    const session = state.sessions[state.sessions.length - 1]!;
    rebuild(session); state.activeId = id; state.tab = 'conversation'; return session;
  }
  function select(id: number) {
    if (state.pickerSessionId || !state.sessions.some((session) => session.id === id)) return;
    state.activeId = id; state.tab = 'conversation';
  }
  function rename(id: number, title: string) {
    const session = state.sessions.find((item) => item.id === id);
    const value = title.trim().slice(0, 60);
    if (!session || !value || state.pickerSessionId) return;
    session.title = value; session.customTitle = true; persist(session);
  }
  function stop() {
    const request = state.request;
    if (!request) return;
    request.controller.abort();
    const session = state.sessions.find((item) => item.id === request.sessionId);
    const answer = session?.answers.find((item) => item.status === 'streaming');
    if (answer && session) { answer.status = 'stopped'; persist(session); }
    state.request = undefined;
  }
  function close(id: number) {
    if (state.pickerSessionId || (busy.value && !state.request)) return;
    const index = state.sessions.findIndex((session) => session.id === id);
    const session = state.sessions[index];
    if (!session) return;
    if (state.request?.sessionId === id) stop();
    persist(session);
    state.closed = session.answers.length || session.draft.trim() || session.scopes.length || session.eventId || session.customTitle ? { session, index } : undefined;
    state.sessions.splice(index, 1);
    if (state.activeId === id) state.activeId = state.sessions[Math.max(0, index - 1)]?.id ?? 0;
    if (!state.sessions.length) create([], undefined, '', state.source ?? session.source);
  }
  function undoClose() {
    if (!state.closed || state.pickerSessionId) return;
    const { session, index } = state.closed;
    state.sessions.splice(Math.min(index, state.sessions.length), 0, session);
    state.closed = undefined; select(session.id);
  }
  function setScopes(session: AiSession, scopes: InspectionSelection[], fromPicker = false) {
    if (busy.value || !available(session) || (state.pickerSessionId && (!fromPicker || state.pickerSessionId !== session.id))) return;
    session.scopes = clone(scopes); session.conditionsChanged = true; rebuild(session);
  }
  function addScope(selection: InspectionSelection, sessionId = state.activeId, fromPicker = false) {
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!session || session.scopes.some((item) => scopeIdentity(item) === scopeIdentity(selection))) return;
    setScopes(session, [...session.scopes, selection], fromPicker);
  }
  function changeEvidence(session: AiSession) { session.conditionsChanged = true; }
  function setDto(session: AiSession, enabled: boolean) {
    if (!mutable(session)) return;
    session.includeFormattedDto = enabled; session.conditionsChanged = true; rebuild(session);
  }
  function clearTrace(session: AiSession) {
    if (!mutable(session)) return;
    session.trace = undefined; session.eventId = ''; session.conditionsChanged = true; rebuild(session);
  }
  function requestView(session: AiSession, settings: AiSettings = state.settings) {
    const selected = session.evidence.filter((item) => item.included);
    const evidence: FrozenEvidence[] = sentEvidence(selected, session.redact).map((item, index) => {
      const original = selected[index]!;
      return { ...item, kind: original.kind, group: original.group, ...(original.selection ? { selection: clone(original.selection) } : {}) };
    });
    const scopes = session.scopes.map((scope) => String(session.redact(scopeLabel(session.source.snapshot, scope))));
    const question = String(session.redact(session.draft));
    const history = recentHistory(session.conditionsChanged ? [] : session.answers.filter((answer) => answer.context === session.context && answer.status === 'complete')
      .map((answer) => ({ question: String(session.redact(answer.question)), answer: String(session.redact(answer.answer)) })));
    const messages: ChatMessage[] = [{ role: 'system', content: AI_SYSTEM_PROMPT }, ...history.messages,
      { role: 'user', content: JSON.stringify({ capturedAt: session.source.snapshot.capturedAt, scopes, question,
        evidence: evidence.map(({ id, title, path, value }) => ({ id, title, path, value })) }) }];
    return { evidence, scopes, question, body: aiRequestBody(settings, messages), omitted: history.omitted };
  }
  function reconcile(session: AiSession, settings: AiSettings) {
    const basis = JSON.stringify([{ ...session.source.snapshot, capturedAt: undefined }, session.scopes, session.trace, session.eventId,
      session.includeFormattedDto, session.evidence.map((item) => [evidenceIdentity(item), item.included, item.original]), settings.baseUrl, settings.model]);
    if (session.basis && (session.conditionsChanged || session.basis !== basis)) session.context += 1;
    session.basis = basis; session.conditionsChanged = false;
  }
  function acquire(session: AiSession) {
    if (!mutable(session) || disposed) return;
    const request: ActiveRequest = { id: ++requestSequence, sessionId: session.id, phase: 'preparing', controller: markRaw(new AbortController()) };
    state.request = request; session.error = ''; session.note = ''; return request;
  }
  const live = (request: ActiveRequest) => !disposed && !request.controller.signal.aborted && state.request?.id === request.id;
  function release(request: ActiveRequest) { if (state.request?.id === request.id) state.request = undefined; }
  async function updateSnapshot(session: AiSession, request: ActiveRequest) {
    const source = await readSource(session);
    if (!live(request)) return false;
    if (sourceIdentity(source) !== session.binding || !available(session)) throw new Error('页面或单据已变化，请刷新插件并新建会话');
    session.source = clone(source); state.source = source; rebuild(session); return true;
  }
  async function refresh(session: AiSession) {
    const request = acquire(session);
    if (!request) return;
    try { if (await updateSnapshot(session, request)) session.note = '已刷新当前会话的数据'; }
    catch (reason) { if (live(request)) session.error = message(reason); }
    finally { release(request); }
  }
  async function generate(answer: AiAnswer, settings: AiSettings, messages: ChatMessage[], request: ActiveRequest) {
    const body = aiRequestBody(settings, messages);
    if (bytes(body) > REQUEST_LIMIT) throw new Error('请求超过 150 KB，请缩小范围');
    if (!live(request)) return;
    state.request!.phase = 'generating'; answer.status = 'streaming'; answer.error = ''; answer.requests.push(clone(body));
    if (settings.key.trim()) historySecrets.add(settings.key.trim());
    const owner = state.sessions.find((session) => session.id === request.sessionId)!;
    persist(owner);
    const result = await streamAnswer(settings, messages, request.controller.signal, (text) => {
      if (live(request)) { answer.answer += text; scheduleHistory(owner); }
    });
    if (live(request)) { answer.status = result.status; answer.error = result.error ?? ''; persist(owner); }
  }
  async function send(session: AiSession) {
    if (!configured.value || !session.draft.trim() || (!session.scopes.length && !session.eventId)) return;
    const request = acquire(session);
    if (!request) return;
    const settings = { ...state.settings };
    const draft = session.draft;
    try {
      if (!await updateSnapshot(session, request)) return;
      const issues = scopeIssues(session.source.snapshot, session.scopes);
      if (issues.length) throw new Error(issues.join('；'));
      if (session.eventId && (session.trace?.instanceId !== session.source.snapshot.instanceId || !session.trace.events.some((event) => event.id === session.eventId))) throw new Error('所选过程已失效，请重新选择');
      reconcile(session, settings);
      const prepared = requestView(session, settings);
      if (!prepared.evidence.length) throw new Error('请选择至少一项发送证据');
      if (bytes(prepared.body) > REQUEST_LIMIT) throw new Error('请求超过 150 KB，请调整范围后重新发送');
      session.answers.push({ id: ++answerSequence, context: session.context, sentAt: new Date().toISOString(), capturedAt: session.source.snapshot.capturedAt,
        question: prepared.question, answer: '', status: 'streaming', error: '', evidence: clone(prepared.evidence), scopes: prepared.scopes,
        service: { model: settings.model, baseUrl: settings.baseUrl, maxTokens: settings.maxTokens }, baseMessages: clone(prepared.body.messages), requests: [], omitted: prepared.omitted });
      if (session.answers.length === 1 && !session.customTitle) session.title = prepared.question.slice(0, 16) || `会话 ${session.id}`;
      session.draft = ''; session.followLatest = true;
      await generate(session.answers[session.answers.length - 1]!, settings, prepared.body.messages, request);
    } catch (reason) {
      if (live(request)) { session.error = message(reason); session.draft = draft; }
    } finally { release(request); }
  }
  async function continueAnswer(session: AiSession, answer: AiAnswer) {
    if (answer.status !== 'length' || answer.context !== session.context || session.conditionsChanged
      || answer.service.baseUrl !== state.settings.baseUrl || answer.service.model !== state.settings.model) {
      session.error = '分析条件已变化，请重新提问'; return;
    }
    const request = acquire(session);
    if (!request) return;
    const settings = { ...state.settings, ...answer.service };
    try {
      // 核对页面身份，但续写仍使用原回答的冻结证据。
      const source = await readSource(session);
      if (!live(request)) return;
      if (sourceIdentity(source) !== session.binding) throw new Error('页面或单据已变化，请重新提问');
      await generate(answer, settings, [...clone(answer.baseMessages), { role: 'assistant', content: answer.answer },
        { role: 'user', content: '请从断点继续，不重复已有内容，继续使用原证据编号，完成结论和建议。' }], request);
    } catch (reason) { if (live(request)) session.error = message(reason); }
    finally { release(request); }
  }
  watch(() => [state.settings.baseUrl, state.settings.model], () => {
    for (const session of state.sessions) session.conditionsChanged = true;
    if (state.closed) state.closed.session.conditionsChanged = true;
  }, { flush: 'sync' });
  watch(() => [state.settings.baseUrl, state.settings.model, state.settings.key, state.settings.maxTokens], () => {
    testSequence += 1; state.test = { status: 'idle', message: '' };
  }, { flush: 'sync' });
  async function load() {
    const [settings, history] = await Promise.allSettled([loadAiSettings(), loadAiHistory()]);
    if (disposed) return;
    if (settings.status === 'fulfilled') state.settings = settings.value; else state.settingsError = message(settings.reason);
    if (history.status === 'fulfilled') state.history = history.value; else state.historyError = message(history.reason);
    state.settingsReady = true; state.historyReady = true;
    if (!state.sessions.length && state.source) create();
  }
  async function save(clearKey = false) {
    if (busy.value) return;
    state.saving = true; state.settingsError = ''; state.settingsNote = '';
    try {
      if (clearKey) state.settings.key = '';
      await saveAiSettings({ ...state.settings }); state.settingsNote = clearKey ? '已清除 Key' : '设置已保存';
    } catch (reason) { state.settingsError = message(reason); }
    finally { state.saving = false; }
  }
  async function test() {
    if (busy.value) return;
    const id = ++testSequence;
    const settings = { ...state.settings };
    state.test = { status: 'testing', message: '正在测试模型…' };
    try {
      const result = await testAiConnection(settings);
      if (!disposed && id === testSequence) state.test = result;
    } catch (reason) { if (!disposed && id === testSequence) state.test = { status: 'error', message: `✕ ${message(reason)}` }; }
  }
  onBeforeUnmount(() => {
    disposed = true; stop(); testSequence += 1;
    for (const session of state.sessions) if (historyTimers.has(session.historyId)) persist(session);
  });
  const workspace = { state, current, busy, configured, available, mutable, setSource, create, select, rename, close, undoClose, stop,
    retryHistory, reloadHistory, historyUnsaved, deleteHistory, historyDisabled,
    setScopes, addScope, changeEvidence, setDto, clearTrace, requestView, refresh, send, continueAnswer, load, save, test };
  return reactive<object>(workspace) as Omit<typeof workspace, 'current' | 'busy' | 'configured' | 'historyUnsaved'>
    & { current: AiSession | undefined; busy: boolean; configured: boolean; historyUnsaved: number };
}
export type AiWorkspace = ReturnType<typeof useAiWorkspace>;
