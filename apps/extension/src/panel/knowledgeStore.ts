import { KNOWLEDGE_LIMITS, knowledgeReferences, matchesKnowledgeReference, scoreKnowledge, type KnowledgeDocument, type KnowledgeHit, type KnowledgeIndex, type knowledgeQuery } from './knowledge';
import { parseKnowledgeInWorker } from './knowledgeWorkerClient';

const DATABASE = 'boe-inspector-knowledge-v1';
const STORES = ['documents', 'originals', 'indexes', 'chunks'];
async function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = window.indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('documents', { keyPath: 'id' });
      db.createObjectStore('originals', { keyPath: 'id' });
      db.createObjectStore('indexes', { keyPath: 'id' }).createIndex('documentId', 'documentId');
      db.createObjectStore('chunks', { keyPath: 'id' }).createIndex('documentId', 'documentId');
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(new Error('无法打开本地知识库，请检查浏览器存储权限'));
    request.onblocked = () => { blocked = true; reject(new Error('知识库存储升级被其他面板阻塞，请关闭其他 Inspector 面板后重试')); };
  });
}

async function transaction<T>(stores: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void, fail: (reason: string) => void) => void, signal?: AbortSignal): Promise<T> {
  const db = await openDatabase();
  try {
    if (signal?.aborted) throw new Error('已取消知识库操作');
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let value: T; let failure = '';
      const cancel = () => {
        failure = '已取消知识库操作';
        try { tx.abort(); } catch { /* 已提交的事务交由 oncomplete 返回，不撤销已完成文件。 */ }
      };
      const cleanup = () => signal?.removeEventListener('abort', cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      tx.oncomplete = () => { cleanup(); resolve(value); };
      tx.onabort = () => { cleanup(); reject(new Error(failure || '知识库存储操作失败（可能空间不足），原记录已保留')); };
      tx.onerror = () => { /* abort 统一报告，事务保证原子性。 */ };
      try { run(tx, (result) => { value = result; }, (reason) => { failure = reason; tx.abort(); }); }
      catch (reason) { failure = reason instanceof Error ? reason.message : String(reason); tx.abort(); }
    });
  } finally { db.close(); }
}

export function listKnowledge(): Promise<KnowledgeDocument[]> {
  return transaction(['documents'], 'readonly', (tx, done) => {
    const request = tx.objectStore('documents').getAll();
    request.onsuccess = () => done((request.result as KnowledgeDocument[]).sort((a, b) => b.importedAt.localeCompare(a.importedAt)));
  });
}

function removeSections(tx: IDBTransaction, id: string) {
  for (const name of ['indexes', 'chunks']) {
    const keys = tx.objectStore(name).index('documentId').getAllKeys(id);
    keys.onsuccess = () => {
      for (const key of keys.result) tx.objectStore(name).delete(key);
    };
  }
}

export async function importKnowledge(file: File, version: string, replacing?: KnowledgeDocument, signal: AbortSignal = new window.AbortController().signal): Promise<string> {
  if (!/\.md$/i.test(file.name)) throw new Error('仅支持 .md 文件');
  if (!file.size || file.size > KNOWLEDGE_LIMITS.fileBytes) throw new Error('文件须非空且不超过 2 MB');
  // 更新使用新的章节命名空间，避免旧章节游标删除新记录。
  const sectionNamespace = window.crypto.randomUUID();
  const id = replacing?.id ?? sectionNamespace;
  const { text, hash, parsed } = await parseKnowledgeInWorker(file, sectionNamespace, version, signal);
  const entry: KnowledgeDocument = { id, hash, name: file.name, title: parsed.title, source: parsed.source, version: parsed.version,
    importedAt: new Date().toISOString(), bytes: file.size, sections: parsed.sections.length, warnings: parsed.warnings };
  return transaction(STORES, 'readwrite', (tx, done, fail) => {
    const request = tx.objectStore('documents').getAll();
    request.onsuccess = () => {
      const documents = request.result as KnowledgeDocument[];
      const old = documents.find((item) => item.id === id);
      if (replacing && (old?.hash !== replacing.hash || old.version !== replacing.version)) { fail('文档已在其他面板更新或删除，请刷新列表后重试'); return; }
      if (documents.some((item) => item.hash === hash && item.version === entry.version && item.id !== replacing?.id)) {
        done(`${file.name}：内容及适用版本重复，已跳过`); return;
      }
      if (!old && documents.length >= KNOWLEDGE_LIMITS.documents) { fail('文档数量已达到 200 篇'); return; }
      if (documents.reduce((sum, item) => sum + item.bytes, 0) - (old?.bytes ?? 0) + file.size > KNOWLEDGE_LIMITS.totalBytes) {
        fail('知识库原文总量超过 20 MB'); return;
      }
      if (old) removeSections(tx, id);
      tx.objectStore('documents').put(entry);
      tx.objectStore('originals').put({ id, text });
      for (const section of parsed.sections) {
        tx.objectStore('indexes').put({ ...section.index, documentId: id });
        tx.objectStore('chunks').put({ id: section.index.id, documentId: id, text: section.text });
      }
      done(`${file.name}：${old ? '已更新' : '已导入'} ${entry.sections} 个章节`);
    };
  }, signal);
}

export function deleteKnowledge(document: KnowledgeDocument): Promise<void> {
  return transaction(STORES, 'readwrite', (tx, done, fail) => {
    const request = tx.objectStore('documents').get(document.id);
    request.onsuccess = () => {
      const saved = request.result as KnowledgeDocument | undefined;
      if (saved && (saved.hash !== document.hash || saved.version !== document.version)) { fail('文档已更新，请刷新列表后再删除'); return; }
      removeSections(tx, document.id);
      tx.objectStore('documents').delete(document.id); tx.objectStore('originals').delete(document.id); done();
    };
  });
}

export function searchKnowledge(query: ReturnType<typeof knowledgeQuery>, version: string, signal: AbortSignal): Promise<{ hits: KnowledgeHit[]; note: string }> {
  // 检索与一层章节关联在同一个只读事务内，保证目录、索引和正文一致。
  return transaction(['documents', 'indexes', 'chunks'], 'readonly', (tx, done) => {
    const request = tx.objectStore('documents').getAll();
    request.onsuccess = () => {
      const documents = new Map((request.result as KnowledgeDocument[]).map((item) => [item.id, item]));
      const candidates: { index: KnowledgeIndex; score: number; reasons: string[] }[] = [];
      let unmatched = 0; let matched = 0;
      const hits: KnowledgeHit[] = [];
      const finish = () => {
        const related = hits.filter((hit) => hit.relatedOnly).length;
        const gaps = hits.reduce((sum, hit) => sum + (hit.unresolvedReferences?.length ?? 0), 0);
        done({ hits, note: `${candidates.length ? `找到 ${candidates.length} 个候选章节，补充 ${related} 个关联章节` : '未找到可靠匹配，可换用配置键或章节名称检索'}${matched > candidates.length ? `；另有 ${matched - candidates.length} 个低排名章节未载入` : ''}${gaps ? `；${gaps} 处章节引用尚未完整展开，请核对参考章节` : ''}${unmatched ? `；已排除 ${unmatched} 个版本不匹配章节` : ''}${!version ? '；未采集当前 BOE 版本，请人工核对适用性' : ''}` });
      };
      const readHit = (index: KnowledgeIndex, reasons: string[], relatedOnly: boolean, ready: (hit: KnowledgeHit | undefined) => void) => {
        const read = tx.objectStore('chunks').get(index.id);
        read.onsuccess = () => {
          const doc = documents.get(index.documentId)!;
          if (!read.result) { ready(undefined); return; }
          const text = (read.result as { text: string }).text;
          ready({ id: index.id, documentId: doc.id, title: doc.title, heading: index.heading,
            source: doc.source, version: doc.version, hash: doc.hash, line: index.line, text,
            reasons: [...reasons, doc.version && version ? '适用版本匹配' : '版本待核实'], included: false,
            relatedOnly, relatedIds: [], unresolvedReferences: index.references ?? knowledgeReferences(text) });
        };
      };
      const expandReferences = () => {
        const roots = hits.slice(0, KNOWLEDGE_LIMITS.automaticRoots);
        const buckets = new Map<string, { indexes: KnowledgeIndex[]; found: boolean; overflow: boolean }>();
        const references = new Map(roots.map((hit) => [hit.id, (hit.unresolvedReferences ?? []).slice(0, 16)]));
        const documentIds = [...new Set(roots.filter((hit) => references.get(hit.id)!.length).map((hit) => hit.documentId))];
        if (!documentIds.length) { finish(); return; }
        const attach = () => {
          const existing = new Map(hits.map((hit) => [hit.id, hit]));
          const additions = new Map<string, { index: KnowledgeIndex; reasons: string[] }>();
          for (const root of roots) {
            const unresolved = (root.unresolvedReferences ?? []).slice(16).map((ref) => `§${ref}（超过单章节关联数量限制）`);
            for (const reference of references.get(root.id)!) {
              const bucket = buckets.get(`${root.id}:${reference}`);
              if (!bucket?.found) { unresolved.push(`§${reference}（未找到正文）`); continue; }
              if (bucket.overflow) unresolved.push(`§${reference}（仅展开前 ${KNOWLEDGE_LIMITS.relatedPerReference} 个子章节）`);
              for (const index of bucket.indexes) {
                if (!existing.has(index.id) && !additions.has(index.id)) {
                  if (additions.size >= KNOWLEDGE_LIMITS.relatedSections) {
                    unresolved.push(`§${reference}（超过关联总量限制）`); continue;
                  }
                  additions.set(index.id, { index, reasons: [`关联：${root.heading} → §${reference}`] });
                }
                if (!root.relatedIds!.includes(index.id)) root.relatedIds!.push(index.id);
              }
            }
            root.unresolvedReferences = [...new Set(unresolved)];
          }
          // 低排名候选和关联章节不递归扩散，其未展开引用仍明确记录。
          for (const hit of hits.slice(KNOWLEDGE_LIMITS.automaticRoots)) {
            hit.unresolvedReferences = hit.unresolvedReferences?.map((ref) => `§${ref}（未展开下一级关联）`) ?? [];
          }
          let remaining = additions.size;
          if (!remaining) { finish(); return; }
          for (const { index, reasons } of additions.values()) readHit(index, reasons, true, (hit) => {
            if (hit) {
              hit.unresolvedReferences = hit.unresolvedReferences?.map((ref) => `§${ref}（未递归展开）`) ?? [];
              hits.push(hit);
            } else for (const root of roots.filter((item) => item.relatedIds?.includes(index.id))) {
              root.unresolvedReferences!.push(`${index.heading}（正文缺失）`);
            }
            remaining -= 1;
            if (!remaining) finish();
          });
        };
        let pending = documentIds.length;
        for (const documentId of documentIds) {
          const cursor = tx.objectStore('indexes').index('documentId').openCursor(documentId);
          cursor.onsuccess = () => {
            if (!cursor.result) { pending -= 1; if (!pending) attach(); return; }
            const index = cursor.result.value as KnowledgeIndex;
            for (const root of roots.filter((hit) => hit.documentId === documentId)) {
              for (const reference of references.get(root.id)!) {
                if (!matchesKnowledgeReference(index, reference)) continue;
                const key = `${root.id}:${reference}`;
                const bucket: { indexes: KnowledgeIndex[]; found: boolean; overflow: boolean } = buckets.get(key) ?? { indexes: [], found: false, overflow: false };
                bucket.found = true;
                if (index.id !== root.id) {
                  bucket.indexes.push(index);
                  bucket.indexes.sort((a, b) => a.line - b.line);
                  if (bucket.indexes.length > KNOWLEDGE_LIMITS.relatedPerReference) { bucket.indexes.pop(); bucket.overflow = true; }
                }
                buckets.set(key, bucket);
              }
            }
            cursor.result.continue();
          };
        }
      };
      const readCandidates = () => {
        let remaining = candidates.length;
        if (!remaining) { finish(); return; }
        for (const candidate of candidates) readHit(candidate.index, candidate.reasons, false, (hit) => {
          if (hit) hits.push(hit);
          remaining -= 1;
          if (!remaining) {
            hits.sort((a, b) => candidates.findIndex((item) => item.index.id === a.id) - candidates.findIndex((item) => item.index.id === b.id));
            expandReferences();
          }
        });
      };
      const cursor = tx.objectStore('indexes').openCursor();
      cursor.onsuccess = () => {
        if (!cursor.result) { readCandidates(); return; }
        const index = cursor.result.value as KnowledgeIndex;
        const doc = documents.get(index.documentId);
        if (doc && (!doc.version || !version || doc.version.split(/[,，]/).map((part) => part.trim()).includes(version))) {
          const scored = scoreKnowledge(index, query);
          if (scored.score >= 4) {
            matched += 1; candidates.push({ index, ...scored });
            candidates.sort((a, b) => b.score - a.score || a.index.documentId.localeCompare(b.index.documentId) || a.index.line - b.index.line);
            if (candidates.length > KNOWLEDGE_LIMITS.candidates) candidates.pop();
          }
        } else if (doc) unmatched += 1;
        cursor.result.continue();
      };
    };
  }, signal);
}
