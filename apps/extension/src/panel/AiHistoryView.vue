<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AiHistory } from './aiHistory';
import { formatLocalDateTime } from './time';
import AiMarkdown from './AiMarkdown';
import DismissibleNotice from './DismissibleNotice.vue';

const props = defineProps<{ entries: AiHistory[]; loading: boolean; saving: boolean; unsaved: number; deleting: string }>();
defineEmits<{ refresh: []; retry: []; delete: [id: string] }>();
const selectedId = ref('');
const query = ref('');
const note = ref('');
const confirmDeleteId = ref('');
const entries = computed(() => [...props.entries].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter((item) => {
  const text = query.value.trim().toLowerCase();
  return !text || item.title.toLowerCase().includes(text) || item.messages.some((message) => `${message.question.text}\n${message.answer.text}`.toLowerCase().includes(text));
}));
const selected = computed(() => entries.value.find((item) => item.id === selectedId.value) ?? entries.value[0]);
watch(() => selected.value?.id, () => { confirmDeleteId.value = ''; });
const statusLabels = { complete: '', length: '达到输出上限', stopped: '未完成或已停止', error: '生成失败，保留已收到的内容' };
async function copy(text: string) {
  note.value = '';
  try { await window.navigator.clipboard.writeText(text); note.value = '已复制'; }
  catch { note.value = '复制失败，请手动选择文本'; }
}
</script>

<template>
  <div class="ai-tab-page ai-history-page">
    <h3>问答历史</h3>
    <p class="muted">
      本机保存问题与回答，不保存快照、证据、请求体或 Key。历史仅供阅读，引用编号无对应证据，不参与当前分析。
    </p>
    <div class="ai-history-toolbar">
      <input v-model="query" type="search" aria-label="搜索问答历史" placeholder="搜索会话、问题或回答">
      <button :disabled="loading || saving || Boolean(deleting)" @click="$emit('refresh')">
        刷新历史
      </button>
      <button v-if="unsaved" :disabled="saving || Boolean(deleting)" @click="$emit('retry')">
        重试保存（{{ unsaved }}）
      </button>
    </div>
    <DismissibleNotice v-if="note" :auto-close-ms="note === '已复制' ? 3000 : 0" :notice-key="note" class="muted" @close="note = ''">
      {{ note }}
    </DismissibleNotice>
    <p v-if="loading" class="muted">
      正在读取本机历史…
    </p>
    <p v-else-if="!entries.length" class="muted">
      {{ query.trim() ? '没有匹配的问答。' : '尚无已保存的问答；发送问题后自动保存。' }}
    </p>
    <div v-if="selected" class="ai-history-layout">
      <nav class="ai-history-list" aria-label="历史会话">
        <button v-for="entry in entries" :key="entry.id" :class="{ active: selected.id === entry.id }" :aria-current="selected.id === entry.id ? 'true' : undefined" @click="selectedId = entry.id; note = ''">
          <strong>{{ entry.title }}</strong>
          <small>{{ formatLocalDateTime(entry.updatedAt) }} · {{ entry.messages.length }} 轮</small>
        </button>
      </nav>
      <section class="ai-history-detail" :aria-label="selected.title">
        <h3>{{ selected.title }}</h3>
        <button :disabled="loading || saving || Boolean(deleting)" @click="confirmDeleteId = selected.id">
          删除此会话历史
        </button>
        <div v-if="confirmDeleteId === selected.id" class="warnings" role="alert">
          <p>确定删除“{{ selected.title }}”的全部问答历史？删除后无法恢复。当前对话仍可阅读，但该会话将停止保存历史；新会话正常保存。</p>
          <div class="tool-actions">
            <button :disabled="Boolean(deleting)" @click="$emit('delete', selected.id)">
              {{ deleting === selected.id ? '正在删除…' : '确认删除' }}
            </button>
            <button :disabled="Boolean(deleting)" @click="confirmDeleteId = ''">
              取消
            </button>
          </div>
        </div>
        <article v-for="message in selected.messages" :key="message.id" class="ai-answer">
          <div class="ai-question">
            <span class="ai-message-label">你 · {{ formatLocalDateTime(message.question.createdAt) }}</span>
            <p>{{ message.question.text }}</p>
            <button @click="copy(message.question.text)">
              复制问题
            </button>
          </div>
          <div class="ai-response">
            <span class="ai-message-label">{{ message.model }}</span>
            <AiMarkdown :text="message.answer.text || '尚未收到回答正文'" :citations-enabled="false" />
            <p v-if="statusLabels[message.answer.status]" class="muted">
              {{ statusLabels[message.answer.status] }}
            </p>
            <button :disabled="!message.answer.text" @click="copy(message.answer.text)">
              复制回答
            </button>
          </div>
        </article>
      </section>
    </div>
  </div>
</template>
