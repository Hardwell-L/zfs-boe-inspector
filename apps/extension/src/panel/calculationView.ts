import { record, structured } from './inspectionView';

export interface FormulaToken {
  text: string;
  fieldCode?: string;
}

// 只转换显示文本；保留字符串常量和运算顺序，不解析或执行公式 AST。
export function formulaTokens(code: string): FormulaToken[] {
  const tokens: FormulaToken[] = [];
  let text = '';
  let quote = '';
  let depth = 0;
  const flush = () => {
    if (text) tokens.push({ text });
    text = '';
  };
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]!;
    if (quote) {
      text += char;
      if (char === '\\' && index + 1 < code.length) text += code[++index];
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      text += char;
      continue;
    }
    if (code.startsWith('${', index)) {
      const end = code.indexOf('}', index + 2);
      if (end !== -1) {
        const parts = code.slice(index + 2, end).split('#');
        if (parts[2] === 'fieldLiteral' && parts[0]) {
          flush();
          tokens.push({ text: parts[1] || parts[0], fieldCode: parts[0] });
          index = end;
          continue;
        }
      }
    }
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    // 长串 SUMIF 的顶层加法分行，函数参数内部保持原样。
    text += char === '+' && depth === 0 ? '\n+ ' : char;
  }
  flush();
  return tokens;
}

export function calculationRows(value: unknown) {
  if (value === undefined) return { rows: [], message: '未采集', error: '' };
  if (value === null || value === '') return { rows: [], message: '未配置计算公式', error: '' };
  const parsed = structured(value);
  if (!Array.isArray(parsed.value)) return { rows: [], message: '', error: parsed.error || '无法识别计算公式配置，请展开原始配置查看。' };
  return { message: '未配置计算公式', error: '', rows: parsed.value.map((raw, index) => {
    const rule = record(raw);
    const condition = structured(rule.condition);
    const conditionData = record(condition.value);
    const conditionText = typeof conditionData.content === 'string' ? conditionData.content.trim() : '';
    const form = conditionData.form;
    const emptyForm = form === undefined || form === null || (Array.isArray(form) && form.every((group) => Array.isArray(group) && group.length === 0));
    const noCondition = !condition.error && (condition.value == null || condition.value === ''
      || (typeof condition.value === 'object' && !Array.isArray(condition.value) && !conditionData.__kind && emptyForm));
    const formula = structured(rule.formula);
    const data = record(formula.value);
    const ast = record(data.ast);
    let code = typeof data.code === 'string' && data.code.trim() ? data.code : '';
    if (!code && typeof data.content === 'string') code = data.content;
    if (!code && ['StringLiteral', 'NumberLiteral', 'BooleanLiteral'].includes(String(ast.type)) && ast.value !== undefined) {
      code = JSON.stringify(ast.value);
      if (typeof ast.showLabel === 'string' && ast.showLabel) code = `${ast.showLabel}（${code}）`;
    }
    return {
      index,
      error: !raw || typeof raw !== 'object' || Array.isArray(raw) ? '无法识别此规则，请展开原始配置查看。' : '',
      condition: conditionText || (noCondition ? '始终触发（未配置条件）' : '条件说明不可用，请展开原始配置查看。'),
      tokens: formulaTokens(code),
    };
  }) };
}

export function calculationRaw(value: unknown): string {
  const parsed = structured(value);
  return typeof parsed.value === 'string' ? parsed.value : JSON.stringify(parsed.value, null, 2) ?? '未采集';
}
