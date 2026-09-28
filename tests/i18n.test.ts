import { expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import ts from 'typescript';
import { english } from '../src/ui/english';
import { resolveLocale, translate } from '../src/ui/i18n';

it('provides English for every explicit UI translation and leaves learning content unchanged', () => {
  const missing = new Set<string>();
  for (const file of readdirSync('src/ui').filter((f) => f.endsWith('.tsx'))) {
    const source = ts.createSourceFile(
      file,
      readFileSync(`src/ui/${file}`, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const walk = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
        const arg = node.arguments[0];
        if (arg && ts.isStringLiteral(arg) && !english[arg.text]) missing.add(arg.text);
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }
  expect([...missing]).toEqual([]);
  expect(resolveLocale('auto', 'zh-TW')).toBe('zh');
  expect(resolveLocale('auto', 'fr-FR')).toBe('en');
  expect(resolveLocale('zh', 'en-US')).toBe('zh');
  expect(translate('查看 {0} 详情', 'en', '记录')).toBe('Details for 记录');
});
