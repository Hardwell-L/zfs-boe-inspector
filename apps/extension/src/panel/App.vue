<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  buildRuleDiagnostics,
  buildTravelView,
  runInspection,
  type RuleDiagnosticEntry,
} from '@zfs-boe-inspector/core';
import { baseRuleEvaluators } from '@zfs-boe-inspector/rule-base';
import type {
  AreaDetail,
  BoeInspectionSnapshot,
  BridgeStatus,
  FieldDetail,
  FieldSelection,
  InspectionReport,
  JsonValue,
  RuleEvaluation,
} from '@zfs-boe-inspector/shared-types';
import { pageBridge } from './bridge';

type ViewKey = 'overview' | 'fields' | 'rules' | 'issues' | 'travel' | 'runtime' | 'about';
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
const pickerActive = ref(false);
const ruleTab = ref<RuleTab>('validation');
const onlyRuleIssues = ref(false);
const showRuleTechnical = ref(false);
let pickerTimer: ReturnType<typeof setInterval> | undefined;

const navItems: Array<{ key: ViewKey; label: string }> = [
  { key: 'overview', label: '单据概览' },
  { key: 'fields', label: '字段配置' },
  { key: 'rules', label: '规则诊断' },
  { key: 'issues', label: '问题列表' },
  { key: 'travel', label: '差旅标准' },
  { key: 'runtime', label: '运行时数据' },
  { key: 'about', label: 'AI 预留' },
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

const areas = computed(() => (snapshot.value?.config.template ?? []).flatMap((value, areaIndex) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const area = value as Record<string, any>;
  const fields = Array.isArray(area.areaFields) ? area.areaFields : [];
  const keyword = fieldSearch.value.trim().toLowerCase();
  const matchedFields = fields.filter((field: Record<string, any>) => {
    if (!keyword) return true;
    return [field.fieldCode, field.fieldName, field.labelCode, field.fieldType]
      .some((item) => String(item ?? '').toLowerCase().includes(keyword));
  });
  if (matchedFields.length === 0) return [];
  return [{ areaIndex, areaCode: String(area.areaCode ?? ''), areaName: String(area.areaName ?? area.areaCode ?? ''), fields: matchedFields }];
}));

const filteredEvaluations = computed(() => (report.value?.evaluations ?? []).filter((item) => {
  if (issueFilter.value === 'all') return item.status === 'issue';
  if (issueFilter.value === 'skipped') return item.status === 'skipped';
  return item.status === 'issue' && item.severity === issueFilter.value;
}));

const propertyTabs = computed(() => selectedArea.value ? areaTabs : fieldTabs);
const activePropertyGroup = computed(() => (selectedArea.value?.groups ?? selectedField.value?.groups)
  ?.find(({ key }) => key === propertyTab.value));
const travelView = computed(() => buildTravelView(snapshot.value?.travel));
const ruleDiagnostics = computed(() => snapshot.value ? buildRuleDiagnostics(snapshot.value) : undefined);
const activeRuleModel = computed(() => ruleDiagnostics.value?.[ruleTab.value]);
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
  loading.value = true;
  error.value = '';
  try {
    status.value = await pageBridge.getStatus();
    if (!status.value.connected) {
      snapshot.value = undefined;
      report.value = undefined;
      return;
    }
    activeInstanceId.value = activeInstanceId.value || status.value.activeInstanceId || status.value.instances[0]?.instanceId || '';
    snapshot.value = await pageBridge.getSnapshot(activeInstanceId.value || undefined);
    report.value = runInspection(snapshot.value, baseRuleEvaluators);
    if (selectedArea.value) {
      selectedArea.value = await pageBridge.getAreaDetail(selectedArea.value.areaCode, activeInstanceId.value);
    }
    if (selectedField.value) {
      selectedField.value = await pageBridge.getFieldDetail(selectedField.value.selection, activeInstanceId.value);
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    loading.value = false;
  }
}

async function changeInstance() {
  selectedArea.value = undefined;
  selectedField.value = undefined;
  propertyTab.value = 'base';
  await refresh();
}

async function selectArea(areaCode: string) {
  try {
    const detail = await pageBridge.getAreaDetail(areaCode, activeInstanceId.value);
    if (!detail) throw new Error(`未找到区域配置：${areaCode}`);
    selectedArea.value = detail;
    selectedField.value = undefined;
    propertyTab.value = 'base';
    await nextTick();
    document.querySelector('.property-panel')?.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

async function selectField(selection: FieldSelection, navigate = false) {
  try {
    const detail = await pageBridge.getFieldDetail(selection, activeInstanceId.value);
    if (!detail) throw new Error(`未找到字段配置：${selection.areaCode}.${selection.fieldCode}`);
    selectedArea.value = undefined;
    selectedField.value = detail;
    propertyTab.value = 'base';
    if (navigate) {
      fieldSearch.value = '';
      view.value = 'fields';
      await nextTick();
      window.requestAnimationFrame(() => {
        const fieldItem = Array.from(document.querySelectorAll('.field-item')).find((element) => (
          element instanceof window.HTMLElement
          && element.dataset.areaCode === detail.selection.areaCode
          && element.dataset.fieldCode === detail.selection.fieldCode
        ));
        fieldItem?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const propertyPanel = document.querySelector('.property-panel');
        if (propertyPanel instanceof window.HTMLElement) {
          propertyPanel.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
    }
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

async function startPicker() {
  try {
    error.value = '';
    await pageBridge.startFieldPicker();
    pickerActive.value = true;
    if (pickerTimer) clearInterval(pickerTimer);
    pickerTimer = setInterval(async () => {
      try {
        const pickerState = await pageBridge.getFieldPickerState();
        pickerActive.value = pickerState.active;
        if (!pickerState.active) {
          if (pickerTimer) clearInterval(pickerTimer);
          pickerTimer = undefined;
          if (pickerState.selection) await selectField(pickerState.selection, true);
          if (pickerState.error) error.value = pickerState.error;
        }
      } catch (reason) {
        pickerActive.value = false;
        if (pickerTimer) clearInterval(pickerTimer);
        pickerTimer = undefined;
        error.value = reason instanceof Error ? reason.message : String(reason);
      }
    }, 180);
  } catch (reason) {
    pickerActive.value = false;
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}

async function cancelPicker() {
  await pageBridge.cancelFieldPicker();
  pickerActive.value = false;
  if (pickerTimer) clearInterval(pickerTimer);
  pickerTimer = undefined;
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

async function locateDiagnostic(entry: RuleDiagnosticEntry) {
  if (!entry.areaCode || !entry.fieldCode) return;
  await selectField({ areaCode: entry.areaCode, fieldCode: entry.fieldCode, rowIndex: entry.rowIndex ?? 0 }, true);
}

function propertyValue(value: JsonValue | undefined) {
  if (value === undefined) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function amountValue(value: number | string | undefined, currency = '') {
  if (value === undefined || value === '') return '—';
  return `${value}${currency && currency !== '—' ? ` ${currency}` : ''}`;
}

onMounted(refresh);
onBeforeUnmount(() => {
  if (pickerTimer) clearInterval(pickerTimer);
  if (pickerActive.value) void pageBridge.cancelFieldPicker();
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
        <select v-if="status?.instances.length" v-model="activeInstanceId" @change="changeInstance">
          <option v-for="instance in status.instances" :key="instance.instanceId" :value="instance.instanceId">
            {{ instance.instanceId }}
          </option>
        </select>
        <button :disabled="loading" @click="refresh">
          {{ loading ? '读取中…' : '刷新快照' }}
        </button>
        <button
          v-if="!pickerActive"
          class="picker-toolbar-button"
          :disabled="!status?.connected"
          @click="startPicker"
        >
          选择页面字段
        </button>
        <button v-else class="picker-toolbar-button danger" @click="cancelPicker">
          取消选择
        </button>
        <button :disabled="!report" @click="exportReport">
          导出报告
        </button>
      </div>
    </header>

    <div v-if="error" class="error-banner">
      {{ error }}
    </div>
    <div v-if="!status?.connected && !loading" class="empty-state">
      <h2>尚未检测到 BOE Runtime Adapter</h2>
      <p>请安装 Adapter，并按项目接入文档在 local billTemplate.vue 中注册 Inspector；标准差旅会自动注册。</p>
    </div>

    <div v-else class="workspace">
      <nav class="sidebar">
        <button v-for="item in navItems" :key="item.key" :class="{ active: view === item.key }" @click="view = item.key">
          {{ item.label }}
          <span v-if="item.key === 'issues' && report" class="count">{{ report.summary.issues }}</span>
        </button>
      </nav>

      <main class="content">
        <section v-if="view === 'overview' && snapshot" class="section">
          <h2>单据概览</h2>
          <div class="metric-grid">
            <article><span>项目</span><strong>{{ snapshot.meta.projectCode }}</strong></article>
            <article><span>环境</span><strong>{{ snapshot.meta.environment }}</strong></article>
            <article><span>BOE 类型</span><strong>{{ snapshot.meta.boeTypeCode || '—' }}</strong></article>
            <article><span>单据状态</span><strong>{{ snapshot.meta.boeStatus || '—' }}</strong></article>
            <article><span>字段数量</span><strong>{{ areas.reduce((sum, area) => sum + area.fields.length, 0) }}</strong></article>
            <article><span>诊断问题</span><strong>{{ report?.summary.issues ?? 0 }}</strong></article>
          </div>
          <h3>版本信息</h3>
          <pre>{{ pretty({ adapter: snapshot.meta.adapterVersion, vue: snapshot.meta.vueVersion, zfs: snapshot.meta.zfsPackages, schemaVersion: snapshot.schemaVersion }) }}</pre>
          <div v-if="snapshot.warnings?.length" class="warnings">
            <p v-for="warning in snapshot.warnings" :key="warning">
              {{ warning }}
            </p>
          </div>
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
                :key="field.fieldCode"
                class="field-item"
                :data-area-code="area.areaCode"
                :data-field-code="field.fieldCode"
                :class="{ active: selectedField?.selection.areaCode === area.areaCode && selectedField?.selection.fieldCode === field.fieldCode }"
                @click="selectField({ areaCode: area.areaCode, fieldCode: field.fieldCode, rowIndex: 0 })"
              >
                <span>{{ field.fieldName || field.fieldCode }}</span>
                <small>{{ field.fieldCode }} · {{ field.fieldType }}</small>
              </button>
            </div>
          </aside>
          <section class="property-panel">
            <div v-if="pickerActive" class="picker-tip">
              请在被检查页面中点击一个 BOE 字段，按 Esc 可取消。
            </div>
            <div v-if="!selectedArea && !selectedField" class="placeholder">
              从左侧列表选择区域或字段，也可以使用“选择页面字段”。
            </div>
            <template v-else-if="selectedField">
              <h2>{{ (selectedField.field as any).fieldName || selectedField.selection.fieldCode }}</h2>
              <p class="muted">
                {{ selectedField.selection.areaCode }}.{{ selectedField.selection.fieldCode }} · 第 {{ selectedField.selection.rowIndex + 1 }} 行
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
                    <dt :title="item.tips">
                      {{ item.label }}
                    </dt>
                    <dd>{{ propertyValue(item.value) }}</dd>
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
                只解析配置与已有运行态证据，不执行校验、计算或关联申请转换。
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
            <article><span>未验证</span><strong>{{ activeRuleModel.metrics.unverified }}</strong></article>
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
                  <span class="diagnostic-status">{{ entry.state === 'issue' ? '问题' : entry.state === 'unverified' ? '未验证' : '已观察' }}</span>
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
                  <p>{{ entry.detail }}</p>
                  <p v-if="entry.dependencies?.length" class="muted">
                    依赖：{{ entry.dependencies.join('、') }}
                  </p>
                  <dl v-if="entry.currentValues && Object.keys(entry.currentValues).length" class="value-list">
                    <template v-for="(value, key) in entry.currentValues" :key="key">
                      <dt>{{ key }}</dt><dd>{{ propertyValue(value) }}</dd>
                    </template>
                  </dl>
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
            {{ onlyRuleIssues ? '当前分类没有确定性问题。' : '当前模板没有此类规则配置。' }}
          </p>
        </section>

        <section v-if="view === 'issues'" class="section">
          <div class="section-header">
            <h2>问题列表</h2>
            <select v-model="issueFilter">
              <option value="all">
                全部问题
              </option>
              <option value="error">
                Error
              </option>
              <option value="warning">
                Warning
              </option>
              <option value="info">
                Info
              </option>
              <option value="skipped">
                Skipped
              </option>
            </select>
          </div>
          <article v-for="evaluation in filteredEvaluations" :key="`${evaluation.ruleId}-${evaluation.summary}`" class="issue-card" :class="evaluationClass(evaluation)">
            <div class="issue-title">
              <span>{{ evaluation.severity || evaluation.status }}</span><strong>{{ evaluation.ruleId }}</strong>
            </div>
            <p>{{ evaluation.summary }}</p>
            <p v-if="evaluation.reason" class="muted">
              {{ evaluation.reason }}
            </p>
            <code v-for="path in evaluation.evidencePaths" :key="path">{{ path }}</code>
          </article>
          <p v-if="filteredEvaluations.length === 0" class="placeholder">
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

        <section v-if="view === 'about'" class="section">
          <h2>AI 能力预留</h2>
          <p>首版仅冻结 <code>ModelProvider</code>、上下文和结构化结果协议，不保存 API Key，也不会向任何模型服务发送 BOE 数据。</p>
          <p>确定性规则是正式诊断结果；未来 AI 结果只作为独立建议展示，不能修改单据或配置。</p>
        </section>
      </main>
    </div>
  </div>
</template>
