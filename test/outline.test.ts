import { describe, it, expect } from 'vitest';
import { extractHeadings } from '../src/webview/outline.js';

describe('extractHeadings', () => {
  it('h1〜h3 をレベル付きで文書順に抽出する', () => {
    const md = ['# タイトル', '', '本文', '', '## 節', '', '### 小節', '', '本文'].join('\n');
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: 'タイトル' },
      { level: 2, text: '節' },
      { level: 3, text: '小節' },
    ]);
  });

  it('コードフェンス内の # を見出し扱いしない', () => {
    const md = [
      '# 実物の見出し',
      '',
      '```bash',
      '# これはコメントであって見出しではない',
      'echo hi',
      '```',
      '',
      '## 実物の節',
    ].join('\n');
    expect(extractHeadings(md)).toEqual([
      { level: 1, text: '実物の見出し' },
      { level: 2, text: '実物の節' },
    ]);
  });

  it('h4 以降は抽出しない', () => {
    const md = ['#### 深い見出し', '##### さらに深い'].join('\n');
    expect(extractHeadings(md)).toEqual([]);
  });

  it('見出しが無ければ空配列を返す', () => {
    expect(extractHeadings('ただの本文\n\nもう一段落')).toEqual([]);
  });
});
