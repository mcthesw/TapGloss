import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
test.use({ launchOptions: { executablePath: process.env.TAPGLOSS_TEST_BROWSER } });
const source = ['src/domain/expression.ts', 'src/page/spoilers.ts', 'src/page/selection.ts']
  .map((path) =>
    readFileSync(path, 'utf8')
      .replace(/^import .*;$/gm, '')
      .replace(/export /g, ''),
  )
  .join('\n');
const script = ts.transpile(source, { target: ts.ScriptTarget.ES2022 }) + '\nglobalThis.pick = rangeAtPoint;';
test('caret hit testing rejects element and stale offsets before constructing ranges', async ({ page }) => {
  await page.setContent('<p id="text">hello world</p><div id="empty"></div>');
  await page.addScriptTag({ content: script });
  const result = await page.evaluate(() => {
    const scope = globalThis as unknown as { pick: (x: number, y: number) => Range | undefined };
    const text = document.querySelector('#text')!.firstChild!;
    const doc = document as Document & { caretPositionFromPoint: unknown };
    const outputs = [];
    for (const [node, offset] of [
      [document.querySelector('#empty'), 7],
      [text, 90],
      [text, -1],
      [document.createTextNode('hello'), 2],
    ] as const) {
      Object.defineProperty(doc, 'caretPositionFromPoint', {
        configurable: true,
        value: () => ({ offsetNode: node, offset }),
      });
      outputs.push(scope.pick(1, 1)?.toString() ?? null);
    }
    Object.defineProperty(doc, 'caretPositionFromPoint', {
      configurable: true,
      value: () => ({ offsetNode: text, offset: 2 }),
    });
    const r = document.createRange();
    r.setStart(text, 0);
    r.setEnd(text, 5);
    const box = r.getBoundingClientRect();
    outputs.push(scope.pick(box.x + 2, box.y + 2)?.toString() ?? null);
    return outputs;
  });
  expect(result).toEqual([null, null, null, null, 'hello']);
});
