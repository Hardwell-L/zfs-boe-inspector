<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { BoeInspectionSnapshot, InspectionSelection, RuleEvaluation, TraceSession } from '@zfs-boe-inspector/shared-types';
import { AI_SYSTEM_PROMPT, buildAiEvidence, createRedactor, scopeIdentity, scopeLabel, type AiEvidence, type EvidenceGroup } from './aiContext';
import { aiRequestBody, defaultAiSettings, loadAiSettings, saveAiSettings, streamAnswer, testAiConnection, type ChatMessage, type StreamResult } from './aiClient';
import { bytes, recentHistory, REQUEST_LIMIT, sentEvidence } from './aiConversation';
import AiMarkdown from './AiMarkdown';

const props = defineProps<{
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
const settings = ref({ ...defaultAiSettings });
const evidence = ref<AiEvidence[]>([]);
const question = ref('');
const questionInput = ref<InstanceType<typeof window.HTMLTextAreaElement>>();
const error = ref('');
const note = ref('');
const busy = ref(false);
const testing = ref(false);
const contextVersion = ref(0);
const answers = ref<AnswerRecord[]>([]);
const followupAnchor = ref<number>();
const areaCode = ref('');
const fieldCode = ref('');
const rowText = ref('');
let sequence = 0;
let controller: InstanceType<typeof window.AbortController> | undefined;
let redact = createRedactor();
const groupLabels: Record<EvidenceGroup, string> = { selected: '所选字段与范围', dependencies: '关联依赖', diagnostics: '诊断', trace: '过程' };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const locked = computed(() => busy.value || props.pickerActive);
const areas = computed(() => props.snapshot.config.template.flatMap((area) => area && typeof area === 'object' && !Array.isArray(area) ? [area as Record<string, any>] : []));
const fields = computed(() => {
  const value = areas.value.find((area) => area.areaCode === areaCode.value)?.areaFields;
  return Array.isArray(value) ? value : [];
});
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
const preview = computed(() => JSON.stringify(requestBody.value, null, 2));
const largestEvidence = computed(() => sent.value.map((item) => ({ title: item.title, size: bytes(item) })).sort((a, b) => b.size - a.size).slice(0, 3));
const valueSummary = computed(() => {
  const values = evidence.value.filter((item) => item.kind === 'value' && item.selection?.kind === 'field');
  const missing = values.filter((item) => !item.included || (item.value as { status?: string }).status !== 'present').length;
  const runtimeMissing = values.filter((item) => !item.included || (item.value as { runtimeState?: { status?: string } }).runtimeState?.status === 'unavailable').length;
  return values.length ? `当前值 ${values.length - missing}/${values.length} 项齐全 · ${runtimeMissing} 项运行态未采集或未选中` : '尚未选择字段当前值';
});

function newContext() {
  contextVersion.value += 1;
  controller?.abort();
  followupAnchor.value = undefined;
  error.value = '';
  note.value = '已开启新上下文，旧回答保留供查看。';
}
function rebuildEvidence() {
  newContext();
  redact = createRedactor();
  evidence.value = buildAiEvidence(props.snapshot, props.scopes, props.evaluations, props.trace);
  if (props.eventId && props.trace?.instanceId === props.snapshot.instanceId) {
    const event = props.trace.events.find((item) => item.id === props.eventId);
    if (event) {
      const existing = evidence.value.find((item) => item.path === `trace.events.${event.id}`);
      if (existing) { existing.value = event; existing.automatic = false; existing.title = `所选过程（完整输入输出） · ${event.method}`; }
      else evidence.value.push({ id: `E${evidence.value.length + 1}`, title: `所选过程（完整输入输出） · ${event.method}`, path: `trace.events.${event.id}`, value: event, group: 'trace', kind: 'trace', automatic: false, included: true, original: false });
    }
    question.value = '分析所选报错或过程，说明相关字段、原因、缺失证据及验证方法。';
  }
}
watch(() => [props.snapshot, props.scopes, props.eventId, props.trace?.stoppedAt], rebuildEvidence, { immediate: true });
watch(() => [settings.value.baseUrl, settings.value.model], newContext);
watch(busy, (value) => emit('busy', value), { flush: 'sync' });
watch(areaCode, () => { fieldCode.value = ''; });

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
function addScope() {
  if (locked.value) return;
  error.value = '';
  if (!areaCode.value) { error.value = '请选择区域'; return; }
  const values = rowText.value.trim() ? rowText.value.split(/[,，]/).map((text) => Number(text.trim())) : [];
  if (values.some((value) => !Number.isInteger(value) || value < 1)) { error.value = '行号需为从 1 开始的整数，多个行号用逗号分隔'; return; }
  const additions: InspectionSelection[] = fieldCode.value
    ? (values.length ? values : [1]).map((row) => ({ kind: 'field', areaCode: areaCode.value, fieldCode: fieldCode.value, rowIndex: row - 1 }))
    : [{ kind: 'area', areaCode: areaCode.value, ...(values.length ? { rowIndexes: values.map((row) => row - 1) } : {}) }];
  emit('scopes', [...props.scopes, ...additions].filter((item, index, list) => list.findIndex((candidate) => scopeIdentity(candidate) === scopeIdentity(item)) === index));
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
  if (locked.value) return;
  error.value = '';
  if (!question.value.trim() || !selectedEvidence.value.length || (!props.scopes.length && !props.eventId)) { error.value = '请填写问题并选择分析范围和发送证据'; return; }
  if (byteCount.value > REQUEST_LIMIT) { error.value = '发送内容超过 150 KB，请缩小范围或取消不必要的证据'; return; }
  const messages = clone(requestMessages.value);
  const frozenEvidence = clone(sent.value.map((item, index) => ({ ...item, ...(selectedEvidence.value[index]?.selection ? { selection: selectedEvidence.value[index]!.selection! } : {}) })));
  answers.value.push({ id: ++sequence, context: contextVersion.value, instanceId: props.snapshot.instanceId,
    capturedAt: props.snapshot.capturedAt, scopes: props.scopes.map((scope) => scopeLabel(props.snapshot, scope)),
    question: String(redact(question.value)), answer: '', status: 'streaming', evidence: frozenEvidence,
    baseMessages: messages, service: { model: settings.value.model, baseUrl: settings.value.baseUrl }, requests: [], activeCitation: '' });
  followupAnchor.value = undefined;
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
  <section class="section ai-panel">
    <h2>AI 分析</h2>
    <p class="muted">
      选择字段或区域，结合当前数据和已记录过程排查问题。
    </p>
    <details>
      <summary>模型设置 · {{ settings.model }}</summary>
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
    </details>
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
      当前 Adapter 使用单次选择；升级后支持连续点选。隐藏字段可通过“手动选择”加入。
    </p>
    <div class="scope-list">
      <span v-for="scope in scopes" :key="scopeIdentity(scope)" class="scope-chip" :title="scope.kind === 'bill' ? '整个单据' : scope.kind === 'field' ? `${scope.areaCode}.${scope.fieldCode}` : scope.areaCode">
        {{ scopeLabel(snapshot, scope) }}
        <button :disabled="locked" :aria-label="`移除 ${scopeLabel(snapshot, scope)}`" @click="emit('scopes', scopes.filter((item) => scopeIdentity(item) !== scopeIdentity(scope)))">×</button>
      </span>
    </div>
    <details>
      <summary>手动选择 · 隐藏字段、区域或指定行</summary>
      <div class="tool-actions">
        <select v-model="areaCode" :disabled="locked">
          <option value="">
            选择区域
          </option><option v-for="area in areas" :key="area.areaCode" :value="area.areaCode">
            {{ area.areaName || area.areaCode }}
          </option>
        </select>
        <select v-model="fieldCode" :disabled="locked">
          <option value="">
            整个区域
          </option><option v-for="field in fields" :key="field.fieldCode || field.code" :value="field.fieldCode || field.code">
            {{ field.fieldName || field.fieldCode || field.code }}
          </option>
        </select>
        <input v-model="rowText" :disabled="locked" placeholder="行号，逗号分隔；区域留空为全部">
        <button :disabled="locked" @click="addScope">
          加入范围
        </button>
        <button :disabled="locked" @click="emit('scopes', [{ kind: 'bill' }])">
          选择整个单据
        </button>
      </div>
    </details>
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
    <div class="tool-actions">
      <button :disabled="locked" @click="question = '解释所选配置、依赖字段的当前值及其作用。'">
        解释配置
      </button>
      <button :disabled="locked" @click="question = '分析所选字段的当前值和显示、编辑、必填状态，给出证据。'">
        分析字段状态
      </button>
      <button :disabled="locked" @click="question = '分析当前记录的错误及过程，给出可能原因、缺失证据和验证步骤。'">
        分析报错与过程
      </button>
    </div>
    <p v-if="followupAnchor" class="muted">
      正在追问第 {{ followupAnchor }} 次分析。
    </p>
    <textarea ref="questionInput" v-model="question" :disabled="locked" rows="3" placeholder="描述问题或粘贴报错；默认先给简短结论，可继续追问。" />
    <details>
      <summary>完整发送预览 · {{ settings.baseUrl }} · {{ snapshot.capturedAt }}</summary>
      <pre class="ai-preview">{{ preview }}</pre>
    </details>
    <div class="tool-actions">
      <button :disabled="locked || byteCount > REQUEST_LIMIT || !selectedEvidence.length || !question.trim()" @click="send">
        发送给 {{ settings.model }}
      </button>
      <button v-if="busy" @click="controller?.abort()">
        停止生成
      </button>
      <button :disabled="locked" @click="newContext">
        新对话
      </button>
    </div>
    <p v-if="note" class="muted">
      {{ note }}
    </p>
    <p v-if="error" class="error-banner">
      {{ error }}
    </p>
    <article v-for="answer in answers" :key="answer.id" class="ai-answer">
      <h3>{{ answer.question }}</h3>
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
    </article>
  </section>
</template>
