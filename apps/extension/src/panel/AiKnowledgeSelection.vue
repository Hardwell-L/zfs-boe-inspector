<script setup lang="ts">
import { computed, ref } from 'vue';
import type { AiSession, AiWorkspace } from './useAiWorkspace';
import type { KnowledgeHit } from './knowledge';
import AiMarkdown from './AiMarkdown';

const props = defineProps<{ workspace: AiWorkspace; session: AiSession; locked: boolean }>();
const emit = defineEmits<{ manage: [] }>();
const selected = computed(() => props.session.knowledgeHits.filter((hit) => hit.included).length);
function relatedSections(hit: KnowledgeHit) {
  return (hit.relatedIds ?? []).map((id) => props.session.knowledgeHits.find((item) => item.id === id));
}
const selectedGaps = computed(() => props.session.knowledgeHits.filter((hit) => hit.included).reduce((sum, hit) =>
  sum + (hit.unresolvedReferences?.length ?? 0) + relatedSections(hit).filter((item) => !item?.included).length, 0));
const expanded = ref(new Set<string>());
function toggleDetails(event: InstanceType<typeof window.Event>, id: string) {
  if ((event.target as InstanceType<typeof window.HTMLDetailsElement>).open) expanded.value.add(id);
  else expanded.value.delete(id);
}
function updateQuery(event: InstanceType<typeof window.Event>) {
  props.workspace.setKnowledgeQuery(props.session, (event.target as InstanceType<typeof window.HTMLInputElement>).value);
}
</script>

<template>
  <section class="ai-card">
    <h3>参考文档</h3>
    <label><input :checked="session.knowledgeEnabled" type="checkbox" :disabled="locked" @change="workspace.setKnowledgeEnabled(session, !session.knowledgeEnabled)">本次会话使用本地知识库</label>
    <button @click="emit('manage')">
      管理文档
    </button>
    <template v-if="session.knowledgeEnabled">
      <p class="muted">
        按问题、配置键与 BOE 版本检索。候选原文仅供核对；实际发送内容会脱敏，点击发送后直接交给模型。图片、外链内容不会自动读取。
      </p>
      <label>补充检索词（可选，替代问题关键词）<input :value="session.knowledgeQuery" :disabled="locked" placeholder="例如 computed、默认值、配置优先级" @input="updateQuery"></label>
      <button :disabled="locked" @click="workspace.findKnowledge(session)">
        检索 / 恢复推荐选择
      </button>
      <p v-if="session.knowledgeNote" role="status">
        {{ session.knowledgeNote }}
      </p>
      <p v-if="workspace.knowledgeStale(session)" class="warnings">
        尚未检索，或问题、配置、文档已变化；发送时会重新检索并恢复推荐选择。
      </p>
      <p>已选 {{ selected }} 个章节 · {{ (workspace.knowledgeBytes(session) / 1000).toFixed(1) }} / 20 KB</p>
      <p v-if="selectedGaps" class="warnings">
        已选资料有 {{ selectedGaps }} 处关联未展开或未选入，会随请求标明缺口；可通过补充检索词查找相关章节。
      </p>
      <details v-for="hit in session.knowledgeHits" :key="hit.id" class="ai-knowledge-hit" @toggle="toggleDetails($event, hit.id)">
        <summary>{{ hit.relatedOnly ? '关联 · ' : '' }}{{ hit.title }} · {{ hit.heading }}</summary>
        <label><input :checked="hit.included" type="checkbox" :disabled="locked" @change="workspace.toggleKnowledgeHit(session, hit.id)">发送这个完整章节</label>
        <p class="muted">
          {{ hit.reasons.join('；') }} · 适用版本：{{ hit.version || '未知' }} · 原文第 {{ hit.line }} 行
        </p>
        <p v-if="hit.source" class="muted">
          来源：{{ hit.source }}
        </p>
        <ul v-if="hit.relatedIds?.length">
          <li v-for="(related, index) in relatedSections(hit)" :key="hit.relatedIds[index]">
            关联：{{ related?.heading || '正文缺失' }}（{{ related?.included ? '已选入' : '未选入' }}）
          </li>
        </ul>
        <p v-if="hit.unresolvedReferences?.length" class="warnings">
          未完整展开：{{ hit.unresolvedReferences.join('；') }}
        </p>
        <AiMarkdown v-if="expanded.has(hit.id)" :text="hit.text" :citations-enabled="false" />
      </details>
    </template>
  </section>
</template>
