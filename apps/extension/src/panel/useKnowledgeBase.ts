import { onBeforeUnmount, reactive } from 'vue';
import { KNOWLEDGE_LIMITS, type KnowledgeDocument } from './knowledge';
import { deleteKnowledge, importKnowledge, listKnowledge } from './knowledgeStore';

export const knowledgeRevision = (documents: KnowledgeDocument[]) => JSON.stringify(documents.map(({ id, hash, version }) => [id, hash, version]).sort((a, b) => a[0]!.localeCompare(b[0]!)));

export function useKnowledgeBase() {
  const state = reactive({ documents: [] as KnowledgeDocument[], busy: false, importing: false, cancelling: false, ready: false, error: '', progress: '', reports: [] as string[], revision: '' });
  let importController: AbortController | undefined;
  const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
  async function read() {
    const documents = await listKnowledge();
    state.documents = documents; state.revision = knowledgeRevision(documents); state.ready = true;
  }
  async function reload() {
    if (state.busy) return;
    state.busy = true; state.error = '';
    try { await read(); }
    catch (error) { state.error = reason(error); }
    finally { state.busy = false; }
  }
  async function importFiles(files: File[], version: string, replacing?: KnowledgeDocument) {
    if (state.busy || !files.length) return;
    state.error = ''; state.reports = [];
    if (files.length > KNOWLEDGE_LIMITS.batchFiles || files.reduce((sum, file) => sum + file.size, 0) > KNOWLEDGE_LIMITS.batchBytes) {
      state.error = '每批最多 20 个文件，合计不超过 10 MB'; return;
    }
    if (replacing && files.length !== 1) { state.error = '更新文档时请选择一个文件'; return; }
    state.busy = true;
    state.importing = true; state.cancelling = false;
    const controller = new window.AbortController(); importController = controller;
    try {
      for (const [index, file] of files.entries()) {
        if (controller.signal.aborted) break;
        state.progress = `正在处理 ${index + 1}/${files.length}：${file.name}`;
        try { state.reports.push(await importKnowledge(file, version, replacing, controller.signal)); }
        catch (error) { state.reports.push(`${file.name}：${controller.signal.aborted ? '已取消' : '失败'}，${reason(error)}`); }
      }
      if (controller.signal.aborted) state.reports.push('已停止导入；此前已完成的文件保留，其余文件未导入。');
      await read();
    } catch (error) { state.error = reason(error); }
    finally { state.busy = false; state.importing = false; state.cancelling = false; state.progress = ''; importController = undefined; }
  }
  async function remove(document: KnowledgeDocument) {
    if (state.busy) return;
    state.busy = true; state.error = '';
    try { await deleteKnowledge(document); await read(); }
    catch (error) { state.error = reason(error); }
    finally { state.busy = false; }
  }
  function cancelImport() { if (importController) { state.cancelling = true; importController.abort(); } }
  onBeforeUnmount(cancelImport);
  return { state, reload, importFiles, remove, cancelImport };
}
export type KnowledgeBase = ReturnType<typeof useKnowledgeBase>;
