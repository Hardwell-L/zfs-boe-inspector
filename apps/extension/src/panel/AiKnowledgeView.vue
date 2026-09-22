<script setup lang="ts">
import { computed, ref } from 'vue';
import type { KnowledgeDocument } from './knowledge';
import type { KnowledgeBase } from './useKnowledgeBase';
import { formatLocalDateTime } from './time';

const props = defineProps<{ library: KnowledgeBase; locked: boolean }>();
const picker = ref<InstanceType<typeof window.HTMLInputElement>>();
const version = ref('');
const replacing = ref<KnowledgeDocument>();
const deleting = ref('');
const totalBytes = computed(() => props.library.state.documents.reduce((sum, item) => sum + item.bytes, 0));
function choose(document?: KnowledgeDocument) {
  replacing.value = document;
  if (document) version.value = document.version;
  picker.value?.click();
}
async function selected(event: InstanceType<typeof window.Event>) {
  const input = event.target as InstanceType<typeof window.HTMLInputElement>;
  const files = Array.from(input.files ?? []); input.value = '';
  if (!props.locked) await props.library.importFiles(files, version.value, replacing.value);
  replacing.value = undefined;
}
</script>

<template>
  <div class="ai-tab-page">
    <h3>本地知识库</h3>
    <p class="muted">
      Markdown 原文和索引保存在本机。导入不调用模型、不改写正文；点击发送时才发送所选片段。请另行保留原文件，卸载扩展可能清除资料。
    </p>
    <section class="ai-card">
      <p>{{ library.state.documents.length }} / 200 篇 · 原文 {{ (totalBytes / 1_000_000).toFixed(2) }} / 20 MB（不含索引）</p>
      <label>适用 BOE 版本（可选，精确版本以逗号分隔）<input v-model="version" :disabled="locked || library.state.busy" placeholder="留空时读取文档 boe_version；不支持版本范围"></label>
      <p class="muted">
        每篇最多 2 MB，每批最多 20 篇 / 10 MB。保留完整表格和代码；按标题拆分，超长章节请在原文增加子标题。
      </p>
      <input ref="picker" type="file" accept=".md,text/markdown" multiple hidden @change="selected">
      <div class="tool-actions">
        <button :disabled="locked || library.state.busy" @click="choose()">
          导入 Markdown
        </button>
        <button :disabled="locked || library.state.busy" @click="library.reload()">
          刷新列表
        </button>
        <button v-if="library.state.importing" :disabled="library.state.cancelling" @click="library.cancelImport()">
          {{ library.state.cancelling ? '正在取消…' : '取消导入' }}
        </button>
      </div>
      <p v-if="library.state.busy" role="status">
        {{ library.state.progress || '正在读取知识库…' }}
      </p>
      <p v-if="library.state.error" class="error-banner" role="alert">
        {{ library.state.error }}
      </p>
      <ul v-if="library.state.reports.length">
        <li v-for="report in library.state.reports" :key="report">
          {{ report }}
        </li>
      </ul>
    </section>
    <p v-if="library.state.ready && !library.state.documents.length">
      尚未导入文档。支持普通 Markdown 和简单的 title / source / boe_version 元信息。
    </p>
    <article v-for="document in library.state.documents" :key="document.id" class="ai-card">
      <h4>{{ document.title }}</h4>
      <p>{{ document.name }} · {{ document.sections }} 章节 · {{ (document.bytes / 1000).toFixed(1) }} KB</p>
      <p>适用版本：{{ document.version || '未知，使用时需核对' }} · 导入：{{ formatLocalDateTime(document.importedAt) }}</p>
      <p v-if="document.source" class="muted">
        来源：{{ document.source }}
      </p>
      <ul v-if="document.warnings.length" class="warnings">
        <li v-for="warning in document.warnings" :key="warning">
          {{ warning }}
        </li>
      </ul>
      <div class="tool-actions">
        <button :disabled="locked || library.state.busy" @click="choose(document)">
          选择文件更新
        </button>
        <button :disabled="locked || library.state.busy" @click="deleting = document.id">
          删除
        </button>
        <template v-if="deleting === document.id">
          <span>删除本机原文和索引？</span>
          <button :disabled="locked || library.state.busy" @click="library.remove(document); deleting = ''">
            确认删除
          </button>
          <button @click="deleting = ''">
            取消
          </button>
        </template>
      </div>
    </article>
  </div>
</template>
