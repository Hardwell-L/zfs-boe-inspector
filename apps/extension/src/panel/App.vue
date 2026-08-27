<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { buildTravelView, runInspection } from '@zfs-boe-inspector/core';
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

type ViewKey = 'overview' | 'fields' | 'issues' | 'travel' | 'runtime' | 'about';
type PropertyTab = 'base' | 'advance' | 'data' | 'raw';

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
let pickerTimer: ReturnType<typeof setInterval> | undefined;

const navItems: Array<{ key: ViewKey; label: string }> = [
  { key: 'overview', label: '单据概览' },
  { key: 'fields', label: '字段配置' },
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
      <p>请按项目接入文档在 main.js、billTemplate.vue 和差旅 wrapper 中注册 Inspector。</p>
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
                <thead><tr><th>日期</th><th>人员</th><th>出差地点</th><th>住宿地点</th><th>金额/补贴</th></tr></thead>
                <tbody>
                  <tr v-for="(row, index) in travelView.calendar" :key="`${row.date}-${index}`">
                    <td>{{ row.date }}</td><td>{{ row.employeeName }}</td><td>{{ row.travelSite }}</td><td>{{ row.staySite }}</td><td>{{ amountValue(row.amount) }}</td>
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
