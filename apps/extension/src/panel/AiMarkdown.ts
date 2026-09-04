import { defineComponent, h, type VNodeChild } from 'vue';

// 仅生成受控 Vue 节点；原始 HTML、链接和图片一律作为文本展示。
function inline(text: string, cite: (id: string) => void): VNodeChild[] {
  return text.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*|\[E\d+\])/g).filter(Boolean).map((part) => {
    if (/^\[E\d+\]$/.test(part)) return h('button', { class: 'ai-citation', type: 'button', onClick: () => cite(part.slice(1, -1)) }, part);
    if (part.startsWith('`') && part.endsWith('`')) return h('code', part.slice(1, -1));
    if (part.startsWith('**') && part.endsWith('**')) return h('strong', inline(part.slice(2, -2), cite));
    return part;
  });
}

function blocks(text: string, cite: (id: string) => void): VNodeChild[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes: VNodeChild[] = [];
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'));
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (!line.trim()) { i += 1; continue; }
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i]!)) code.push(lines[i++]!);
      if (i < lines.length) i += 1;
      nodes.push(h('pre', [h('code', code.join('\n'))]));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { nodes.push(h(`h${Math.min(heading[1]!.length + 2, 6)}`, inline(heading[2]!, cite))); i += 1; continue; }
    if (line.includes('|') && i + 1 < lines.length && cells(lines[i + 1]!).every((cell) => /^:?-{3,}:?$/.test(cell))) {
      const head = cells(line); const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes('|')) rows.push(cells(lines[i++]!));
      nodes.push(h('div', { class: 'ai-table' }, [h('table', [
        h('thead', [h('tr', head.map((cell) => h('th', inline(cell, cite))))]),
        h('tbody', rows.map((row) => h('tr', row.map((cell) => h('td', inline(cell, cite)))))),
      ])]));
      continue;
    }
    const list = line.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[2]); const items: VNodeChild[] = [];
      while (i < lines.length) {
        const item = lines[i]!.match(/^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(h('li', inline(item[3]!, cite))); i += 1;
      }
      nodes.push(h(ordered ? 'ol' : 'ul', items)); continue;
    }
    nodes.push(h('p', inline(line, cite))); i += 1;
  }
  return nodes;
}

export default defineComponent({
  name: 'AiMarkdown',
  props: { text: { type: String, required: true } },
  emits: { cite: (id: string) => /^E\d+$/.test(id) },
  setup(props, { emit }) {
    return () => h('div', { class: 'ai-markdown' }, blocks(props.text, (id) => emit('cite', id)));
  },
});
