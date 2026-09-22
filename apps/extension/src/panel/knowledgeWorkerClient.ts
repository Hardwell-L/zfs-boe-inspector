import type { KnowledgeParseRequest, KnowledgeParseResponse, KnowledgeParseResult } from './knowledge.worker';

export async function parseKnowledgeInWorker(file: File, id: string, version: string, signal: AbortSignal): Promise<KnowledgeParseResult> {
  if (signal.aborted) throw new Error('已取消导入');
  const buffer = await file.arrayBuffer();
  if (signal.aborted) throw new Error('已取消导入');
  return new Promise((resolve, reject) => {
    // 保留 Vite 能静态识别的构造形式，Worker 会随扩展打包为本地资源。
    const Worker = window.Worker;
    const worker = new Worker(new URL('./knowledge.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (error?: string, result?: KnowledgeParseResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout); signal.removeEventListener('abort', cancel); worker.terminate();
      if (error) reject(new Error(error)); else if (result) resolve(result);
    };
    const cancel = () => finish('已取消导入');
    const timeout = window.setTimeout(() => finish('文档解析超过 60 秒，请拆分文件后重试'), 60_000);
    signal.addEventListener('abort', cancel, { once: true });
    worker.onerror = (event) => { event.preventDefault(); finish('文档解析 Worker 启动或执行失败，原记录未修改'); };
    worker.onmessageerror = () => finish('文档解析结果无法读取，原记录未修改');
    worker.onmessage = ({ data }: MessageEvent<KnowledgeParseResponse>) => {
      if (data.ok) finish(undefined, data.result); else finish(data.error);
    };
    const request: KnowledgeParseRequest = { buffer, name: file.name, id, version };
    try { worker.postMessage(request, [buffer]); }
    catch { finish('无法启动文档解析，原记录未修改'); }
  });
}
