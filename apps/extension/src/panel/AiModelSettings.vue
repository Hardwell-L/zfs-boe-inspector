<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { aiEndpoint, fetchAiModels, REASONING_EFFORTS } from './aiClient';
import type { AiWorkspace } from './useAiWorkspace';
import DismissibleNotice from './DismissibleNotice.vue';
const props = defineProps<{ workspace: AiWorkspace; active: boolean }>();
const state = props.workspace.state;
const models = ref<string[]>([]);
const query = ref('');
const visibleCount = ref(50);
const loading = ref(false);
const listNote = ref('');
let controller: InstanceType<typeof window.AbortController> | undefined;
const matching = computed(() => {
  const search = query.value.trim().toLowerCase();
  return models.value.filter((id) => id.toLowerCase().includes(search));
});
const visibleModels = computed(() => matching.value.slice(0, visibleCount.value));
const requestAddress = computed(() => {
  try { return { value: aiEndpoint(state.settings), error: '' }; }
  catch (error) { return { value: '', error: error instanceof Error ? error.message : String(error) }; }
});
const deepseek = computed(() => {
  try { return new URL(state.settings.baseUrl).origin === 'https://api.deepseek.com'; } catch { return false; }
});
const requestLimitKb = computed({
  get: () => Math.round(state.settings.maxRequestBytes / 1000),
  set: (value: number) => { state.settings.maxRequestBytes = Math.round(value * 1000); },
});
function cancelModels() { controller?.abort(); controller = undefined; loading.value = false; }
watch(() => [state.settings.baseUrl, state.settings.addressMode, state.settings.key], () => {
  cancelModels(); models.value = []; listNote.value = ''; query.value = ''; visibleCount.value = 50;
}, { flush: 'sync' });
watch(query, () => { visibleCount.value = 50; });
async function loadModels() {
  if (loading.value || props.workspace.busy) return;
  const current = new window.AbortController(); controller = current; loading.value = true; listNote.value = '';
  try {
    const result = await fetchAiModels({ ...state.settings }, current.signal);
    if (controller !== current) return;
    models.value = result; visibleCount.value = 50;
    listNote.value = result.length ? `已获取 ${result.length} 个模型；列表可见不代表支持当前接口协议。` : '服务返回空列表，可手动填写模型标识。';
  } catch (error) {
    if (controller === current) listNote.value = `${error instanceof Error ? error.message : String(error)}；可继续手动填写模型标识。`;
  } finally { if (controller === current) { controller = undefined; loading.value = false; } }
}
onBeforeUnmount(cancelModels);
</script>

<template>
  <h3>模型设置</h3>
  <p class="muted">
    支持 OpenAI 官方及兼容服务。测试仅发送简短问题，不发送单据证据。
  </p>
  <section class="ai-card ai-model-card">
    <div class="ai-settings">
      <label>接口协议<select v-model="state.settings.protocol" :disabled="workspace.busy"><option value="chat">Chat Completions</option><option value="responses">Responses</option></select></label>
      <label>Base URL<input v-model="state.settings.baseUrl" :disabled="workspace.busy" placeholder="https://api.openai.com 或兼容服务地址"></label>
      <label>地址拼接<select v-model="state.settings.addressMode" :disabled="workspace.busy"><option value="auto">自动</option><option value="v1">补充 /v1</option><option value="preserve">按原路径</option></select></label>
      <p class="muted">
        自动模式为纯域名补充 /v1（DeepSeek 官方除外），已有路径保持不变；完整接口地址会先提取服务根路径。
      </p>
      <p v-if="requestAddress.value" class="ai-endpoint">
        最终请求地址：<code>{{ requestAddress.value }}</code>
      </p>
      <p v-else class="error-banner" role="alert">
        {{ requestAddress.error }}
      </p>
      <label>API Key<input v-model="state.settings.key" :disabled="workspace.busy" type="password" autocomplete="off"></label>
      <label>模型标识<input v-model="state.settings.model" :disabled="workspace.busy" placeholder="可手动填写，或从下方模型列表选择"></label>
      <div v-if="deepseek" class="tool-actions">
        <button :disabled="workspace.busy" @click="state.settings.model = 'deepseek-v4-flash'">
          DeepSeek V4 Flash
        </button>
        <button :disabled="workspace.busy" @click="state.settings.model = 'deepseek-v4-pro'">
          DeepSeek V4 Pro
        </button>
      </div>
      <div class="tool-actions">
        <button :disabled="workspace.busy || loading || !state.settings.key.trim() || !requestAddress.value" @click="loadModels">
          {{ loading ? '获取中…' : '获取模型' }}
        </button>
        <button v-if="loading" @click="cancelModels">
          取消获取
        </button>
      </div>
      <p v-if="listNote" class="muted" role="status">
        {{ listNote }}
      </p>
      <template v-if="models.length">
        <label>搜索已获取模型<input v-model="query" type="search" placeholder="按模型标识搜索"></label>
        <div class="ai-model-results" aria-label="可选模型">
          <button v-for="model in visibleModels" :key="model" :disabled="workspace.busy" :aria-pressed="state.settings.model === model" @click="state.settings.model = model">
            {{ model }}
          </button>
        </div>
        <p class="muted">
          显示 {{ visibleModels.length }} / {{ matching.length }} 个匹配模型
        </p>
        <button v-if="matching.length > visibleCount" @click="visibleCount += 50">
          显示更多
        </button>
      </template>
      <label>推理强度<select v-model="state.settings.reasoningEffort" :disabled="workspace.busy"><option v-for="effort in REASONING_EFFORTS" :key="effort" :value="effort">{{ effort === 'default' ? '服务默认（不发送参数）' : effort === 'none' ? 'none（关闭推理，需模型支持）' : effort }}</option></select></label>
      <p class="muted">
        不同模型支持的强度不同；高强度可能增加响应时间和 token 消耗。默认不发送推理参数，设置不会自动降级。
      </p>
      <label><input v-model="state.settings.remember" :disabled="workspace.busy" type="checkbox">记住本机 Key（扩展存储不提供加密保险库）</label>
      <section class="ai-advanced-settings">
        <h4>高级设置</h4>
        <label v-if="state.settings.protocol === 'chat'">Chat 输出上限参数<select v-model="state.settings.chatTokenMode" :disabled="workspace.busy"><option value="auto">自动（OpenAI 官方使用 max_completion_tokens）</option><option value="max_tokens">max_tokens</option><option value="max_completion_tokens">max_completion_tokens</option></select></label>
        <p v-if="state.settings.protocol === 'chat'" class="muted">
          自动模式下其他服务使用 max_tokens；GPT 中转如不接受该参数，请选择 max_completion_tokens。
        </p>
        <label>生成 token 上限<input v-model.number="state.settings.maxTokens" :disabled="workspace.busy" type="number" min="128" max="65536" step="128"></label>
        <p class="muted">
          默认 4096；推理模型可能将思考 token 计入上限，达到上限后可手动继续生成。实际支持范围取决于模型。
        </p>
        <label>请求体上限（KB）<input v-model.number="requestLimitKb" :disabled="workspace.busy" type="number" min="32" max="2000" step="1"></label>
        <p class="muted">
          默认 150 KB；范围 32–2000 KB，仅限制发送的请求 JSON 大小。
        </p>
      </section>
      <div class="ai-settings-actions">
        <button :disabled="workspace.busy" @click="workspace.save()">
          保存设置
        </button>
        <div class="ai-test-action">
          <button :disabled="workspace.busy" @click="workspace.test()">
            {{ state.test.status === 'testing' ? '测试中…' : '测试模型' }}
          </button>
          <DismissibleNotice v-if="state.test.status !== 'idle'" :auto-close-ms="state.test.status === 'success' ? 3000 : 0" :active="active" :notice-key="`${state.test.status}:${state.test.message}`" class="ai-test-status" :class="`is-${state.test.status}`">
            {{ state.test.message }}
          </DismissibleNotice>
        </div>
        <button :disabled="workspace.busy" @click="workspace.save(true)">
          清除 Key
        </button>
      </div>
      <DismissibleNotice v-if="state.settingsNote" :auto-close-ms="3000" :active="active" :notice-key="state.settingsNote" class="muted" @close="state.settingsNote = ''">
        {{ state.settingsNote }}
      </DismissibleNotice>
      <DismissibleNotice v-if="state.settingsError" :notice-key="state.settingsError" class="error-banner" role="alert" @close="state.settingsError = ''">
        {{ state.settingsError }}
      </DismissibleNotice>
    </div>
  </section>
</template>

<style scoped>
.ai-settings { overflow-wrap: anywhere; }
.ai-settings, .ai-settings > *, .ai-settings label, .ai-settings input, .ai-settings select { min-width: 0; }
.ai-endpoint { overflow-wrap: anywhere; }
.ai-model-results { display: grid; gap: 6px; max-height: 240px; overflow-y: auto; }
.ai-model-results button { text-align: left; overflow-wrap: anywhere; }
.ai-model-results button[aria-pressed="true"] { border-color: #3158cd; background: #eef3ff; }
</style>
