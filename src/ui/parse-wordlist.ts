import Papa from 'papaparse';
import { normalize } from '../domain/model';

export function parseWordlist(text: string, name: string) {
  if (new TextEncoder().encode(text).length > 10 * 1024 * 1024) throw new Error('词表文件不能超过 10 MB');
  if (text.includes('\uFFFD')) throw new Error('请使用 UTF-8 编码的词表');
  let cells: string[];
  if (/\.txt$/i.test(name)) cells = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  else {
    const parsed = Papa.parse<string[]>(text, {
      skipEmptyLines: 'greedy',
      delimitersToGuess: [',', '\t', ';'],
      comments: '#',
    });
    if (parsed.errors.some((e) => e.code !== 'UndetectableDelimiter'))
      throw new Error('词表格式有误，请检查引号与分隔符');
    const rows = parsed.data;
    const header =
      rows[0]?.findIndex((c) =>
        ['word', 'term', 'expression', '单词', '词语', '词汇'].includes(normalize(c.trim())),
      ) ?? -1;
    const column = header >= 0 ? header : (rows[0]?.findIndex((c) => /\p{L}/u.test(c)) ?? 0);
    cells = rows.slice(header >= 0 ? 1 : 0).map((r) => r[Math.max(0, column)] ?? '');
  }
  const terms: string[] = [],
    seen = new Set<string>();
  let duplicates = 0;
  for (const cell of cells) {
    const term = normalize(cell.trim());
    if (!term || term.startsWith('#')) continue;
    if (term.length > 150) throw new Error('词表中有过长的词语，请检查文件格式');
    if (seen.has(term)) {
      duplicates++;
      continue;
    }
    seen.add(term);
    terms.push(term);
    if (terms.length > 100000) throw new Error('每份词表最多导入十万个词语');
  }
  if (!terms.length) throw new Error('没有找到可导入的词语');
  return { terms, duplicates };
}
