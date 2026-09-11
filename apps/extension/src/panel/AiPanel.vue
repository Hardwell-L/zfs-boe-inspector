<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { BoeInspectionSnapshot, InspectionSelection, RuleEvaluation, TraceSession } from '@zfs-boe-inspector/shared-types';
import { AI_SYSTEM_PROMPT, buildAiEvidence, createRedactor, scopeIdentity, scopeLabel, type AiEvidence, type EvidenceGroup } from './aiContext';
import { aiRequestBody, defaultAiSettings, loadAiSettings, saveAiSettings, streamAnswer, testAiConnection, type ChatMessage, type StreamResult } from './aiClient';
import { bytes, recentHistory, REQUEST_LIMIT, sentEvidence } from './aiConversation';
import AiMarkdown from './AiMarkdown';
import AiScopeSelector from './AiScopeSelector.vue';
import { scopeIssues } from './aiScopes';

const props = defineProps<{
  active: boolean;
  analysisId: number;
  refreshing: boolean;
  refreshSnapshot: () => Promise<void>;
  snapshot: BoeInspectionSnapshot;
  evaluations: RuleEvaluation[];
  scopes: InspectionSelection[];
  trace?: TraceSession | undefined;
  eventId?: string;
  pickerActive: boolean;
  continuousPicker: boolean;
  areaPicker: boolean;
}>();
const emit = defineEmits<{
  scopes: [scopes: InspectionSelection[]]; locate: [selection: InspectionSelection];
  pick: [mode: 'field' | 'area']; finishPicker: []; busy: [busy: boolean];
  newAnalysis: []; clearEvent: [];
}>();
type SentEvidence = ReturnType<typeof sentEvidence>[number] & { selection?: InspectionSelection };
interface AnswerRecord {
  id: number;
  context: number;
  instanceId: string;
  capturedAt: string;
  scopes: string[];
  question: string;
  answer: string;
  status: StreamResult['status'] | 'streaming';
  error?: string | undefined;
  evidence: SentEvidence[];
  baseMessages: ChatMessage[];
  service: { model: string; baseUrl: string };
  requests: ReturnType<typeof aiRequestBody>[];
  activeCitation: string;
}
type PreparedRequest = Pick<AnswerRecord, 'context' | 'instanceId' | 'capturedAt' | 'scopes' | 'question' | 'evidence' | 'service'> & { body: ReturnType<typeof aiRequestBody> };
const preparedRequest = ref<PreparedRequest>();
const preparing = ref(false);
const previewOpen = ref(false);
const includeFormattedDto = ref(false);
const settings = ref({ ...defaultAiSettings });
const evidence = ref<AiEvidence[]>([]);
const question = ref('');
const questionInput = ref<InstanceType<typeof window.HTMLTextAreaElement>>();
type AiTab = 'conversation' | 'evidence' | 'settings';
const activeTab = ref<AiTab>('conversation');
const tabs: Array<{ key: AiTab; label: string }> = [
  { key: 'conversation', label: '对话分析' },
  { key: 'evidence', label: '分析范围与证据' },
  { key: 'settings', label: '模型设置' },
];
const tabList = ref<InstanceType<typeof window.HTMLDivElement>>();
const conversationScroll = ref<InstanceType<typeof window.HTMLDivElement>>();
const followLatest = ref(true);
const quickQuestions = [
  { label: '解释配置', text: '解释所选配置、依赖字段的当前值及其作用。' },
  { label: '分析字段状态', text: '分析所选字段的当前值和显示、编辑、必填状态，给出证据。' },
  { label: '分析报错与过程', text: '分析当前记录的错误及过程，给出可能原因、缺失证据和验证步骤。' },
];
const error = ref('');
const note = ref('');
const busy = ref(false);
const testing = ref(false);
const contextVersion = ref(0);
const answers = ref<AnswerRecord[]>([]);
const followupAnchor = ref<number>();
let previousOwner = '';
let previousBasis = '';
let previousEvent = '';
const eventQuestion = '分析所选报错或过程，说明相关字段、原因、缺失证据及验证方法。';
let sequence = 0;
let controller: InstanceType<typeof window.AbortController> | undefined;
let redact = createRedactor();
const groupLabels: Record<EvidenceGroup, string> = { context: '单据背景', selected: '所选字段与范围', dependencies: '关联依赖', diagnostics: '诊断', trace: '过程' };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const locked = computed(() => busy.value || preparing.value || props.refreshing || props.pickerActive);
const modelConfigured = computed(() => Boolean(settings.value.baseUrl.trim() && settings.value.model.trim() && settings.value.key.trim()));
const hasScope = computed(() => Boolean(props.scopes.length || props.eventId));
const invalidScopes = computed(() => scopeIssues(props.snapshot, props.scopes));
const selectedEvidence = computed(() => evidence.value.filter((item) => item.included));
const groups = computed(() => (Object.keys(groupLabels) as EvidenceGroup[]).map((key) => {
  const items = evidence.value.filter((item) => item.group === key);
  return { key, label: groupLabels[key], items, included: items.filter((item) => item.included).length };
}).filter((group) => group.items.length));
const sent = computed(() => sentEvidence(selectedEvidence.value, redact));
const history = computed(() => recentHistory(answers.value.filter((answer) => answer.context === contextVersion.value
  && answer.status === 'complete' && (followupAnchor.value === undefined || answer.id <= followupAnchor.value))
  .map((answer) => ({ question: String(redact(answer.question)), answer: String(redact(answer.answer)) }))));
const requestMessages = computed<ChatMessage[]>(() => [
  { role: 'system', content: AI_SYSTEM_PROMPT },
  ...history.value.messages,
  { role: 'user', content: JSON.stringify({ capturedAt: props.snapshot.capturedAt,
    scopes: props.scopes.map((scope) => scopeLabel(props.snapshot, scope)),
    question: redact(question.value), evidence: sent.value }) },
]);
const requestBody = computed(() => aiRequestBody(settings.value, requestMessages.value));
const byteCount = computed(() => bytes(requestBody.value));
const preview = computed(() => JSON.stringify(preparedRequest.value?.body ?? requestBody.value, null, 2));
const largestEvidence = computed(() => sent.value.map((item) => ({ title: item.title, size: bytes(item) })).sort((a, b) => b.size - a.size).slice(0, 3));
const valueSummary = computed(() => {
  const values = evidence.value.filter((item) => item.kind === 'value' && item.selection?.kind === 'field');
  const missing = values.filter((item) => !item.included || (item.value as { status?: string }).status !== 'present').length;
  const runtimeMissing = values.filter((item) => !item.included || (item.value as { runtimeState?: { status?: string } }).runtimeState?.status === 'unavailable').length;
  return values.length ? `当前值 ${values.length - missing}/${values.length} 项齐全 · ${runtimeMissing} 项运行态未采集或未选中` : '尚未选择字段当前值';
});

function newContext() {
  preparedRequest.value = undefined;
  contextVersion.value += 1;
  controller?.abort();
  followupAnchor.value = undefined;
  error.value = '';
  note.value = '已开启新上下文，旧回答保留供查看。';
}
function rebuildEvidence() {
  const owner = JSON.stringify([props.snapshot.instanceId, props.snapshot.meta.projectCode, props.analysisId]);
  const sameOwner = owner === previousOwner;
  const evidenceIdentity = (item: AiEvidence) => JSON.stringify([item.path, item.kind, item.selection ? scopeIdentity(item.selection) : '']);
  const prior = new Map((sameOwner ? evidence.value : []).map((item) => [evidenceIdentity(item), item]));
  // 仅更新时间戳不打断追问；快照内容、范围或证据变化才隔离历史上下文。
  const basis = JSON.stringify([owner, { ...props.snapshot, capturedAt: undefined }, props.scopes, props.eventId, props.trace?.stoppedAt, includeFormattedDto.value]);
  if (basis !== previousBasis) newContext();
  if (!sameOwner) { redact = createRedactor(); question.value = ''; }
  const eventKey = props.eventId ? `${props.trace?.id ?? ''}:${props.eventId}` : '';
  if (!eventKey && previousEvent && question.value === eventQuestion) question.value = '';
  evidence.value = buildAiEvidence(props.snapshot, props.scopes, props.evaluations, props.trace, { includeFormattedDto: includeFormattedDto.value });
  if (props.eventId && props.trace?.instanceId === props.snapshot.instanceId) {
    const event = props.trace.events.find((item) => item.id === props.eventId);
    if (event) {
      const existing = evidence.value.find((item) => item.path === `trace.events.${event.id}`);
      if (existing) { existing.value = event; existing.automatic = false; existing.title = `所选过程（完整输入输出） · ${event.method}`; }
      else evidence.value.push({ id: `E${evidence.value.length + 1}`, title: `所选过程（完整输入输出） · ${event.method}`, path: `trace.events.${event.id}`, value: event, group: 'trace', kind: 'trace', automatic: false, included: true, original: false });
    }
    if (!sameOwner || eventKey !== previousEvent) question.value = eventQuestion;
  }
  for (const item of evidence.value) {
    const previous = prior.get(evidenceIdentity(item));
    if (previous) {
      item.included = previous.included;
      item.original = previous.original && JSON.stringify(previous.value) === JSON.stringify(item.value);
    }
  }
  previousOwner = owner;
  previousBasis = basis;
  previousEvent = eventKey;
}
watch(() => props.analysisId, () => { includeFormattedDto.value = false; }, { flush: 'sync' });
watch(() => [props.snapshot, props.scopes, props.eventId, props.trace?.stoppedAt, props.analysisId, includeFormattedDto.value], rebuildEvidence, { immediate: true });
watch(() => [settings.value.baseUrl, settings.value.model], newContext);
watch(() => busy.value || preparing.value, (value) => emit('busy', value), { flush: 'sync' });
watch(() => [requestBody.value, settings.value.baseUrl, settings.value.key, props.analysisId], () => { preparedRequest.value = undefined; }, { flush: 'sync' });

function showConversation() {
  void selectTab('conversation');
}
defineExpose({ showConversation });

async function selectTab(tab: AiTab) {
  activeTab.value = tab;
  await nextTick();
  tabList.value?.querySelectorAll('button')[tabs.findIndex((item) => item.key === tab)]?.focus();
}

async function changeTabWithKeyboard(event: InstanceType<typeof window.KeyboardEvent>, index: number) {
  const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index };
  const offset = offsets[event.key];
  if (offset === undefined) return;
  event.preventDefault();
  const nextIndex = (index + offset + tabs.length) % tabs.length;
  activeTab.value = tabs[nextIndex]!.key;
  await nextTick();
  tabList.value?.querySelectorAll('button')[nextIndex]?.focus();
}

function trackConversationScroll() {
  const element = conversationScroll.value;
  if (!props.active || activeTab.value !== 'conversation' || !element?.clientHeight) return;
  followLatest.value = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
}

async function scrollToLatest() {
  await nextTick();
  const element = conversationScroll.value;
  if (props.active && activeTab.value === 'conversation' && followLatest.value && element) {
    element.scrollTop = element.scrollHeight;
  }
}

function jumpToLatest() {
  followLatest.value = true;
  void scrollToLatest();
}

// 只在读者停留于底部时跟随流式输出，切换页签后沿用原来的阅读位置。
watch(() => [answers.value.length, answers.value.find((answer) => answer.status === 'streaming')?.answer, busy.value, activeTab.value, props.active], scrollToLatest);

async function useQuickQuestion(text: string) {
  if (locked.value) return;
  question.value = text;
  showConversation();
  await nextTick();
  questionInput.value?.focus();
}

function toggleGroup(key: EvidenceGroup) {
  if (locked.value) return;
  const items = evidence.value.filter((item) => item.group === key);
  const included = !items.every((item) => item.included);
  items.forEach((item) => { item.included = included; });
  newContext();
}
function restoreEvidence() {
  evidence.value.forEach((item) => { item.included = true; item.original = false; });
  newContext();
}
async function refreshEvidence() {
  if (locked.value) return false;
  preparing.value = true;
  preparedRequest.value = undefined;
  error.value = '';
  try {
    await props.refreshSnapshot();
    await nextTick();
    note.value = '已刷新快照。请核对当前字段值与采集时间；实际数据变化后，旧回答不加入本次请求。';
    return true;
  } catch (reason) {
    error.value = `刷新失败，未发送 AI 请求：${reason instanceof Error ? reason.message : String(reason)}`;
    return false;
  } finally { preparing.value = false; }
}

async function prepareRequest() {
  if (locked.value || !hasScope.value || !question.value.trim()) return;
  if (!await refreshEvidence()) return;
  if (invalidScopes.value.length) { error.value = invalidScopes.value.join('；'); void selectTab('evidence'); return; }
  if (props.eventId && !props.trace?.events.some((event) => event.id === props.eventId && props.trace?.instanceId === props.snapshot.instanceId)) {
    error.value = '所选过程已失效，请移除或重新选择过程'; return;
  }
  if (!modelConfigured.value || !hasScope.value || !selectedEvidence.value.length) { error.value = '请配置模型并选择范围和证据'; return; }
  if (byteCount.value > REQUEST_LIMIT) { error.value = '请求超过 150 KB，请缩小范围后重新预览'; void selectTab('evidence'); return; }
  preparedRequest.value = {
    body: clone(requestBody.value), context: contextVersion.value, instanceId: props.snapshot.instanceId,
    capturedAt: props.snapshot.capturedAt, scopes: props.scopes.map((scope) => scopeLabel(props.snapshot, scope)),
    question: String(redact(question.value)), service: { model: settings.value.model, baseUrl: settings.value.baseUrl },
    evidence: clone(sent.value.map((item, index) => ({ ...item, ...(selectedEvidence.value[index]?.selection ? { selection: selectedEvidence.value[index]!.selection! } : {}) }))),
  };
  previewOpen.value = true;
  note.value = '已刷新并冻结本次请求，请查看发送预览后点击“确认发送”。修改问题、范围或设置后需重新预览。';
}

function syncPreviewOpen(event: InstanceType<typeof window.Event>) {
  if (event.currentTarget instanceof window.HTMLDetailsElement) previewOpen.value = event.currentTarget.open;
}
async function save() {
  error.value = '';
  try { await saveAiSettings(settings.value); note.value = settings.value.remember ? '设置已保存在本机扩展存储，可清除 Key。' : '设置已保存，Key 仅保留在当前浏览器会话。'; }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
}
async function test() {
  testing.value = true; error.value = '';
  try { await testAiConnection(settings.value); note.value = '连接及模型调用成功。'; }
  catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { testing.value = false; }
}
async function generate(answer: AnswerRecord, messages: ChatMessage[]) {
  const currentSettings = { ...settings.value, ...answer.service };
  const body = clone(aiRequestBody(currentSettings, messages));
  if (bytes(body) > REQUEST_LIMIT) { error.value = '请求超过 150 KB，无法继续发送。请缩小范围后开始新分析。'; return; }
  answer.requests.push(body);
  answer.status = 'streaming'; answer.error = undefined;
  controller = new window.AbortController(); busy.value = true;
  try {
    const result = await streamAnswer(currentSettings, body.messages, controller.signal, (text) => { answer.answer += text; });
    answer.status = result.status; answer.error = result.error;
  } catch (reason) {
    answer.status = 'error'; answer.error = reason instanceof Error ? reason.message : String(reason);
  } finally { busy.value = false; controller = undefined; }
}
async function send() {
  if (locked.value || !preparedRequest.value) return;
  error.value = '';
  const prepared = preparedRequest.value;
  const messages = clone(prepared.body.messages);
  answers.value.push({ id: ++sequence, context: prepared.context, instanceId: prepared.instanceId,
    capturedAt: prepared.capturedAt, scopes: prepared.scopes, question: prepared.question, answer: '', status: 'streaming', evidence: prepared.evidence,
    baseMessages: messages, service: prepared.service, requests: [], activeCitation: '' });
  preparedRequest.value = undefined;
  previewOpen.value = false;
  followupAnchor.value = undefined;
  jumpToLatest();
  await generate(answers.value[answers.value.length - 1]!, messages);
}
async function continueAnswer(answer: AnswerRecord) {
  if (locked.value || answer.context !== contextVersion.value || answer.status !== 'length') return;
  await generate(answer, [...clone(answer.baseMessages), { role: 'assistant', content: answer.answer },
    { role: 'user', content: '上一次回答因输出上限中断。请从断点继续，不重复已有内容，继续使用原证据编号；尽快完成结论和建议。' }]);
}
async function followup(answer: AnswerRecord, detailed = false) {
  followupAnchor.value = answer.id;
  question.value = detailed ? `请详细分析“${answer.question}”，展开原因、证据和验证步骤，避免重复无关配置。` : '';
  await nextTick(); questionInput.value?.focus();
}
async function copyAnswer(answer: AnswerRecord) {
  try { await window.navigator.clipboard.writeText(answer.answer); note.value = '回答已复制。'; }
  catch { error.value = '复制失败，请手动选择回答文本复制。'; }
}
function invalidCitations(answer: AnswerRecord) {
  return [...new Set([...answer.answer.matchAll(/\[(E\d+)\]/g)].map((match) => match[1]!))]
    .filter((id) => !answer.evidence.some((item) => item.id === id));
}
function selectCitation(answer: AnswerRecord, id: string) {
  answer.activeCitation = id;
}
function statusText(answer: AnswerRecord) {
  return { streaming: '生成中…', complete: '回答完成', length: '已达到输出上限，内容已保留，可继续生成', stopped: '已停止生成，内容已保留', error: '生成中断，内容已保留' }[answer.status];
}
onMounted(async () => {
  try { settings.value = await loadAiSettings(); }
  catch { error.value = '无法读取 AI 设置，请重新填写'; }
});
onBeforeUnmount(() => { controller?.abort(); emit('busy', false); });
</script>

<template>
  <section class="ai-panel">
    <header class="ai-header">
      <div class="ai-heading">
        <div>
          <h2>AI 分析</h2>
          <p class="muted">
            结合字段、配置与过程证据，定位单据问题。
          </p>
        </div>
        <span v-if="busy || preparing" class="ai-live-status" role="status">{{ preparing ? '正在刷新证据…' : '正在生成回答…' }}</span>
      </div>
      <div ref="tabList" class="ai-tabs" role="tablist" aria-label="AI 分析功能">
        <button
          v-for="(tab, index) in tabs"
          :id="`ai-tab-${tab.key}`"
          :key="tab.key"
          role="tab"
          :aria-selected="activeTab === tab.key"
          :aria-controls="`ai-view-${tab.key}`"
          :tabindex="activeTab === tab.key ? 0 : -1"
          :class="{ active: activeTab === tab.key }"
          @click="activeTab = tab.key"
          @keydown="changeTabWithKeyboard($event, index)"
        >
          {{ tab.label }}
        </button>
      </div>
    </header>

    <div class="ai-snapshot-bar">
      <span>快照采集于 <strong>{{ snapshot.capturedAt }}</strong></span>
      <button :disabled="locked" @click="refreshEvidence">
        {{ preparing ? '刷新中…' : '刷新并核对证据' }}
      </button>
    </div>

    <div v-if="note || error" class="ai-notices">
      <p v-if="note" class="muted" role="status">
        {{ note }}
      </p>
      <p v-if="error" class="error-banner" role="alert">
        {{ error }}
      </p>
    </div>

    <div v-show="activeTab === 'conversation'" id="ai-view-conversation" class="ai-conversation" role="tabpanel" aria-labelledby="ai-tab-conversation" tabindex="0">
      <div class="ai-context-bar">
        <button class="ai-context-model" @click="selectTab('settings')">
          <span>模型</span><strong>{{ settings.model || '待配置' }}</strong>
          <small v-if="!modelConfigured">未配置完成</small>
        </button>
        <button @click="selectTab('evidence')">
          <span>分析范围</span><strong>{{ scopes.length }} 项{{ eventId ? ' · 已选过程' : '' }}</strong>
        </button>
        <button @click="selectTab('evidence')">
          <span>发送证据</span><strong>{{ selectedEvidence.length }} 项</strong>
          <small>{{ (byteCount / 1000).toFixed(1) }} / 150 KB</small>
        </button>
      </div>

      <div ref="conversationScroll" class="ai-conversation-scroll" @scroll="trackConversationScroll">
        <div v-if="!answers.length" class="ai-welcome">
          <span class="ai-welcome-mark" aria-hidden="true">AI</span>
          <h3>从一个具体问题开始</h3>
          <p class="muted">
            选择需要排查的字段或区域，描述现象或粘贴报错。<br>回答将结合所选证据，给出原因与验证建议。
          </p>
          <div class="ai-starters">
            <button v-for="item in quickQuestions" :key="item.label" :disabled="locked" @click="useQuickQuestion(item.text)">
              {{ item.label }}<span aria-hidden="true">↗</span>
            </button>
          </div>
          <div class="tool-actions ai-welcome-actions">
            <button v-if="!hasScope" class="ai-primary" @click="selectTab('evidence')">
              选择分析范围
            </button>
            <button v-if="!modelConfigured" @click="selectTab('settings')">
              配置模型
            </button>
          </div>
        </div>
        <article v-for="answer in answers" :key="answer.id" class="ai-answer">
          <div class="ai-question">
            <span class="ai-message-label">你</span>
            <p>{{ answer.question }}</p>
          </div>
          <div class="ai-response">
            <span class="ai-message-label">AI 分析</span>
            <p class="muted">
              {{ answer.scopes.join('；') }} · {{ answer.capturedAt }} · {{ answer.service.model }}
            </p>
            <p class="muted">
              {{ statusText(answer) }}{{ answer.context !== contextVersion ? ' · 来自先前上下文' : '' }}
            </p>
            <p v-if="answer.error" class="error-banner">
              {{ answer.error }}
            </p>
            <AiMarkdown :text="answer.answer" @cite="selectCitation(answer, $event)" />
            <p v-if="invalidCitations(answer).length" class="warnings">
              以下引用不存在于本次发送证据中：{{ invalidCitations(answer).join('、') }}。相关结论需要核对。
            </p>
            <div class="tool-actions">
              <button v-if="answer.status === 'length'" :disabled="locked || answer.context !== contextVersion" @click="continueAnswer(answer)">
                继续生成
              </button>
              <button :disabled="locked || answer.context !== contextVersion || answer.status !== 'complete'" @click="followup(answer)">
                继续追问
              </button>
              <button :disabled="locked || answer.context !== contextVersion || answer.status !== 'complete'" @click="followup(answer, true)">
                详细分析
              </button>
              <button :disabled="!answer.answer" @click="copyAnswer(answer)">
                复制回答
              </button>
            </div>
            <div v-if="answer.activeCitation" class="ai-citation-detail">
              <template v-for="citation in answer.evidence.filter((item) => item.id === answer.activeCitation)" :key="citation.id">
                <strong>[{{ citation.id }}] {{ citation.title }}</strong>
                <button v-if="citation.selection" :disabled="busy || pickerActive || answer.instanceId !== snapshot.instanceId" @click="emit('locate', citation.selection)">
                  定位字段或区域
                </button>
                <p class="muted">
                  {{ citation.path }} · 本次实际发送内容
                </p>
                <pre>{{ JSON.stringify(citation.value, null, 2) }}</pre>
              </template>
              <p v-if="!answer.evidence.some((item) => item.id === answer.activeCitation)" class="warnings">
                该引用未包含在本次发送证据中。
              </p>
            </div>
            <details><summary>查看本次请求与证据</summary><pre class="ai-preview">{{ JSON.stringify(answer.requests, null, 2) }}</pre></details>
          </div>
        </article>
      </div>

      <div class="ai-composer">
        <button v-if="answers.length && !followLatest" class="ai-jump-latest" @click="jumpToLatest">
          回到最新回答 ↓
        </button>
        <div v-if="answers.length" class="tool-actions ai-quick-questions">
          <button v-for="item in quickQuestions" :key="item.label" :disabled="locked" @click="useQuickQuestion(item.text)">
            {{ item.label }}
          </button>
        </div>
        <p v-if="followupAnchor" class="muted">
          正在追问第 {{ followupAnchor }} 次分析。
        </p>
        <div v-if="pickerActive" class="ai-composer-hint">
          <span>正在从页面选择分析范围</span>
          <button @click="emit('finishPicker')">
            完成选择
          </button>
        </div>
        <div v-if="!modelConfigured || !hasScope || !selectedEvidence.length || byteCount > REQUEST_LIMIT" class="ai-composer-hint">
          <button v-if="!modelConfigured" @click="selectTab('settings')">
            请先配置模型
          </button>
          <button v-if="!hasScope || !selectedEvidence.length" @click="selectTab('evidence')">
            请选择分析范围与证据
          </button>
          <button v-if="byteCount > REQUEST_LIMIT" class="ai-over-limit" @click="selectTab('evidence')">
            请求超过 150 KB，调整证据
          </button>
        </div>
        <label class="ai-input-label" for="ai-question">描述问题</label>
        <textarea id="ai-question" ref="questionInput" v-model="question" :disabled="locked" rows="3" placeholder="描述问题或粘贴报错；可继续追问，或请 AI 展开分析。" />
        <div class="ai-composer-footer">
          <details class="ai-request-preview" :open="previewOpen" @toggle="syncPreviewOpen">
            <summary>{{ preparedRequest ? '待确认的发送预览' : '当前证据预览' }} · {{ (byteCount / 1000).toFixed(1) }} KB</summary>
            <div class="ai-preview-popover">
              <strong>{{ preparedRequest ? '本次请求已冻结，确认后发送以下内容' : '发送前将刷新快照并重新生成预览' }}</strong>
              <p class="muted">
                {{ settings.baseUrl }} · {{ snapshot.capturedAt }}
              </p>
              <p class="muted">
                默认脱敏，凭据始终移除。请确认本次发送内容。
              </p>
              <p v-if="history.omitted" class="muted">
                本次省略 {{ history.omitted }} 轮较早回答；最多携带最近两轮，历史预算 16 KB。
              </p>
              <pre class="ai-preview">{{ preview }}</pre>
            </div>
          </details>
          <div class="tool-actions">
            <button :disabled="locked" @click="emit('newAnalysis')">
              新建分析
            </button>
            <button v-if="busy" class="ai-stop" @click="controller?.abort()">
              停止生成
            </button>
            <button v-else-if="preparedRequest" class="ai-primary" :disabled="locked" @click="send">
              确认发送
            </button>
            <button v-else class="ai-primary" :disabled="locked || !modelConfigured || !hasScope || !question.trim()" @click="prepareRequest">
              {{ preparing ? '刷新中…' : '刷新并预览' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-show="activeTab === 'evidence'" id="ai-view-evidence" class="ai-tab-page" role="tabpanel" aria-labelledby="ai-tab-evidence" tabindex="0">
      <div class="ai-page-intro">
        <h3>确定本次分析的范围与证据</h3>
        <p class="muted">
          只选择与问题相关的内容，可减少无关信息并节省请求空间。
        </p>
      </div>
      <div v-if="invalidScopes.length" class="warnings" role="alert">
        <p v-for="issue in invalidScopes" :key="issue">
          {{ issue }}
        </p>
      </div>
      <div class="ai-send-summary">
        <strong>{{ selectedEvidence.length }} 项证据 · {{ (byteCount / 1000).toFixed(1) }} KB / 150 KB</strong>
        <p>{{ valueSummary }}</p>
        <p class="muted">
          自动补充 {{ selectedEvidence.filter((item) => item.automatic).length }} 项直接关联证据。默认脱敏，凭据始终移除。
        </p>
        <p v-if="history.omitted" class="muted">
          本次省略 {{ history.omitted }} 轮较早回答；最多携带最近两轮，历史预算 16 KB。
        </p>
        <div class="tool-actions">
          <button v-for="group in groups" :key="group.key" :disabled="locked" :aria-pressed="group.included === group.items.length" @click="toggleGroup(group.key)">
            {{ group.label }} {{ group.included }}/{{ group.items.length }}
          </button>
          <button :disabled="locked" @click="restoreEvidence">
            恢复推荐选择
          </button>
        </div>
        <div v-if="byteCount > REQUEST_LIMIT" class="warnings">
          请求超过上限，请缩小范围。占用最多的证据：
          <p v-for="item in largestEvidence" :key="item.title">
            {{ item.title }} · {{ (item.size / 1000).toFixed(1) }} KB
          </p>
        </div>
      </div>
      <section class="ai-card">
        <h3>分析范围</h3>
        <div class="tool-actions">
          <button :disabled="locked" @click="emit('pick', 'field')">
            从页面选字段
          </button>
          <button :disabled="locked || !areaPicker" @click="emit('pick', 'area')">
            从页面选区域
          </button>
          <button v-if="pickerActive" @click="emit('finishPicker')">
            完成选择
          </button>
          <button :disabled="locked || !scopes.length" @click="emit('scopes', [])">
            清空范围
          </button>
        </div>
        <p v-if="pickerActive" class="picker-tip">
          {{ continuousPicker ? '在页面连续点击添加，点击“完成选择”或按 Esc 结束。' : '当前 Adapter 支持单次选择，点击字段后返回。' }}
        </p>
        <p v-else-if="!continuousPicker" class="muted">
          当前 Adapter 使用单次选择；升级后支持连续点选。隐藏字段可通过下方搜索列表加入。
        </p>
        <p v-if="!hasScope" class="muted">
          尚未选择范围，可从页面点选或手动加入。
        </p>
        <div v-if="eventId" class="tool-actions">
          <span class="muted">已包含所选过程：{{ eventId }}</span>
          <button :disabled="locked" @click="emit('clearEvent')">
            移除过程
          </button>
        </div>
        <div class="scope-list">
          <span v-for="scope in scopes" :key="scopeIdentity(scope)" class="scope-chip" :title="scope.kind === 'bill' ? '整个单据' : scope.kind === 'field' ? `${scope.areaCode}.${scope.fieldCode}` : scope.areaCode">
            {{ scopeLabel(snapshot, scope) }}
            <button :disabled="locked" :aria-label="`移除 ${scopeLabel(snapshot, scope)}`" @click="emit('scopes', scopes.filter((item) => scopeIdentity(item) !== scopeIdentity(scope)))">×</button>
          </span>
        </div>
        <AiScopeSelector :key="`${snapshot.instanceId}:${analysisId}`" :snapshot="snapshot" :scopes="scopes" :disabled="locked" @change="emit('scopes', $event)" />
        <div class="tool-actions">
          <button :disabled="locked" @click="emit('scopes', [{ kind: 'bill' }])">
            选择整个单据
          </button>
        </div>
      </section>
      <section class="ai-card">
        <label class="ai-dto-option"><input v-model="includeFormattedDto" :disabled="locked" type="checkbox">包含格式化 DTO（用于提交数据分析，可能显著增加请求大小）</label>
        <details>
          <summary>高级证据设置 · 逐项调整和脱敏</summary>
          <details v-for="group in groups" :key="group.key">
            <summary>{{ group.label }} · {{ group.included }}/{{ group.items.length }}</summary>
            <div v-for="item in group.items" :key="item.id" class="evidence-row">
              <label><input v-model="item.included" :disabled="locked" type="checkbox" @change="newContext">[{{ item.id }}] {{ item.title }}</label>
              <label><input v-model="item.original" :disabled="locked" type="checkbox" @change="newContext">保留原值</label>
            </div>
          </details>
        </details>
      </section>
      <div class="ai-page-footer">
        <span class="muted">调整范围或证据将开启新上下文，已有回答保留。</span>
        <button class="ai-primary" @click="showConversation">
          返回对话
        </button>
      </div>
    </div>

    <div v-show="activeTab === 'settings'" id="ai-view-settings" class="ai-tab-page" role="tabpanel" aria-labelledby="ai-tab-settings" tabindex="0">
      <div class="ai-page-intro">
        <h3>连接你的模型服务</h3>
        <p class="muted">
          支持兼容 OpenAI Chat Completions 的接口。测试连接仅发送简短测试问题。
        </p>
      </div>
      <section class="ai-card ai-model-card">
        <div class="ai-settings">
          <label>Base URL<input v-model="settings.baseUrl" :disabled="busy" placeholder="https://api.deepseek.com"></label>
          <label>模型<input v-model="settings.model" :disabled="busy" list="ai-models"></label>
          <datalist id="ai-models">
            <option value="deepseek-v4-flash" /><option value="deepseek-v4-pro" />
          </datalist>
          <label>API Key<input v-model="settings.key" :disabled="busy" type="password" autocomplete="off"></label>
          <label><input v-model="settings.remember" :disabled="busy" type="checkbox">记住本机 Key（扩展存储不提供加密保险库）</label>
          <details>
            <summary>高级设置</summary>
            <label>回答输出上限<input v-model.number="settings.maxTokens" :disabled="busy" type="number" min="128" max="65536" step="128"></label>
            <p class="muted">
              默认 4096；实际支持范围取决于模型。达到上限后可手动继续生成。
            </p>
          </details>
          <div class="tool-actions">
            <button :disabled="busy || testing" @click="save">
              保存设置
            </button>
            <button :disabled="testing || busy" @click="test">
              {{ testing ? '连接中…' : '测试模型（发送简短测试请求）' }}
            </button>
            <button :disabled="busy || testing" @click="settings.key = ''; save()">
              清除 Key
            </button>
          </div>
        </div>
      </section>
      <div class="ai-page-footer">
        <span class="muted">切换模型或服务地址将开启新上下文。</span>
        <button class="ai-primary" @click="showConversation">
          返回对话
        </button>
      </div>
    </div>
  </section>
</template>
