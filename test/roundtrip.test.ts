import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Editor } from '@tiptap/core';
import { createEditor } from '../src/webview/editor.js';
import { serializeMarkdown } from '../src/webview/markdown.js';
import { splitFrontmatter } from '../src/frontmatter.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(here, 'fixtures', 'sample.md'), 'utf8');

describe('Markdown ラウンドトリップ', () => {
  let output: string;
  let editor: Editor;

  beforeAll(() => {
    const { body } = splitFrontmatter(fixture);
    editor = createEditor({ element: document.createElement('div'), content: body });
    output = serializeMarkdown(editor);
  });

  it('チェックボックスの状態を保全する', () => {
    expect(output).toContain('- [ ] 未完了のタスク');
    expect(output).toContain('- [x] 完了したタスク');
  });

  it('箇条書きを保全する', () => {
    expect(output).toContain('- 項目A');
    expect(output).toContain('- 項目B');
  });

  it('wikilink を文字列そのまま保全する', () => {
    expect(output).toContain('[[別のノート]]');
  });

  it('コードフェンスの言語指定を保全する', () => {
    expect(output).toContain('```yaml');
    expect(output).toContain('key: value');
  });

  it('見出しレベルを保全する', () => {
    expect(output).toMatch(/^# 見出し1$/m);
    expect(output).toMatch(/^## タスク$/m);
    expect(output).toMatch(/^## コード$/m);
  });

  it('テーブルの行列とセル内容を保全する', () => {
    const tableRows = output
      .split('\n')
      .filter((line) => line.trim().startsWith('|'));
    // ヘッダ + 区切り + 2データ行 = 4 行
    expect(tableRows.length).toBe(4);
    expect(output).toMatch(/\|\s*項目\s*\|\s*値\s*\|/);
    expect(output).toMatch(/\|\s*A\s*\|\s*1\s*\|/);
    expect(output).toMatch(/\|\s*B\s*\|\s*2\s*\|/);
  });
});
