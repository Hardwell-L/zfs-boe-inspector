export const KNOWLEDGE_LIMITS = {
  fileBytes: 2_000_000, batchFiles: 20, batchBytes: 10_000_000,
  documents: 200, totalBytes: 20_000_000, requestBytes: 20_000, candidates: 30, sections: 5000,
  automaticRoots: 6, relatedSections: 12, relatedPerReference: 6,
} as const;

export interface KnowledgeDocument {
  id: string; hash: string; name: string; title: string; source: string; version: string;
  importedAt: string; bytes: number; sections: number; warnings: string[];
}
export interface KnowledgeIndex {
  id: string; documentId: string; heading: string; line: number; bytes: number;
  terms: string[]; titleTerms: string[];
  headingParts?: string[]; references?: string[];
}
export interface KnowledgeHit {
  id: string; documentId: string; title: string; heading: string; source: string;
  version: string; hash: string; line: number; text: string; reasons: string[]; included: boolean;
  relatedIds?: string[]; unresolvedReferences?: string[]; relatedOnly?: boolean;
}
const byteLength = (text: string) => new globalThis.TextEncoder().encode(text).length;
const stopWords = new Set(['字段', '配置', '问题', '当前', '这个', '为什么', '分析', 'true', 'false', 'null']);
const genericKeys = new Set(['fieldcode', 'fieldtype', 'fieldname', 'areacode', 'isshow', 'isedit', 'isrequire', 'labelcode',
  'config', 'value', 'code', 'method', 'action', 'conditions', 'id', 'name', 'type', 'from', 'to',
  'omittedemptyfields', 'normalizedjsonfields', 'shareddatasourcefields']);

// 中文使用连续双字词兼容无分词依赖的本地检索；标识符保持完整。
export function knowledgeTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const match of text.toLowerCase().matchAll(/[a-z_][a-z\d_-]*|[\u4e00-\u9fff]+/g)) {
    const word = match[0];
    if (/^[a-z_]/.test(word)) { if (word.length > 1 && !stopWords.has(word)) terms.add(word); }
    else for (let i = 0; i < word.length - 1; i += 1) {
      const term = word.slice(i, i + 2);
      if (!stopWords.has(term)) terms.add(term);
    }
  }
  return [...terms];
}

export function knowledgeQuery(question: string, configKeys: string[]) {
  let expanded = '';
  for (const [pattern, words] of [
    [/不显示|看不见|隐藏/, ' 显隐 show isShow'], [/置灰|不能编辑|只读/, ' 编辑 edit isEdit'],
    [/计算|重算|金额没|总价没/, ' computed calculate 计算 触发 依赖'],
    [/带出|联动|回填/, ' trans nextField prev 联动 数据源'], [/默认值/, ' defaultInit defaultOption 默认值'],
    [/必填/, ' requireSet isRequire 必填'],
  ] as const) if (pattern.test(question)) expanded += words;
  const primary = knowledgeTerms(question).slice(0, 128);
  return { primary, expanded: knowledgeTerms(expanded).filter((term) => !primary.includes(term)),
    phrase: question.trim().toLowerCase().slice(0, 80),
    keys: [...new Set(configKeys.map((key) => key.toLowerCase()))].filter((key) => !genericKeys.has(key)).slice(0, 128) };
}

export function scoreKnowledge(index: KnowledgeIndex, query: ReturnType<typeof knowledgeQuery>) {
  const terms = new Set(index.terms);
  const leaf = (index.headingParts?.at(-1) ?? index.heading.split(' / ').at(-1) ?? '').toLowerCase();
  const titles = new Set(knowledgeTerms(leaf));
  const matches = query.primary.filter((term) => terms.has(term));
  const expansions = query.expanded.filter((term) => terms.has(term));
  const keys = query.keys.filter((key) => terms.has(key));
  const identifiers = query.primary.filter((term) => /^[a-z_]/.test(term));
  // 明确写出的配置键优先，避免同义词和大批背景配置淹没具体问题。
  if (identifiers.length && !identifiers.some((term) => terms.has(term))) return { score: 0, reasons: [] };
  if (query.primary.length && !matches.length && expansions.length < 2) return { score: 0, reasons: [] };
  const lengthWeight = 1 / Math.sqrt(1 + index.terms.length / 200);
  const coverage = query.primary.length ? matches.length / query.primary.length : 1;
  const exactTitle = query.phrase.length >= 2 && leaf.includes(query.phrase);
  const score = (matches.reduce((sum, term) => sum + (/^[a-z_]/.test(term) ? 10 : 2) + (titles.has(term) ? 8 : 0), 0)
    + Math.min(6, expansions.reduce((sum, term) => sum + (titles.has(term) ? 2 : 0.5), 0))
    + Math.min(6, keys.length * 2)) * lengthWeight * (0.5 + coverage / 2) + (exactTitle ? 12 : 0);
  return { score, reasons: [exactTitle ? '章节标题精确匹配' : '', matches.length ? `问题匹配：${matches.slice(0, 6).join('、')}` : '',
    expansions.length ? `同义词：${expansions.slice(0, 4).join('、')}` : '', keys.length ? `配置键：${keys.slice(0, 6).join('、')}` : ''].filter(Boolean) };
}

// 只解析同文档明确章节号，不追踪网络链接，不从代码示例推断依赖。
export function knowledgeReferences(text: string): string[] {
  const references = new Set<string>();
  let fence = ''; let length = 0;
  for (const line of text.split('\n')) {
    const boundary = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (boundary) {
      if (!fence) { fence = boundary[1]![0]!; length = boundary[1]!.length; }
      else if (boundary[1]![0] === fence && boundary[1]!.length >= length && !boundary[2]!.trim()) fence = '';
      continue;
    }
    if (fence) continue;
    const prose = line.replace(/`[^`]*`/g, '').replace(/\]\([^)]*\)/g, ']');
    for (const match of prose.matchAll(/§\s*(\d+(?:\.\d+)*)(?!\d)|(?:参见|详见|见)\s*第?\s*(\d+(?:\.\d+)*)\s*(?:章|节)/g)) {
      references.add(match[1] ?? match[2]!);
    }
  }
  return [...references];
}

export function matchesKnowledgeReference(index: KnowledgeIndex, reference: string): boolean {
  const parts = index.headingParts ?? index.heading.split(' / ');
  return parts.some((part) => {
    const number = part.match(/^(?:第\s*)?(\d+(?:\.\d+)*)(?=[.、\s章节]|$)/)?.[1];
    return number === reference || number?.startsWith(`${reference}.`);
  });
}

export function parseKnowledge(text: string, name: string, id: string, versionOverride: string) {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const metadata: Record<string, string> = {};
  const warnings: string[] = [];
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.findIndex((line, i) => i > 0 && /^(---|\.\.\.)\s*$/.test(line));
    if (end < 0) throw new Error('文档元信息未闭合，请补齐 ---');
    for (const line of lines.slice(1, end)) {
      const entry = line.match(/^([\w-]+):\s*(.*?)\s*$/);
      if (entry) metadata[entry[1]!] = entry[2]!.replace(/^(['"])(.*)\1$/, '$2');
    }
    start = end + 1;
  }
  const title = metadata.title || lines.find((line) => /^#\s+/.test(line))?.replace(/^#\s+/, '') || name;
  const version = versionOverride.trim() || metadata.boe_version || '';
  const cleanVersion = ['null', '~', 'unknown'].includes(version.toLowerCase()) ? '' : version;
  if (!cleanVersion) warnings.push('未标注适用 BOE 版本，不能据此确认当前版本行为');
  if (/!\[[^\]]*\]\(|<img\b/i.test(text)) warnings.push('含图片；图片内容不参与本版检索，请补充文字说明');
  const headings: string[] = [];
  const sections: { index: KnowledgeIndex; text: string }[] = [];
  let body: string[] = []; let bodyLine = start + 1; let fence = ''; let fenceLength = 0;
  const flush = () => {
    const content = body.join('\n').trim(); body = [];
    if (!content) return;
    const heading = headings.filter(Boolean).join(' / ') || title;
    if (/^(?:.*\/ )?(?:目录|写在最后|相关源码索引)$/.test(heading)) return;
    const sectionId = `${id}:${sections.length}`;
    sections.push({ index: { id: sectionId, documentId: id, heading, headingParts: headings.filter(Boolean), references: knowledgeReferences(content), line: bodyLine, bytes: byteLength(content),
      terms: knowledgeTerms(`${heading}\n${content}`), titleTerms: knowledgeTerms(heading) }, text: content });
  };
  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i]!;
    const boundary = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (boundary) {
      const marker = boundary[1]!;
      if (!fence) { fence = marker[0]!; fenceLength = marker.length; }
      else if (marker[0] === fence && marker.length >= fenceLength && !boundary[2]!.trim()) fence = '';
      body.push(line); continue;
    }
    const heading = !fence && line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      headings.length = heading[1]!.length;
      headings[heading[1]!.length - 1] = heading[2]!;
      bodyLine = i + 1;
    } else body.push(line);
  }
  flush();
  if (fence) throw new Error('代码块未闭合，请修正文档后导入');
  if (!sections.length) throw new Error('没有可检索的正文');
  if (sections.length > KNOWLEDGE_LIMITS.sections) throw new Error('章节数量超过 5000，请拆分文档');
  if (sections.some((section) => section.index.bytes > KNOWLEDGE_LIMITS.requestBytes)) warnings.push('部分章节超过 20 KB，请按子标题拆分；本版不会截断这些章节自动发送');
  return { title, source: metadata.source_url || metadata.source || '', version: cleanVersion, warnings, sections };
}
