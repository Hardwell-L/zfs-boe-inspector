<script setup lang="ts">
import DismissibleNotice from './DismissibleNotice.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  buildRuleDiagnostics,
  buildTravelView,
  runInspection,
  type RuleDiagnosticEntry,
} from '@zfs-boe-inspector/core';
import { baseRuleEvaluators } from '@zfs-boe-inspector/rule-base';
import type {
  AreaDetail,
  DependencyDetail,
  PickerState,
  BoeInspectionSnapshot,
  BridgeStatus,
  FieldDetail,
  FieldSelection,
  InspectionReport,
  JsonValue,
  RuleEvaluation,
  InspectionSelection,
  TraceSession,
} from '@zfs-boe-inspector/shared-types';
import { pageBridge } from './bridge';
import { scopeIdentity } from './aiContext';
import { useAiWorkspace, sourceIdentity, type AiSession } from './useAiWorkspace';
import AiPanel from './AiPanel.vue';
import TracePanel from './TracePanel.vue';
import ValidationRules from './ValidationRules.vue';
import { fieldAreas, indexedFieldDetail, issueItems } from './inspectionView';
import { dynamicDisplayModel, hasDisplayText } from './ruleDiagnosticView';

type ViewKey = 'overview' | 'fields' | 'rules' | 'issues' | 'travel' | 'runtime' | 'trace' | 'ai';
type PropertyTab = 'base' | 'advance' | 'data' | 'raw';
type RuleTab = 'validation' | 'calculation' | 'dynamic' | 'applyBoe';

const view = ref<ViewKey>('overview');
const loading = ref(false);
const error = ref('');
const status = ref<BridgeStatus>();
const snapshot = ref<BoeInspectionSnapshot>();
const report = ref<InspectionReport>();
const selectedArea = ref<AreaDetail>();
const selectedField = ref<FieldDetail>();
const propertyTab = ref<PropertyTab>('base');
const activeInstanceId = ref('');
const fieldSearch = ref('');
const issueFilter = ref<'all' | 'error' | 'warning' | 'info' | 'skipped'>('all');
const issueArea = ref('');
const issueType = ref('');
const issueSearch = ref('');
const issuePage = ref(1);
const issuePageSize = 50;
let fieldRequest = 0;
const pickerActive = ref(false);
const ruleTab = ref<RuleTab>('validation');
const onlyRuleIssues = ref(false);
const showRuleTechnical = ref(false);
const aiWorkspace = useAiWorkspace(refreshAiSnapshot);
const aiBusy = computed(() => aiWorkspace.busy);
const pickerDestination = ref<'fields' | 'ai'>('fields');
let pickerRun = 0;
let pickerInstanceId = '';
let pickerAccepted = new Set<string>();
const pickerMode = ref<'field' | 'area'>('field');
const traceSession = ref<TraceSession>();
let pickerPageId = '';
let pickerSessionId = 0;
let pageEpoch = 0;
let pickerTimer: ReturnType<typeof setInterval> | undefined;

const navItems: Array<{ key: ViewKey; label: string }> = [
  { key: 'overview', label: '单据概览' },
  { key: 'fields', label: '字段配置' },
  { key: 'rules', label: '规则诊断' },
  { key: 'issues', label: '问题列表' },
  { key: 'travel', label: '差旅标准' },
  { key: 'runtime', label: '运行时数据' },
  { key: 'trace', label: '过程记录' },
  { key: 'ai', label: 'AI 分析' },
];

const fieldTabs: Array<{ key: PropertyTab; label: string }> = [
  { key: 'base', label: '基本' },
  { key: 'advance', label: '高级' },
  { key: 'data', label: '数据源' },
  { key: 'raw', label: '原始字段配置' },
];

const areaTabs: Array<{ key: PropertyTab; label: string }> = [
  { key: 'base', label: '基本' },
  { key: 'advance', label: '高级' },
  { key: 'raw', label: '原始区域配置' },
];

const ruleTabs: Array<{ key: RuleTab; label: string }> = [
  { key: 'validation', label: '校验' },
  { key: 'calculation', label: '计算' },
  { key: 'dynamic', label: '动态' },
  { key: 'applyBoe', label: '关联申请' },
];

const allAreas = computed(() => fieldAreas(snapshot.value));
const areas = computed(() => {
  const keyword = fieldSearch.value.trim().toLowerCase();
  return allAreas.value.flatMap((area) => {
    const areaMatch = `${area.areaName} ${area.areaCode}`.toLowerCase().includes(keyword);
    const fields = area.fields.filter((field) => areaMatch || [field.fieldCode, field.fieldName, field.labelCode, field.fieldType]
      .some((value) => String(value ?? '').toLowerCase().includes(keyword)));
    return fields.length || areaMatch ? [{ ...area, fields }] : [];
  });
});
const selectedDuplicate = computed(() => {
  const selection = selectedField.value?.selection;
  return allAreas.value.find((area) => area.areaCode === selection?.areaCode)?.fields.find((field) => field.fieldIndex === selection?.fieldIndex);
});
const versionRows = computed(() => snapshot.value ? [
  { name: 'Adapter', version: snapshot.value.meta.adapterVersion },
  { name: 'Vue', version: snapshot.value.meta.vueVersion },
  ...Object.entries(snapshot.value.meta.zfsPackages ?? {}).map(([name, version]) => ({ name, version })),
  { name: 'Snapshot Schema', version: snapshot.value.schemaVersion },
] : []);
const issueModel = computed(() => issueItems(snapshot.value, report.value?.evaluations ?? [],
  Object.values(ruleDiagnostics.value ?? {}).flatMap((model) => model.entries)));
const filteredIssues = computed(() => issueModel.value.filter((item) => {
  const evaluation = item.evaluation;
  if (issueFilter.value === 'skipped' ? evaluation.status !== 'skipped' : evaluation.status !== 'issue') return false;
  if (!['all', 'skipped'].includes(issueFilter.value) && evaluation.severity !== issueFilter.value) return false;
  if (issueType.value && item.type !== issueType.value) return false;
  if (issueArea.value && !(issueArea.value === '__global' ? !item.areaCodes.length : item.areaCodes.includes(issueArea.value))) return false;
  return item.search.includes(issueSearch.value.trim().toLowerCase());
}));
const issuePageCount = computed(() => Math.max(1, Math.ceil(filteredIssues.value.length / issuePageSize)));
const visibleIssues = computed(() => filteredIssues.value.slice((issuePage.value - 1) * issuePageSize, issuePage.value * issuePageSize));
watch([issueArea, issueType, issueFilter, issueSearch, report], () => { issuePage.value = 1; });
const issueGroups = computed(() => [
  ...allAreas.value.map((area) => ({ code: area.areaCode, name: area.areaName })),
  { code: '__global', name: '全局／未定位' },
].filter((area) => !issueArea.value || area.code === issueArea.value).map((area) => ({ ...area,
  items: visibleIssues.value.filter((item) => area.code === '__global' ? !item.areaCodes.length : item.areaCodes.includes(area.code)),
})).filter((area) => area.items.length));

const propertyTabs = computed(() => selectedArea.value ? areaTabs : fieldTabs);
const activePropertyGroup = computed(() => (selectedArea.value?.groups ?? selectedField.value?.groups)
  ?.find(({ key }) => key === propertyTab.value));
const travelView = computed(() => buildTravelView(snapshot.value?.travel));
const ruleDiagnostics = computed(() => snapshot.value ? buildRuleDiagnostics(snapshot.value) : undefined);
const activeRuleModel = computed(() => {
  const model = ruleDiagnostics.value?.[ruleTab.value];
  return model && ruleTab.value === 'dynamic' ? dynamicDisplayModel(model) : model;
});
const unverifiedLabel = computed(() => ruleTab.value === 'calculation' ? '结果待核对' : '未验证');
const ruleEmptyMessage = computed(() => {
  if (ruleTab.value === 'dynamic' && !activeRuleModel.value?.metrics.total) return '当前模板没有配置动态显示规则的字段';
  return onlyRuleIssues.value ? '当前分类没有确定性问题。' : '当前模板没有此类规则配置。';
});
const ruleGroups = computed(() => {
  const entries = (activeRuleModel.value?.entries ?? [])
    .filter(({ state }) => !onlyRuleIssues.value || state === 'issue');
  const groups = new Map<string, { areaCode: string; areaName: string; entries: RuleDiagnosticEntry[]; truncated: number }>();
  for (const entry of entries) {
    const areaCode = entry.areaCode || 'global';
    const group = groups.get(areaCode) ?? {
      areaCode,
      areaName: entry.areaName || (areaCode === 'global' ? '全局配置' : areaCode),
      entries: [],
      truncated: 0,
    };
    if (group.entries.length < 50) group.entries.push(entry);
    else group.truncated += 1;
    groups.set(areaCode, group);
  }
  return [...groups.values()];
});

const connectedLabel = computed(() => status.value?.connected ? '已连接' : '未连接');

function pretty(value: unknown) {
  return JSON.stringify(value, null, 2);
}

async function refresh() {
  const epoch = pageEpoch;
  loading.value = true;
  error.value = '';
  try {
    const nextStatus = await pageBridge.getStatus();
    if (epoch !== pageEpoch) return;
    status.value = nextStatus;
    if (!status.value.connected) {
      resetSelection();
      snapshot.value = undefined;
      report.value = undefined;
      aiWorkspace.setSource(undefined);
      return;
    }
    if (!status.value.instances.some((instance) => instance.instanceId === activeInstanceId.value)) {
      activeInstanceId.value = status.value.activeInstanceId || status.value.instances[0]?.instanceId || '';
    }
    const { snapshot: next, pageId } = await pageBridge.getAiSnapshot(activeInstanceId.value || undefined);
    if (epoch !== pageEpoch) return;
    if (snapshot.value && (snapshot.value.instanceId !== next.instanceId || snapshot.value.meta.projectCode !== next.meta.projectCode)) resetSelection();
    snapshot.value = next;
    report.value = runInspection(snapshot.value, baseRuleEvaluators);
    activeInstanceId.value = next.instanceId;
    aiWorkspace.setSource({ snapshot: next, evaluations: report.value.evaluations, pageId });
    if (selectedArea.value) {
      selectedArea.value = await pageBridge.getAreaDetail(selectedArea.value.areaCode, activeInstanceId.value);
    }
    if (selectedField.value) {
      await selectField(selectedField.value.selection);
    }
  } catch (reason) {
    snapshot.value = undefined;
    report.value = undefined;
    aiWorkspace.setSource(undefined);
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    loading.value = false;
  }
}

function resetSelection() {
  fieldRequest += 1;
  traceSession.value = undefined;
  selectedArea.value = undefined;
  selectedField.value = undefined;
  propertyTab.value = 'base';
}

async function changeInstance() {
  try {
    if (pickerActive.value) await cancelPicker(false);
    if (traceSession.value?.active) await pageBridge.stopTrace();
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { resetSelection(); await refresh(); }
}

async function selectArea(areaCode: string) {
  const request = ++fieldRequest;
  try {
    const detail = await pageBridge.getAreaDetail(areaCode, activeInstanceId.value);
    if (request !== fieldRequest) return;
    if (!detail) throw new Error(`未找到区域配置：${areaCode}`);
    selectedArea.value = detail;
    selectedField.value = undefined;
    propertyTab.value = 'base';
    await nextTick();
    document.querySelector('.property-panel')?.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (reason) {
    if (request !== fieldRequest) return;
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

async function selectField(selection: FieldSelection, navigate = false) {
  const request = ++fieldRequest;
  try {
    let detail = await pageBridge.getFieldDetail(selection, activeInstanceId.value);
    if (request !== fieldRequest) return;
    if (selection.fieldIndex !== undefined && detail?.selection.fieldIndex !== selection.fieldIndex && snapshot.value) {
      detail = indexedFieldDetail(snapshot.value, selection);
    }
    if (!detail) throw new Error(`未找到字段配置：${selection.areaCode}.${selection.fieldCode}，请刷新后重新选择`);
    if (detail.selection.fieldIndex === undefined) {
      const field = allAreas.value.find((area) => area.areaCode === detail.selection.areaCode)?.fields.find((item) => item.fieldCode === detail.selection.fieldCode);
      if (field) detail.selection = { ...detail.selection, fieldIndex: field.fieldIndex };
    }
    selectedArea.value = undefined;
    selectedField.value = detail;
    propertyTab.value = 'base';
    if (navigate) {
      fieldSearch.value = '';
      view.value = 'fields';
      await nextTick();
      window.requestAnimationFrame(() => {
        if (request !== fieldRequest) return;
        const fieldItem = Array.from(document.querySelectorAll('.field-item')).find((element) => (
          element instanceof window.HTMLElement
          && element.dataset.areaCode === detail.selection.areaCode
          && element.dataset.fieldCode === detail.selection.fieldCode
          && (detail.selection.fieldIndex === undefined || element.dataset.fieldIndex === String(detail.selection.fieldIndex))
        ));
        fieldItem?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const propertyPanel = document.querySelector('.property-panel');
        if (propertyPanel instanceof window.HTMLElement) {
          propertyPanel.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }
    return detail;
  } catch (reason) {
    if (request !== fieldRequest) return;
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

async function acceptAiTargets(state: PickerState, run: number) {
  const targets = state.targets ?? (state.target ? [state.target] : state.selection ? [{ kind: 'field' as const, ...state.selection }] : []);
  for (const target of targets) {
    if (run !== pickerRun || aiWorkspace.current?.id !== pickerSessionId || !aiWorkspace.current || !aiWorkspace.available(aiWorkspace.current)) return;
    if (pickerAccepted.has(scopeIdentity(target))) continue;
    if (target.kind === 'field') {
      const detail = await pageBridge.getFieldDetail(target, pickerInstanceId, pickerPageId);
      if (run !== pickerRun) return;
      if (detail) aiWorkspace.addScope({ kind: 'field', ...detail.selection }, pickerSessionId, true);
    } else aiWorkspace.addScope(target, pickerSessionId, true);
    pickerAccepted.add(scopeIdentity(target));
  }
}

async function startPicker(mode: 'field' | 'area', destination: 'fields' | 'ai' = 'fields') {
  if (aiBusy.value) return;
  if (pickerActive.value) await cancelPicker();
  const run = ++pickerRun;
  let polling = false;
  try {
    error.value = '';
    pickerMode.value = mode;
    pickerDestination.value = destination;
    pickerInstanceId = activeInstanceId.value;
    pickerAccepted = new Set();
    pickerPageId = '';
    pickerSessionId = 0;
    if (destination === 'ai') {
      const session = aiWorkspace.current;
      if (!session || !aiWorkspace.available(session)) throw new Error('请返回对应单据后选择范围');
      pickerSessionId = session.id;
      pickerPageId = session.source.pageId;
      aiWorkspace.state.pickerSessionId = session.id;
      pickerActive.value = true;
      const source = await refreshAiSnapshot(session, true);
      if (run !== pickerRun) return;
      if (sourceIdentity(source) !== session.binding) throw new Error('单据已变化，请新建会话');
      view.value = 'ai';
    }
    if (run !== pickerRun) return;
    const modern = status.value?.capabilities?.includes('area-picker');
    if (!modern && mode === 'area') throw new Error('当前 Adapter 不支持页面区域选择，请升级 Adapter 或从配置列表选择区域');
    if (modern) await pageBridge.startPicker(mode, pickerInstanceId, {
      continuous: destination === 'ai' && Boolean(status.value?.capabilities?.includes('continuous-picker')),
    }, pickerPageId);
    else await pageBridge.startFieldPicker(pickerPageId);
    if (run !== pickerRun) return;
    pickerActive.value = true;
    if (pickerTimer) clearInterval(pickerTimer);
    pickerTimer = setInterval(async () => {
      if (polling) return;
      polling = true;
      try {
        const state = await pageBridge.getFieldPickerState(pickerPageId);
        if (run !== pickerRun) return;
        if (destination === 'ai') await acceptAiTargets(state, run);
        if (run !== pickerRun) return;
        pickerActive.value = state.active;
        if (!state.active) {
          aiWorkspace.state.pickerSessionId = 0;
          if (pickerTimer) clearInterval(pickerTimer);
          pickerTimer = undefined;
          const target = state.target ?? (state.selection ? { kind: 'field' as const, ...state.selection } : undefined);
          if (destination === 'fields' && target?.kind === 'field') {
            await selectField(target, true);
          } else if (destination === 'fields' && target?.kind === 'area') {
            await selectArea(target.areaCode);
            view.value = 'fields';
          }
          if (state.error) error.value = state.error;
        }
      } catch (reason) {
        if (run !== pickerRun) return;
        await pageBridge.cancelFieldPicker(pickerPageId).catch(() => {});
        pickerActive.value = false;
        aiWorkspace.state.pickerSessionId = 0;
        if (pickerTimer) clearInterval(pickerTimer);
        pickerTimer = undefined;
        error.value = reason instanceof Error ? reason.message : String(reason);
      } finally { polling = false; }
    }, 180);
  } catch (reason) {
    if (run !== pickerRun) return;
    pickerActive.value = false;
    aiWorkspace.state.pickerSessionId = 0;
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

async function cancelPicker(keepAiScopes = true) {
  const run = ++pickerRun;
  if (pickerTimer) clearInterval(pickerTimer);
  pickerTimer = undefined;
  try {
    const state = await pageBridge.cancelFieldPicker(pickerPageId);
    if (keepAiScopes && pickerDestination.value === 'ai') await acceptAiTargets(state, run);
  } finally { pickerActive.value = false; aiWorkspace.state.pickerSessionId = 0; }
}

function exportReport() {
  if (!report.value) return;
  const blob = new Blob([pretty(report.value)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `zfs-boe-inspection-${snapshot.value?.instanceId.replace(/[^A-Za-z0-9_-]/g, '_') ?? 'report'}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function evaluationClass(evaluation: RuleEvaluation) {
  return evaluation.status === 'skipped' ? 'skipped' : evaluation.severity ?? 'info';
}

function diagnosticClass(entry: RuleDiagnosticEntry) {
  return entry.state === 'issue' ? entry.severity ?? 'error' : entry.state;
}

async function openAiConversation(selection?: InspectionSelection, append = false, eventId = '') {
  if (aiBusy.value || loading.value) return;
  if (pickerActive.value) {
    try { await cancelPicker(false); }
    catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); return; }
  }
  const current = aiWorkspace.current;
  if (append && current && aiWorkspace.available(current)) {
    if (selection) aiWorkspace.addScope(selection);
    aiWorkspace.select(current.id);
  } else aiWorkspace.create(selection ? [selection] : [], eventId ? traceSession.value : undefined, eventId);
  view.value = 'ai';
}

async function refreshAiSnapshot(session: AiSession, forPicker = false) {
  if (loading.value || (pickerActive.value && !forPicker)) throw new Error('请等待当前读取或页面选择结束');
  const { snapshot: next, pageId } = await pageBridge.getAiSnapshot(session.source.snapshot.instanceId, session.source.pageId);
  const nextReport = runInspection(next, baseRuleEvaluators);
  return { snapshot: next, evaluations: nextReport.evaluations, pageId };
}

async function locateAiSelection(selection: InspectionSelection) {
  const session = aiWorkspace.current;
  if (!session || !aiWorkspace.mutable(session)) return;
  try {
    const source = await refreshAiSnapshot(session);
    if (sourceIdentity(source) !== session.binding) throw new Error('单据已变化，请返回原单据');
    const found = await pageBridge.locateAiSelection(selection, session.source.snapshot.instanceId, session.source.pageId);
    if (!found) session.error = '当前字段或区域在页面中不可见';
  } catch (reason) { session.error = reason instanceof Error ? reason.message : String(reason); }
}

async function locateSelection(selection: InspectionSelection) {
  try {
    if (selection.kind === 'field') await selectField(selection, true);
    else if (selection.kind === 'area') { await selectArea(selection.areaCode); view.value = 'fields'; }
    if (status.value?.capabilities?.includes('locate-selection')) {
      const found = await pageBridge.locateSelection(selection, activeInstanceId.value);
      if (!found) error.value = '配置已打开，当前字段或区域在页面中不可见';
    }
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
}

function updateTrace(session: TraceSession | undefined) {
  traceSession.value = session;
}

function analyzeTrace(eventId: string, selection?: InspectionSelection) {
  if (aiBusy.value) return;
  void openAiConversation(selection, false, eventId);
}

async function locateDiagnostic(entry: RuleDiagnosticEntry) {
  if (!entry.areaCode || !entry.fieldCode) return;
  await selectField({ areaCode: entry.areaCode, fieldCode: entry.fieldCode, rowIndex: entry.rowIndex ?? 0 }, true);
}

function propertyValue(value: JsonValue | undefined) {
  if (value === undefined) return '未采集';
  if (value === '') return '""（空字符串）';
  if (value === null) return 'null';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function dependencySummary(dependency: DependencyDetail) {
  const value = dependency.values[0];
  if (!value) return '当前值未采集';
  const text = value.status === 'value' ? propertyValue(value.value) : value.status === 'missing' ? '字段不存在' : value.status === 'truncated' ? '数据已截断' : '未采集';
  const remaining = dependency.values.length - 1 + dependency.omittedRows;
  const candidate = dependency.resolution.startsWith('候选') || dependency.resolution.startsWith('汇总');
  return `${candidate ? '候选值 · ' : ''}第 ${value.rowIndex + 1} 行 · 当前值为：${text}${remaining > 0 ? ` · 另 ${remaining} 行` : ''}`;
}

function amountValue(value: number | string | undefined, currency = '') {
  if (value === undefined || value === '') return '—';
  return `${value}${currency && currency !== '—' ? ` ${currency}` : ''}`;
}

function invalidateAiPage() { pageEpoch += 1; aiWorkspace.setSource(undefined); }
async function onTabActivated() {
  if (chrome.devtools?.inspectedWindow) return;
  const source = aiWorkspace.state.source;
  if (!source) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (aiWorkspace.state.source === source && tab?.id !== (JSON.parse(source.pageId) as [number])[0]) invalidateAiPage();
}
function onTabChanged(tabId: number, info: chrome.tabs.OnUpdatedInfo) {
  const pageId = aiWorkspace.state.source?.pageId;
  const boundTab = pageId ? (JSON.parse(pageId) as [number])[0] : undefined;
  if (tabId === boundTab && (info.status === 'loading' || info.url)) invalidateAiPage();
}
onMounted(() => {
  void aiWorkspace.load();
  void refresh();
  chrome.tabs.onActivated.addListener(onTabActivated);
  chrome.tabs.onUpdated.addListener(onTabChanged);
  chrome.devtools?.network?.onNavigated.addListener(invalidateAiPage);
});
onBeforeUnmount(() => {
  chrome.tabs.onActivated.removeListener(onTabActivated);
  chrome.tabs.onUpdated.removeListener(onTabChanged);
  chrome.devtools?.network?.onNavigated.removeListener(invalidateAiPage);
  pickerRun += 1;
  if (pickerTimer) clearInterval(pickerTimer);
  if (pickerActive.value) void pageBridge.cancelFieldPicker(pickerPageId);
});
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div>
        <h1>BOE Inspector</h1>
        <span class="connection" :class="{ online: status?.connected }">{{ connectedLabel }}</span>
        <span v-if="snapshot" class="identity">{{ snapshot.meta.boeTypeCode || 'UNKNOWN' }} · {{ snapshot.meta.boeStatus || '—' }}</span>
      </div>
      <div class="actions">
        <select v-if="status?.instances.length" v-model="activeInstanceId" :disabled="aiBusy" @change="changeInstance">
          <option v-for="instance in status.instances" :key="instance.instanceId" :value="instance.instanceId">
            {{ instance.instanceId }}
          </option>
        </select>
        <button :disabled="loading || aiBusy || pickerActive" @click="refresh">
          {{ loading ? '读取中…' : '刷新快照' }}
        </button>
        <button
          v-if="!pickerActive"
          class="picker-toolbar-button"
          :disabled="!status?.connected || aiBusy"
          @click="startPicker('field')"
        >
          选择页面字段
        </button>
        <button v-if="!pickerActive" class="picker-toolbar-button" :disabled="!status?.connected || aiBusy" @click="startPicker('area')">
          选择页面区域
        </button>
        <button v-else class="picker-toolbar-button danger" @click="cancelPicker()">
          {{ pickerDestination === 'ai' ? '完成选择' : '取消选择' }}
        </button>
        <button :disabled="!report" @click="exportReport">
          导出报告
        </button>
      </div>
    </header>

    <DismissibleNotice v-if="error" :notice-key="error" class="error-banner" role="alert" @close="error = ''">
      {{ error }}
    </DismissibleNotice>
    <div class="workspace">
      <nav class="sidebar">
        <button v-for="item in navItems" :key="item.key" :class="{ active: view === item.key }" @click="view = item.key">
          {{ item.label }}
          <span v-if="item.key === 'issues' && report" class="count">{{ report.summary.issues }}</span>
        </button>
      </nav>

      <main class="content" :class="{ 'content-ai': view === 'ai' }">
        <div v-if="!snapshot && !loading && view !== 'ai'" class="empty-state">
          <h2>尚未检测到 BOE Runtime Adapter</h2>
          <p>请在已接入 Adapter 的 BOE 页面刷新快照。已有 AI 会话仍可从左侧进入查看。</p>
        </div>
        <section v-if="view === 'overview' && snapshot" class="section">
          <h2>单据概览</h2>
          <div class="metric-grid">
            <article><span>项目</span><strong>{{ snapshot.meta.projectCode }}</strong></article>
            <article><span>环境</span><strong>{{ snapshot.meta.environment }}</strong></article>
            <article><span>BOE 类型</span><strong>{{ snapshot.meta.boeTypeCode || '—' }}</strong></article>
            <article><span>单据状态</span><strong>{{ snapshot.meta.boeStatus || '—' }}</strong></article>
            <article><span>字段数量</span><strong>{{ allAreas.reduce((sum, area) => sum + area.fields.length, 0) }}</strong></article>
            <article><span>诊断问题</span><strong>{{ report?.summary.issues ?? 0 }}</strong></article>
          </div>
          <h3>版本信息</h3>
          <div class="table-scroll version-list">
            <table class="data-table">
              <thead><tr><th>组件</th><th>版本</th></tr></thead>
              <tbody>
                <tr v-for="row in versionRows" :key="row.name">
                  <td>{{ row.name }}</td><td>{{ row.version ?? '未采集' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <DismissibleNotice v-if="snapshot.warnings?.length" :notice-key="`${snapshot.instanceId}:${snapshot.warnings.join()}`" class="warnings">
            <p v-for="warning in snapshot.warnings" :key="warning">
              {{ warning }}
            </p>
          </DismissibleNotice>
        </section>

        <section v-if="view === 'fields'" class="field-layout">
          <aside class="field-tree">
            <input v-model="fieldSearch" placeholder="搜索字段编码、名称或类型">
            <div v-for="area in areas" :key="area.areaCode" class="area-group">
              <button
                class="area-item"
                :class="{ active: selectedArea?.areaCode === area.areaCode }"
                @click="selectArea(area.areaCode)"
              >
                <span>{{ area.areaName }}</span>
                <small>{{ area.areaCode }}</small>
              </button>
              <button
                v-for="field in area.fields"
                :key="field.fieldIndex"
                class="field-item"
                :data-area-code="area.areaCode"
                :data-field-code="field.fieldCode"
                :data-field-index="field.fieldIndex"
                :class="{ active: selectedField?.selection.areaCode === area.areaCode && selectedField?.selection.fieldIndex === field.fieldIndex }"
                @click="selectField({ areaCode: area.areaCode, fieldCode: String(field.fieldCode ?? ''), fieldIndex: field.fieldIndex, rowIndex: 0 })"
              >
                <span>{{ field.fieldName || field.fieldCode || '未命名字段' }}</span>
                <small v-if="field.duplicateCount > 1" class="duplicate-badge">重复 · {{ field.duplicateOrdinal }}/{{ field.duplicateCount }}</small>
                <small>{{ field.fieldCode }} · {{ field.fieldType }}</small>
              </button>
            </div>
          </aside>
          <section class="property-panel">
            <DismissibleNotice v-if="pickerActive" :notice-key="pickerMode" class="picker-tip">
              请在被检查页面中点击一个 BOE {{ pickerMode === 'area' ? '区域' : '字段' }}，按 Esc 可取消。
            </DismissibleNotice>
            <div v-if="!selectedArea && !selectedField" class="placeholder">
              从左侧列表选择区域或字段，也可以使用页面选择工具。
            </div>
            <template v-else-if="selectedField">
              <h2>{{ (selectedField.field as any).fieldName || selectedField.selection.fieldCode }}</h2>
              <p class="muted">
                {{ selectedField.selection.areaCode }}.{{ selectedField.selection.fieldCode }} · 第 {{ selectedField.selection.rowIndex + 1 }} 行
              </p>
              <p v-if="selectedDuplicate && selectedDuplicate.duplicateCount > 1" class="duplicate-notice">
                重复配置 {{ selectedDuplicate.duplicateOrdinal }}/{{ selectedDuplicate.duplicateCount }} · 配置项独立展示，运行时值与状态按同一字段编码采集。
              </p>
              <div v-if="selectedField.runtimeState" class="runtime-flags">
                <span>显示：{{ selectedField.runtimeState.visible }}</span>
                <span>编辑：{{ selectedField.runtimeState.editable }}</span>
                <span>必填：{{ selectedField.runtimeState.required }}</span>
              </div>
            </template>
            <template v-else-if="selectedArea">
              <h2>{{ (selectedArea.area as any).areaName || selectedArea.areaCode }}</h2>
              <p class="muted">
                {{ selectedArea.areaCode }} · 区域配置
              </p>
            </template>
            <template v-if="selectedArea || selectedField">
              <button @click="selectedField ? openAiConversation({ kind: 'field', ...selectedField.selection }) : selectedArea && openAiConversation({ kind: 'area', areaCode: selectedArea.areaCode })">
                新建 AI 分析
              </button>
              <button @click="selectedField ? openAiConversation({ kind: 'field', ...selectedField.selection }, true) : selectedArea && openAiConversation({ kind: 'area', areaCode: selectedArea.areaCode }, true)">
                追加到当前 AI 分析
              </button>
              <div class="property-tabs" role="tablist" :aria-label="selectedArea ? '区域配置分类' : '字段配置分类'">
                <button
                  v-for="tab in propertyTabs"
                  :key="tab.key"
                  role="tab"
                  :aria-selected="propertyTab === tab.key"
                  :class="{ active: propertyTab === tab.key }"
                  @click="propertyTab = tab.key"
                >
                  {{ tab.label }}
                </button>
              </div>
              <article v-if="propertyTab !== 'raw' && activePropertyGroup" class="property-group">
                <h3>{{ activePropertyGroup.label }}</h3>
                <dl>
                  <template v-for="item in activePropertyGroup.items" :key="item.code">
                    <dt :title="item.tips" :class="{ 'full-property': selectedArea && item.code === 'validateRules' }">
                      {{ item.label }}
                    </dt>
                    <dd :class="{ 'full-property': selectedArea && item.code === 'validateRules' }">
                      <ValidationRules v-if="selectedArea && item.code === 'validateRules'" :key="selectedArea.areaCode" :value="item.value" />
                      <template v-else>
                        {{ propertyValue(item.value) }}
                      </template>
                    </dd>
                  </template>
                </dl>
              </article>
              <p v-else-if="propertyTab !== 'raw'" class="tab-empty">
                当前{{ selectedArea ? '区域' : '字段' }}没有此分类配置。
              </p>
              <div v-else class="raw-field-config">
                <pre>{{ pretty(selectedArea?.area ?? selectedField?.field) }}</pre>
              </div>
            </template>
          </section>
        </section>

        <section v-if="view === 'rules'" class="section rule-diagnostics">
          <div class="section-header rule-header">
            <div>
              <h2>规则诊断</h2>
              <p class="muted">
                {{ ruleTab === 'calculation' ? '这里展示计算配置和依赖字段的当前值。计算结果是否正确，需要结合页面实际计算过程核对。' : '只解析配置与已有运行态证据，不执行校验、计算或关联申请转换。' }}
              </p>
            </div>
            <div class="rule-switches">
              <label><input v-model="onlyRuleIssues" type="checkbox"> 只看问题</label>
              <label><input v-model="showRuleTechnical" type="checkbox"> 显示技术详情</label>
            </div>
          </div>
          <div class="property-tabs rule-tabs" role="tablist" aria-label="规则诊断分类">
            <button
              v-for="tab in ruleTabs"
              :key="tab.key"
              role="tab"
              :aria-selected="ruleTab === tab.key"
              :class="{ active: ruleTab === tab.key }"
              @click="ruleTab = tab.key"
            >
              {{ tab.label }}
            </button>
          </div>
          <div v-if="activeRuleModel" class="metric-grid rule-metrics">
            <article><span>诊断条目</span><strong>{{ activeRuleModel.metrics.total }}</strong></article>
            <article><span>确定问题</span><strong>{{ activeRuleModel.metrics.issues }}</strong></article>
            <article><span>{{ unverifiedLabel }}</span><strong>{{ activeRuleModel.metrics.unverified }}</strong></article>
            <article><span>可定位字段</span><strong>{{ activeRuleModel.metrics.locatable }}</strong></article>
          </div>
          <p v-if="activeRuleModel?.truncatedAreas.length" class="truncate-tip">
            {{ activeRuleModel.truncatedAreas.map((item) => `${item.areaCode} 仅分析前 ${item.displayedRows}/${item.totalRows} 行`).join('；') }}
          </p>
          <div v-if="ruleGroups.length" class="diagnostic-groups">
            <details v-for="group in ruleGroups" :key="group.areaCode" class="diagnostic-area" open>
              <summary>
                <strong>{{ group.areaName }}</strong>
                <span>{{ group.areaCode }} · {{ group.entries.length }} 条</span>
              </summary>
              <details
                v-for="(entry, index) in group.entries"
                :key="`${entry.id}-${entry.fieldCode}-${entry.rowIndex}-${index}`"
                class="diagnostic-entry"
                :class="diagnosticClass(entry)"
              >
                <summary>
                  <span class="diagnostic-status">{{ entry.state === 'issue' ? '问题' : entry.state === 'unverified' ? unverifiedLabel : '已观察' }}</span>
                  <span class="diagnostic-title">{{ entry.summary }}</span>
                  <button
                    v-if="entry.areaCode && entry.fieldCode"
                    type="button"
                    class="locate-button"
                    @click.prevent.stop="locateDiagnostic(entry)"
                  >
                    定位字段
                  </button>
                </summary>
                <div class="diagnostic-body">
                  <p v-if="entry.id !== 'CALCULATION_RESULT_UNVERIFIED' || entry.state !== 'unverified'">
                    {{ entry.detail }}
                  </p>
                  <details v-for="dependency in entry.dependencyDetails" :key="dependency.reference" class="dependency-detail">
                    <summary class="dependency-summary">
                      <span class="dependency-summary-title">{{ dependency.fieldName }}（{{ dependency.reference }}） · {{ dependency.purpose }}</span>
                      <span class="dependency-summary-value" :title="dependencySummary(dependency)">{{ dependencySummary(dependency) }}</span>
                    </summary>
                    <p>{{ dependency.areaName }} · {{ dependency.resolution }}</p>
                    <div class="value-list">
                      <div v-for="value in dependency.values" :key="value.rowIndex" class="dependency-value-row">
                        <div class="dependency-value-content">
                          <span class="muted">第 {{ value.rowIndex + 1 }} 行 · </span>
                          当前值为：{{ value.status === 'value' ? propertyValue(value.value) : value.status === 'missing' ? '字段不存在' : value.status === 'truncated' ? '数据已截断' : '未采集' }}
                          <span v-if="hasDisplayText(value.description, value.value)"> · 显示文本：{{ propertyValue(value.description) }}</span>
                        </div>
                        <div class="dependency-value-actions">
                          <button @click="locateSelection({ kind: 'field', areaCode: dependency.areaCode, fieldCode: dependency.fieldCode, rowIndex: value.rowIndex })">
                            定位
                          </button>
                          <button @click="openAiConversation({ kind: 'field', areaCode: dependency.areaCode, fieldCode: dependency.fieldCode, rowIndex: value.rowIndex })">
                            新建 AI 分析
                          </button>
                          <button @click="openAiConversation({ kind: 'field', areaCode: dependency.areaCode, fieldCode: dependency.fieldCode, rowIndex: value.rowIndex }, true)">
                            追加到当前分析
                          </button>
                        </div>
                      </div>
                    </div>
                    <p v-if="dependency.omittedRows">
                      另有 {{ dependency.omittedRows }} 行未展示。
                    </p>
                  </details>
                  <template v-if="showRuleTechnical">
                    <p class="evidence-title">
                      证据路径
                    </p>
                    <code v-for="path in entry.evidencePaths" :key="path">{{ path }}</code>
                    <pre v-if="entry.technicalDetail !== undefined">{{ pretty(entry.technicalDetail) }}</pre>
                  </template>
                </div>
              </details>
              <p v-if="group.truncated" class="truncate-tip">
                当前区域仅展示前 50 条，另有 {{ group.truncated }} 条已截断。
              </p>
            </details>
          </div>
          <p v-else class="placeholder">
            {{ ruleEmptyMessage }}
          </p>
        </section>

        <section v-if="view === 'issues'" class="section issues-panel">
          <div class="section-header">
            <h2>问题列表</h2><span class="muted">{{ filteredIssues.length }} 条（跨区域问题去重）</span>
          </div>
          <div class="tool-actions issue-filters">
            <select v-model="issueArea" aria-label="问题区域">
              <option value="">
                全部区域
              </option>
              <option v-for="area in allAreas" :key="area.areaCode" :value="area.areaCode">
                {{ area.areaName }} · {{ area.areaCode }}
              </option>
              <option value="__global">
                全局／未定位
              </option>
            </select>
            <select v-model="issueType" aria-label="问题类型">
              <option value="">
                全部类型
              </option><option value="field">
                字段问题
              </option><option value="rule">
                规则问题
              </option>
            </select>
            <select v-model="issueFilter" aria-label="问题级别">
              <option value="all">
                全部问题
              </option><option value="error">
                错误
              </option><option value="warning">
                警告
              </option><option value="info">
                提示
              </option><option value="skipped">
                未验证／跳过
              </option>
            </select>
            <input v-model="issueSearch" placeholder="搜索问题、字段或规则编码" aria-label="搜索问题">
          </div>
          <details v-for="group in issueGroups" :key="group.code" class="diagnostic-area" open>
            <summary><strong>{{ group.name }} <small>{{ group.code === '__global' ? '' : group.code }}</small></strong><span>本页 {{ group.items.length }} 条</span></summary>
            <div class="issue-group-content">
              <template v-for="type in ['field', 'rule']" :key="type">
                <h3 v-if="group.items.some((item) => item.type === type)">
                  {{ type === 'field' ? '字段问题' : '规则问题' }}
                </h3>
                <article v-for="item in group.items.filter((entry) => entry.type === type)" :key="item.id" class="issue-card" :class="evaluationClass(item.evaluation)">
                  <div class="issue-title">
                    <span>{{ item.evaluation.severity || item.evaluation.status }}</span><strong>{{ item.categoryLabel }}</strong><small>{{ item.evaluation.ruleId }}</small>
                  </div>
                  <p>{{ item.evaluation.summary }}</p><p v-if="item.evaluation.reason" class="muted">
                    {{ item.evaluation.reason }}
                  </p>
                  <div class="tool-actions">
                    <button v-for="target in item.targets" :key="JSON.stringify(target.selection)" @click="selectField(target.selection, true)">
                      查看字段配置 · {{ target.label }}
                    </button>
                  </div>
                  <details><summary>证据路径</summary><code v-for="path in item.evaluation.evidencePaths" :key="path">{{ path }}</code></details>
                </article>
              </template>
            </div>
          </details>
          <div v-if="filteredIssues.length > issuePageSize" class="list-pagination">
            <button :disabled="issuePage === 1" @click="issuePage -= 1">
              上一页
            </button>
            <span>第 {{ issuePage }} / {{ issuePageCount }} 页 · 每页最多 {{ issuePageSize }} 条问题</span>
            <button :disabled="issuePage === issuePageCount" @click="issuePage += 1">
              下一页
            </button>
          </div>
          <p v-if="!filteredIssues.length" class="placeholder">
            当前筛选条件下没有问题。
          </p>
        </section>

        <section v-if="view === 'travel'" class="section">
          <h2>差旅标准</h2>
          <div v-if="!snapshot?.travel" class="placeholder">
            当前实例未注册差旅 Collector。
          </div>
          <template v-else>
            <article class="travel-business-summary">
              <h3>业务摘要</h3>
              <p>{{ travelView.businessSummary.conclusion }}</p>
              <div class="prerequisite-grid">
                <div v-for="item in travelView.businessSummary.prerequisites" :key="item.label" :class="{ missing: !item.satisfied }">
                  <span>{{ item.label }}</span><strong>{{ item.value }}</strong>
                </div>
              </div>
              <p class="muted">
                已匹配 {{ travelView.businessSummary.matchedRows }} 行；未匹配 {{ travelView.businessSummary.unmatchedRows }} 行；超标准 {{ travelView.businessSummary.exceededRows }} 行。
              </p>
            </article>
            <div class="metric-grid travel-metrics">
              <article><span>当前人员</span><strong>{{ travelView.person.employeeName || '未识别' }}</strong></article>
              <article><span>行程天数</span><strong>{{ travelView.metrics.travelDays }}</strong></article>
              <article><span>标准条目</span><strong>{{ travelView.metrics.standardCount }}</strong></article>
              <article><span>请求命中</span><strong>{{ travelView.metrics.matchedRequestCount }}/{{ travelView.metrics.requestCount }}</strong></article>
            </div>

            <article class="person-card">
              <div><span>姓名</span><strong>{{ travelView.person.employeeName || '—' }}</strong></div>
              <div><span>人员 ID</span><strong>{{ travelView.person.employeeId || '—' }}</strong></div>
              <div><span>岗位</span><strong>{{ travelView.person.postName || '—' }}</strong></div>
              <div><span>岗位 ID</span><strong>{{ travelView.person.postId || '—' }}</strong></div>
            </article>

            <h3>当前人员差旅标准</h3>
            <div v-if="travelView.standards.length" class="table-scroll">
              <table class="data-table">
                <thead><tr><th>日期</th><th>地点</th><th>标准类型</th><th>标准金额</th><th>控制方式</th><th>方案</th></tr></thead>
                <tbody>
                  <tr v-for="(row, index) in travelView.standards" :key="`${row.key}-${index}`">
                    <td>{{ row.date }}</td><td>{{ row.place }}</td><td>{{ row.standardName }}</td>
                    <td>{{ amountValue(row.amount, row.currency) }}</td><td>{{ row.controlType }}</td><td>{{ row.schemeCode }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="tab-empty">
              当前人员尚未采集到差旅标准结果。
            </p>

            <h3>当前人员行程</h3>
            <div v-if="travelView.calendar.length" class="table-scroll">
              <table class="data-table">
                <thead><tr><th>日期</th><th>人员</th><th>出差地点</th><th>住宿地点</th><th>金额/补贴</th><th>标准匹配</th><th>超标准</th></tr></thead>
                <tbody>
                  <tr v-for="(row, index) in travelView.calendar" :key="`${row.date}-${index}`">
                    <td>{{ row.date }}</td><td>{{ row.employeeName }}</td><td>{{ row.travelSite }}</td><td>{{ row.staySite }}</td><td>{{ amountValue(row.amount) }}</td>
                    <td>{{ row.matchStatus === 'matched' ? amountValue(row.matchedStandardAmount) : row.matchStatus === 'unmatched' ? '未匹配' : '未验证' }}</td>
                    <td :class="{ 'text-error': (row.overAmount ?? 0) > 0 }">
                      {{ row.overAmount === undefined ? '—' : amountValue(row.overAmount) }}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="tab-empty">
              当前人员尚未采集到行程数据。
            </p>

            <h3>标准请求状态</h3>
            <div v-if="travelView.requests.length" class="table-scroll">
              <table class="data-table">
                <thead><tr><th>日期</th><th>方案</th><th>缓存键</th><th>结果</th></tr></thead>
                <tbody>
                  <tr v-for="(request, index) in travelView.requests" :key="`${request.cacheKey}-${request.boeDate}-${index}`">
                    <td>{{ request.boeDate || '—' }}</td><td>{{ request.schemeCode || '—' }}</td><td>{{ request.cacheKey || '—' }}</td>
                    <td><span class="request-status" :class="{ matched: request.matched }">{{ request.matched ? '已命中' : '未命中' }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else class="tab-empty">
              尚未采集到标准请求。
            </p>

            <details class="raw-travel-data">
              <summary>查看原始差旅数据</summary>
              <pre>{{ pretty(snapshot.travel) }}</pre>
            </details>
          </template>
        </section>

        <section v-if="view === 'runtime' && snapshot" class="section">
          <h2>运行时数据</h2>
          <h3>原始单据数据</h3><pre>{{ pretty(snapshot.runtime.rawBillData) }}</pre>
          <h3>格式化 DTO <small>({{ snapshot.runtime.formattedDtoStatus }})</small></h3><pre>{{ pretty(snapshot.runtime.formattedBoeDto) }}</pre>
        </section>

        <TracePanel
          v-show="view === 'trace'"
          :incremental="status?.capabilities?.includes('trace-incremental') ?? false"
          :values-supported="status?.capabilities?.includes('trace-values') ?? false"
          :instance-id="activeInstanceId"
          :page-id="aiWorkspace.state.source?.pageId || ''"
          :supported="Boolean(status?.capabilities?.includes('trace'))"
          @update="updateTrace"
          @analyze="analyzeTrace"
        />

        <AiPanel
          v-show="view === 'ai'"
          :active="view === 'ai'"
          :workspace="aiWorkspace"
          :refreshing="loading"
          :picker-active="pickerActive && pickerDestination === 'ai'"
          :continuous-picker="Boolean(status?.capabilities?.includes('continuous-picker'))"
          :area-picker="Boolean(status?.capabilities?.includes('area-picker'))"
          @pick="startPicker($event, 'ai')"
          @finish-picker="cancelPicker()"
          @locate="locateAiSelection"
        />
      </main>
    </div>
  </div>
</template>
