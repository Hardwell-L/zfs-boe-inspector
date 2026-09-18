<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import type { InspectionSelection } from '@zfs-boe-inspector/shared-types';
import { scopeIdentity, scopeLabel, type EvidenceGroup } from './aiContext';
import { bytes } from './aiConversation';
import { scopeIssues } from './aiScopes';
import { formatLocalDateTime } from './time';
import type { AiAnswer, AiWorkspace } from './useAiWorkspace';
import AiMarkdown from './AiMarkdown';
import AiScopeSelector from './AiScopeSelector.vue';
import AiEvidenceView from './AiEvidenceView.vue';
import DismissibleNotice from './DismissibleNotice.vue';
import AiHistoryView from './AiHistoryView.vue';

const props = defineProps<{ workspace: AiWorkspace; active: boolean; refreshing: boolean; pickerActive: boolean; continuousPicker: boolean; areaPicker: boolean }>();
const emit = defineEmits<{ pick: [mode: 'field' | 'area']; finishPicker: []; locate: [selection: InspectionSelection] }>();
const workspace = props.workspace;
const state = workspace.state;
const session = computed(() => workspace.current);
const snapshot = computed(() => session.value?.source.snapshot);
const locked = computed(() => workspace.busy || props.refreshing || props.pickerActive || !session.value || !workspace.available(session.value));
const ownRequest = computed(() => state.request?.sessionId === session.value?.id ? state.request : undefined);
const draftLocked = computed(() => Boolean(ownRequest.value) || props.pickerActive || !session.value || !workspace.available(session.value));
const preview = computed(() => session.value ? workspace.requestView(session.value) : undefined);
const byteCount = computed(() => preview.value ? bytes(preview.value.body) : 0);
const invalidScopes = computed(() => session.value ? scopeIssues(session.value.source.snapshot, session.value.scopes) : []);
const selectedScopes = computed(() => {
  const owner = session.value;
  const sourceSnapshot = snapshot.value;
  if (!owner || !sourceSnapshot) return [];
  return owner.scopes.map((scope) => ({ scope, key: scopeIdentity(scope), label: scopeLabel(sourceSnapshot, scope) }));
});
const valueSummary = computed(() => {
  const values = session.value?.evidence.filter((item) => item.kind === 'value' && item.selection?.kind === 'field') ?? [];
  const present = values.filter((item) => item.included && (item.value as { status?: string }).status === 'present').length;
  const missingRuntime = values.filter((item) => !item.included || (item.value as { runtimeState?: { status?: string } }).runtimeState?.status === 'unavailable').length;
  return values.length ? `当前值 ${present}/${values.length} 项齐全 · ${missingRuntime} 项运行态未采集或未选中` : '尚未选择字段当前值';
});
const largestEvidence = computed(() => (preview.value?.evidence ?? []).map((item) => ({ id: item.id, title: item.title, size: bytes(item.value) })).sort((a, b) => b.size - a.size).slice(0, 3));
const hasScope = computed(() => Boolean(session.value?.scopes.length || session.value?.eventId));
const groupLabels: Record<EvidenceGroup, string> = { context: '单据背景', selected: '所选字段与范围', dependencies: '关联依赖', diagnostics: '诊断', trace: '过程' };
const groups = computed(() => (Object.keys(groupLabels) as EvidenceGroup[]).map((key) => {
  const items = session.value?.evidence.filter((item) => item.group === key) ?? [];
  return { key, label: groupLabels[key], items, included: items.filter((item) => item.included).length };
}).filter((group) => group.items.length));
const questionInput = ref<InstanceType<typeof window.HTMLTextAreaElement>>();
const conversationScroll = ref<InstanceType<typeof window.HTMLDivElement>>();
const tabList = ref<InstanceType<typeof window.HTMLDivElement>>();
const drawer = ref<InstanceType<typeof window.HTMLElement>>();
const drawerOpen = ref(false);
const viewedAnswer = ref<AiAnswer>();
const citationId = ref('');
let drawerTrigger: InstanceType<typeof window.HTMLElement> | null = null;
let restoringScroll = false;
const quickQuestions = ['解释所选配置、依赖字段的当前值及其作用。', '分析所选字段的显示、编辑、必填状态，给出证据。', '分析当前报错与过程，给出可能原因、缺失证据和验证步骤。'];
const drawerEvidence = computed(() => {
  const items = viewedAnswer.value?.evidence ?? preview.value?.evidence ?? [];
  return citationId.value ? items.filter((item) => item.id === citationId.value) : items;
});
const renamingId = ref(0);
const renameDraft = ref('');
const renameInput = ref<InstanceType<typeof window.HTMLInputElement>[]>();
async function startRename(id: number) {
  const item = state.sessions.find((entry) => entry.id === id);
  if (!item || state.pickerSessionId) return;
  renamingId.value = id; renameDraft.value = item.title;
  await nextTick(); renameInput.value?.[0]?.focus(); renameInput.value?.[0]?.select();
}
function finishRename() {
  workspace.rename(renamingId.value, renameDraft.value); renamingId.value = 0;
}
function renameKeydown(event: InstanceType<typeof window.KeyboardEvent>) {
  if (event.isComposing) return;
  if (event.key === 'Enter') { event.preventDefault(); finishRename(); }
  if (event.key === 'Escape') { event.preventDefault(); renamingId.value = 0; }
}
const modelPreset = computed({
  get: () => ['deepseek-v4-flash', 'deepseek-v4-pro'].includes(state.settings.model) ? state.settings.model : 'custom',
  set: (value: string) => { if (value !== 'custom') state.settings.model = value; else state.settings.model = ''; },
});
const requestLimitKb = computed({
  get: () => Math.round(state.settings.maxRequestBytes / 1000),
  set: (value: number) => { state.settings.maxRequestBytes = Math.round(value * 1000); },
});
function setScopes(scopes: InspectionSelection[]) { if (session.value) workspace.setScopes(session.value, scopes); }
function toggleGroup(key: EvidenceGroup) {
  if (locked.value || !session.value) return;
  const items = session.value.evidence.filter((item) => item.group === key);
  const included = !items.every((item) => item.included);
  items.forEach((item) => { item.included = included; }); workspace.changeEvidence(session.value);
}
function restoreEvidence() {
  if (locked.value || !session.value) return;
  session.value.evidence.forEach((item) => { item.included = true; item.original = false; }); workspace.changeEvidence(session.value);
}
function trackScroll() {
  if (restoringScroll || !session.value || !conversationScroll.value || state.tab !== 'conversation') return;
  const element = conversationScroll.value;
  session.value.scrollTop = element.scrollTop;
  session.value.followLatest = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
}
async function jumpLatest() {
  if (!session.value) return;
  session.value.followLatest = true;
  await nextTick();
  if (conversationScroll.value) conversationScroll.value.scrollTop = conversationScroll.value.scrollHeight;
}
watch(() => [state.activeId, state.tab, props.active], async () => {
  drawerOpen.value = false; viewedAnswer.value = undefined;
  restoringScroll = true;
  await nextTick();
  if (conversationScroll.value && session.value && props.active && state.tab === 'conversation') conversationScroll.value.scrollTop = session.value.scrollTop;
  restoringScroll = false;
});
watch(() => [session.value?.answers.length, session.value?.answers.at(-1)?.answer], async () => {
  if (props.active && state.tab === 'conversation' && session.value?.followLatest) await jumpLatest();
});
async function openPreview(answer?: AiAnswer, citation = '') {
  drawerTrigger = document.activeElement instanceof window.HTMLElement ? document.activeElement : null;
  viewedAnswer.value = answer; citationId.value = citation; drawerOpen.value = true;
  await nextTick(); drawer.value?.focus();
}
function closePreview() { drawerOpen.value = false; drawerTrigger?.focus(); }
function drawerKeydown(event: InstanceType<typeof window.KeyboardEvent>) {
  if (event.key === 'Escape') { event.preventDefault(); closePreview(); return; }
  if (event.key !== 'Tab') return;
  const items = Array.from(drawer.value?.querySelectorAll<InstanceType<typeof window.HTMLElement>>('button:not(:disabled), summary, [tabindex="0"]') ?? [])
    .filter((element) => element.getClientRects().length);
  const first = items[0]; const last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer.value)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
function send() { if (session.value && !locked.value) { drawerOpen.value = false; void workspace.send(session.value); } }
function questionKeydown(event: InstanceType<typeof window.KeyboardEvent>) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); send(); }
}
async function tabKeydown(event: InstanceType<typeof window.KeyboardEvent>, index: number) {
  if (event.key === 'F2') { event.preventDefault(); await startRename(state.sessions[index]!.id); return; }
  const offsets: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: state.sessions.length - 1 - index };
  if (offsets[event.key] === undefined || state.pickerSessionId) return;
  event.preventDefault();
  const next = (index + offsets[event.key]! + state.sessions.length) % state.sessions.length;
  workspace.select(state.sessions[next]!.id);
  await nextTick(); tabList.value?.querySelectorAll<InstanceType<typeof window.HTMLElement>>('[role="tab"]')[next]?.focus();
}
async function copyAnswer(answer: AiAnswer) {
  const owner = session.value;
  if (!owner) return;
  owner.note = '';
  try { await window.navigator.clipboard.writeText(answer.answer); owner.note = '回答已复制'; }
  catch { owner.error = '复制失败，请手动选择回答文本'; }
}
function invalidCitations(answer: AiAnswer) {
  return [...new Set([...answer.answer.matchAll(/\[(E\d+)\]/g)].map((match) => match[1]!))].filter((id) => !answer.evidence.some((item) => item.id === id));
}
function statusText(answer: AiAnswer) {
  return { streaming: '生成中…', complete: '', length: '已达到输出上限，可继续生成', stopped: '已停止，内容已保留', error: '生成失败，内容已保留' }[answer.status];
}
</script>

<template>
  <section class="ai-panel">
    <header class="ai-header">
      <div class="ai-heading">
        <h2>AI 分析</h2>
        <div class="ai-heading-summary">
          <button @click="state.tab = 'settings'">
            模型 {{ state.settings.model || '待配置' }}
          </button>
          <button @click="state.tab = 'evidence'">
            范围 {{ session?.scopes.length || 0 }} 项
          </button>
          <span class="ai-captured-time">采集 {{ formatLocalDateTime(snapshot?.capturedAt) }}</span>
        </div>
      </div>
      <div class="ai-navigation">
        <div ref="tabList" class="ai-session-tabs" role="tablist" aria-label="分析会话">
          <div v-for="(item, index) in state.sessions" :key="item.id" class="ai-session-tab" :class="{ active: state.activeId === item.id && state.tab === 'conversation' }">
            <button :id="`ai-session-${item.id}`" role="tab" :aria-selected="state.activeId === item.id && state.tab === 'conversation'" aria-controls="ai-conversation" :tabindex="state.activeId === item.id ? 0 : -1" :title="`${item.title}（双击或 F2 重命名）`" :disabled="pickerActive" @click="workspace.select(item.id)" @dblclick="startRename(item.id)" @keydown="tabKeydown($event, index)">
              {{ item.title }}<small v-if="state.request?.sessionId === item.id"> · 生成中</small>
            </button>
            <input v-if="renamingId === item.id" ref="renameInput" v-model="renameDraft" class="ai-rename-input" aria-label="会话名称" maxlength="60" @keydown="renameKeydown" @blur="finishRename">
            <button v-else :disabled="pickerActive" :aria-label="`重命名 ${item.title}`" title="重命名会话" @click="startRename(item.id)">
              ✎
            </button>
            <button :disabled="pickerActive || (workspace.busy && !state.request)" :aria-label="`关闭 ${item.title}`" @click="workspace.close(item.id)">
              ×
            </button>
          </div>
          <button class="ai-new-session" :disabled="workspace.busy || refreshing || pickerActive || !state.source" aria-label="新会话" title="新会话" @click="workspace.create()">
            ＋
          </button>
        </div>
        <div class="ai-function-tabs">
          <button :class="{ active: state.tab === 'history' }" @click="state.tab = 'history'">
            问答历史
          </button>
          <button :class="{ active: state.tab === 'evidence' }" @click="state.tab = 'evidence'">
            <span class="ai-wide-label">分析</span>范围与证据
          </button>
          <button :class="{ active: state.tab === 'settings' }" @click="state.tab = 'settings'">
            模型<span class="ai-wide-label">设置</span>
          </button>
        </div>
      </div>
    </header>
    <DismissibleNotice v-if="state.closed" :notice-key="state.closed.session.id" class="ai-undo" @close="state.closed = undefined">
      已关闭“{{ state.closed.session.title }}” <button :disabled="pickerActive" @click="workspace.undoClose()">
        撤销关闭
      </button>
    </DismissibleNotice>
    <DismissibleNotice v-if="session && !workspace.available(session)" :notice-key="session.id" class="ai-offline">
      此会话仅供阅读，请切回对应单据并刷新快照；草稿身份无法确认时请新建会话。
    </DismissibleNotice>
    <DismissibleNotice v-if="state.historyError" :notice-key="state.historyError" class="error-banner" role="alert" @close="state.historyError = ''">
      {{ state.historyError }} <button v-if="workspace.historyUnsaved" :disabled="Boolean(state.historySaving)" @click="workspace.retryHistory()">
        重试保存
      </button>
      <button :disabled="!state.historyReady || Boolean(state.historySaving)" @click="workspace.reloadHistory()">
        重新读取
      </button>
    </DismissibleNotice>
    <div v-if="!session && state.tab !== 'settings' && state.tab !== 'history'" class="ai-empty">
      <p>请先在 BOE 页面刷新快照，再开始分析。</p><button @click="state.tab = 'settings'">
        模型设置
      </button>
    </div>
    <div v-if="session" v-show="state.tab === 'conversation'" id="ai-conversation" class="ai-conversation" role="tabpanel" :aria-labelledby="`ai-session-${session.id}`">
      <div ref="conversationScroll" class="ai-conversation-scroll" @scroll="trackScroll">
        <section v-if="selectedScopes.length" class="ai-scope-summary" aria-label="已选字段或区域">
          <header>
            <strong>已选字段/区域</strong>
            <button :disabled="locked" @click="state.tab = 'evidence'">
              调整范围
            </button>
          </header>
          <div class="ai-scope-summary-list">
            <span v-for="item in selectedScopes" :key="item.key" class="scope-chip">
              <span>{{ item.label }}</span><button :disabled="locked" :aria-label="`移除 ${item.label}`" @click="setScopes(session.scopes.filter(scope => scopeIdentity(scope) !== item.key))">×</button>
            </span>
          </div>
        </section>
        <div v-if="!session.answers.length" class="ai-welcome">
          <button class="ai-welcome-link" @click="state.tab = 'evidence'">
            选择相关字段或区域，从一个具体问题开始。
          </button>
          <div class="ai-starters">
            <button v-for="(text, index) in quickQuestions" :key="text" :disabled="draftLocked" @click="session.draft = text; session.collapsed = false">
              {{ ['解释配置', '分析字段状态', '分析报错与过程'][index] }}
            </button>
          </div>
        </div>
        <template v-for="(answer, index) in session.answers" :key="answer.id">
          <p v-if="index > 0 && answer.context !== session.answers[index - 1]?.context" class="ai-context-divider">
            分析条件已更新
          </p>
          <article class="ai-answer">
            <div class="ai-question">
              <span class="ai-message-label">你 · {{ formatLocalDateTime(answer.sentAt) }}</span><p>{{ answer.question }}</p>
            </div>
            <div class="ai-response">
              <AiMarkdown :text="answer.answer" @cite="openPreview(answer, $event)" />
              <DismissibleNotice v-if="statusText(answer)" :notice-key="`${session.id}:${answer.id}:${answer.status}`" class="muted">
                {{ statusText(answer) }}
              </DismissibleNotice>
              <DismissibleNotice v-if="answer.error" :notice-key="answer.error" class="error-banner" role="alert" @close="answer.error = ''">
                {{ answer.error }}
              </DismissibleNotice>
              <DismissibleNotice v-if="invalidCitations(answer).length" :notice-key="`${session.id}:${answer.id}:${invalidCitations(answer).join()}`" class="warnings">
                引用不存在于本次发送证据：{{ invalidCitations(answer).join('、') }}，请核对相关结论。
              </DismissibleNotice>
              <div class="tool-actions">
                <button :disabled="!answer.answer" @click="copyAnswer(answer)">
                  复制回答
                </button>
                <button @click="openPreview(answer)">
                  查看依据
                </button>
                <button v-if="answer.status === 'length'" :disabled="locked || session.conditionsChanged || answer.context !== session.context" @click="workspace.continueAnswer(session, answer)">
                  继续生成
                </button>
                <button v-if="answer.status === 'error' || answer.status === 'stopped'" :disabled="draftLocked" @click="session.draft = answer.question; session.collapsed = false">
                  恢复问题
                </button>
              </div>
            </div>
          </article>
        </template>
      </div>
      <div class="ai-composer">
        <button v-if="session.answers.length && !session.followLatest" class="ai-jump-latest" @click="jumpLatest">
          回到最新 ↓
        </button>
        <DismissibleNotice v-if="session.error" :notice-key="`${session.id}:${session.error}`" class="error-banner" role="alert" @close="session.error = ''">
          {{ session.error }} <button @click="state.tab = 'evidence'">
            调整范围
          </button>
        </DismissibleNotice>
        <DismissibleNotice v-if="session.note" :notice-key="`${session.id}:${session.note}`" :auto-close-ms="3000" :active="active && state.tab === 'conversation'" class="muted" @close="session.note = ''">
          {{ session.note }}
        </DismissibleNotice>
        <DismissibleNotice v-if="pickerActive" :notice-key="session.id" class="ai-composer-hint">
          正在选择范围 <button @click="emit('finishPicker')">
            完成选择
          </button>
        </DismissibleNotice>
        <DismissibleNotice v-if="!workspace.configured || !hasScope" :notice-key="`${session.id}:${workspace.configured}:${hasScope}`" class="ai-composer-hint">
          <button v-if="!workspace.configured" @click="state.tab = 'settings'">
            请先配置模型
          </button>
          <button v-if="!hasScope" @click="state.tab = 'evidence'">
            选择分析范围与证据
          </button>
        </DismissibleNotice>
        <button class="ai-collapse-input" @click="session.collapsed = !session.collapsed">
          {{ session.collapsed ? '展开输入区，继续提问' : '收起输入区' }}
        </button>
        <textarea v-show="!session.collapsed" ref="questionInput" v-model="session.draft" :disabled="draftLocked" rows="2" aria-label="描述问题" placeholder="描述问题或继续追问；Ctrl / ⌘ + Enter 发送" @keydown="questionKeydown" />
        <div class="ai-composer-footer">
          <button :disabled="!preview" @click="openPreview()">
            查看发送内容
          </button>
          <small class="muted">{{ workspace.historyDisabled(session) ? '此会话历史已删除，后续不再保存' : state.historySaving ? '正在保存问答…' : workspace.historyUnsaved ? '问答尚未保存，可在历史页重试' : '问答自动保存到本机' }}</small>
          <span v-if="ownRequest?.phase === 'preparing'" role="status">准备中…</span>
          <button v-if="ownRequest" class="ai-stop" @click="workspace.stop()">
            {{ ownRequest.phase === 'preparing' ? '取消准备' : '停止生成' }}
          </button>
          <button v-else class="ai-primary" :disabled="locked || !workspace.configured || !hasScope || !session.draft.trim()" @click="send">
            {{ state.request ? '另一会话正在生成' : '发送' }}
          </button>
        </div>
      </div>
    </div>

    <div v-show="state.tab !== 'conversation'" class="ai-page-shell">
      <div class="ai-return-bar">
        <button class="ai-primary" @click="state.tab = 'conversation'">
          返回对话
        </button>
      </div>
      <div v-if="session && snapshot" v-show="state.tab === 'evidence'" class="ai-tab-page">
        <h3>分析范围与证据</h3><p class="muted">
          当前会话：{{ session.title }} · 采集 {{ formatLocalDateTime(snapshot.capturedAt) }}
        </p>
        <div class="tool-actions">
          <button :disabled="locked" @click="workspace.refresh(session)">
            刷新数据
          </button><button v-if="ownRequest?.phase === 'preparing'" @click="workspace.stop()">
            取消准备
          </button>
        </div>
        <DismissibleNotice v-if="session.error" :notice-key="`${session.id}:${session.error}`" class="error-banner" role="alert" @close="session.error = ''">
          {{ session.error }}
        </DismissibleNotice>
        <DismissibleNotice v-if="session.note" :notice-key="`${session.id}:${session.note}`" :auto-close-ms="3000" :active="active && state.tab === 'evidence'" class="muted" @close="session.note = ''">
          {{ session.note }}
        </DismissibleNotice>
        <DismissibleNotice v-for="issue in invalidScopes" :key="`${session.id}:${issue}`" class="warnings">
          {{ issue }}
        </DismissibleNotice>
        <div class="ai-send-summary">
          <strong>{{ preview?.evidence.length || 0 }} 项证据 · {{ (byteCount / 1000).toFixed(1) }} / {{ requestLimitKb }} KB</strong>
          <p>{{ valueSummary }}</p>
          <p class="muted">
            自动补充 {{ session.evidence.filter(item => item.automatic && item.included).length }} 项关联证据。默认脱敏，凭据始终移除。
          </p>
          <DismissibleNotice v-if="byteCount > state.settings.maxRequestBytes" :notice-key="`${session.id}:${byteCount}:${state.settings.maxRequestBytes}`" class="warnings">
            请求超过 {{ requestLimitKb }} KB，请缩小范围。占用最多的证据：
            <span v-for="item in largestEvidence" :key="item.id">{{ item.title }}（{{ (item.size / 1000).toFixed(1) }} KB） </span>
          </DismissibleNotice>
          <div class="tool-actions">
            <button v-for="group in groups" :key="group.key" :disabled="locked" :aria-pressed="group.included === group.items.length" @click="toggleGroup(group.key)">
              {{ group.label }} {{ group.included }}/{{ group.items.length }}
            </button><button :disabled="locked" @click="restoreEvidence">
              恢复推荐选择
            </button>
          </div>
        </div>
        <section class="ai-card">
          <h3>选择范围</h3>
          <div class="tool-actions">
            <button :disabled="locked" @click="emit('pick', 'field')">
              从页面选字段
            </button><button :disabled="locked || !areaPicker" @click="emit('pick', 'area')">
              从页面选区域
            </button><button :disabled="locked" @click="setScopes([])">
              清空范围
            </button><button v-if="pickerActive" @click="emit('finishPicker')">
              完成选择
            </button>
          </div>
          <DismissibleNotice v-if="pickerActive" :notice-key="session.id" class="picker-tip">
            {{ continuousPicker ? '连续点击添加，完成后点击“完成选择”。' : '选择一个字段后返回。' }}
          </DismissibleNotice>
          <p v-if="session.eventId">
            已包含过程副本：{{ session.eventId }} <button :disabled="locked" @click="workspace.clearTrace(session)">
              移除过程
            </button>
          </p>
          <div class="scope-list">
            <span v-for="scope in session.scopes" :key="scopeIdentity(scope)" class="scope-chip">{{ scopeLabel(snapshot, scope) }}<button :disabled="locked" :aria-label="`移除 ${scopeLabel(snapshot, scope)}`" @click="setScopes(session.scopes.filter(item => scopeIdentity(item) !== scopeIdentity(scope)))">×</button></span>
          </div>
          <AiScopeSelector :key="session.id" :snapshot="snapshot" :scopes="session.scopes" :disabled="locked" @change="setScopes" />
          <button :disabled="locked" @click="setScopes([{ kind: 'bill' }])">
            选择整个单据
          </button>
        </section>
        <section class="ai-card">
          <label class="ai-dto-option"><input :checked="session.includeFormattedDto" :disabled="locked" type="checkbox" @change="workspace.setDto(session, !session.includeFormattedDto)">包含格式化 DTO（可能显著增加请求大小）</label>
          <details>
            <summary>高级证据设置 · 逐项调整和脱敏</summary>
            <details v-for="group in groups" :key="group.key">
              <summary>{{ group.label }} · {{ group.included }}/{{ group.items.length }}</summary>
              <div v-for="item in group.items" :key="item.id" class="evidence-row">
                <label><input v-model="item.included" :disabled="locked" type="checkbox" @change="workspace.changeEvidence(session)">[{{ item.id }}] {{ item.title }}</label><label><input v-model="item.original" :disabled="locked" type="checkbox" @change="workspace.changeEvidence(session)">保留原值</label>
              </div>
            </details>
          </details>
        </section>
      </div>

      <AiHistoryView v-if="state.tab === 'history'" :entries="state.history" :loading="!state.historyReady" :saving="Boolean(state.historySaving)" :unsaved="workspace.historyUnsaved" :deleting="state.historyDeleting" @delete="workspace.deleteHistory($event)" @refresh="workspace.reloadHistory()" @retry="workspace.retryHistory()" />
      <div v-show="state.tab === 'settings'" class="ai-tab-page">
        <h3>模型设置</h3><p class="muted">
          兼容 OpenAI Chat Completions 接口。测试仅发送简短问题。
        </p>
        <section class="ai-card ai-model-card">
          <div class="ai-settings">
            <label>Base URL<input v-model="state.settings.baseUrl" :disabled="workspace.busy" placeholder="https://api.deepseek.com"></label>
            <label>模型选择<select v-model="modelPreset" :disabled="workspace.busy"><option value="deepseek-v4-flash">DeepSeek V4 Flash · deepseek-v4-flash</option><option value="deepseek-v4-pro">DeepSeek V4 Pro · deepseek-v4-pro</option><option value="custom">自定义模型</option></select></label>
            <label v-if="modelPreset === 'custom'">模型标识<input v-model="state.settings.model" :disabled="workspace.busy" placeholder="填写服务支持的 model 标识"></label>
            <label>API Key<input v-model="state.settings.key" :disabled="workspace.busy" type="password" autocomplete="off"></label>
            <label><input v-model="state.settings.remember" :disabled="workspace.busy" type="checkbox">记住本机 Key（扩展存储不提供加密保险库）</label>
            <section class="ai-advanced-settings">
              <h4>高级设置</h4><label>回答输出上限<input v-model.number="state.settings.maxTokens" :disabled="workspace.busy" type="number" min="128" max="65536" step="128"></label><p class="muted">
                默认 4096；达到上限后可手动继续生成。实际支持范围取决于模型。
              </p>
              <label>请求体上限（KB）<input v-model.number="requestLimitKb" :disabled="workspace.busy" type="number" min="32" max="2000" step="1"></label><p class="muted">
                默认 150 KB；范围 32–2000 KB，仅限制发送的请求 JSON 大小。
              </p>
            </section>
            <div class="ai-settings-actions">
              <button :disabled="workspace.busy" @click="workspace.save()">
                保存设置
              </button><div class="ai-test-action">
                <button :disabled="workspace.busy" @click="workspace.test()">
                  {{ state.test.status === 'testing' ? '测试中…' : '测试模型' }}
                </button><DismissibleNotice v-if="state.test.status !== 'idle'" :auto-close-ms="state.test.status === 'success' ? 3000 : 0" :active="active && state.tab === 'settings'" :notice-key="`${state.test.status}:${state.test.message}`" class="ai-test-status" :class="`is-${state.test.status}`">
                  {{ state.test.message }}
                </DismissibleNotice>
              </div><button :disabled="workspace.busy" @click="workspace.save(true)">
                清除 Key
              </button>
            </div>
            <DismissibleNotice v-if="state.settingsNote" :auto-close-ms="3000" :active="active && state.tab === 'settings'" :notice-key="state.settingsNote" class="muted" @close="state.settingsNote = ''">
              {{ state.settingsNote }}
            </DismissibleNotice><DismissibleNotice v-if="state.settingsError" :notice-key="state.settingsError" class="error-banner" role="alert" @close="state.settingsError = ''">
              {{ state.settingsError }}
            </DismissibleNotice>
          </div>
        </section>
      </div>
    </div>

    <div v-if="drawerOpen" class="ai-drawer-backdrop" @click.self="closePreview">
      <aside ref="drawer" class="ai-evidence-drawer" role="dialog" aria-modal="true" aria-labelledby="ai-drawer-title" tabindex="-1" @keydown="drawerKeydown">
        <header>
          <h3 id="ai-drawer-title">
            {{ viewedAnswer ? '本次实际发送' : '查看发送内容' }}
          </h3><button @click="closePreview">
            关闭
          </button>
        </header>
        <div class="ai-drawer-body">
          <p v-if="!viewedAnswer" class="muted">
            当前快照内容，发送时自动更新。
          </p>
          <p>模型：{{ viewedAnswer?.service.model || state.settings.model }}</p>
          <p>采集时间：{{ formatLocalDateTime(viewedAnswer?.capturedAt || snapshot?.capturedAt) }}</p>
          <p v-if="viewedAnswer">
            发送时间：{{ formatLocalDateTime(viewedAnswer.sentAt) }}
          </p>
          <p>问题：{{ viewedAnswer?.question || preview?.question || '尚未填写' }}</p>
          <p>范围：{{ (viewedAnswer?.scopes || preview?.scopes || []).join('；') || '所选过程' }}</p>
          <p class="muted">
            历史最多携带最近两轮，预算 16 KB；省略 {{ viewedAnswer?.omitted ?? preview?.omitted ?? 0 }} 轮。
          </p>
          <DismissibleNotice v-if="citationId && !drawerEvidence.length" :notice-key="citationId" class="warnings">
            引用 {{ citationId }} 不在本次发送证据中。
          </DismissibleNotice>
          <button v-if="citationId" @click="citationId = ''">
            查看全部依据
          </button>
          <AiEvidenceView :evidence="drawerEvidence" :can-locate="!locked" :requests="viewedAnswer?.requests || preview?.body" @locate="emit('locate', $event)" />
        </div>
      </aside>
    </div>
  </section>
</template>
