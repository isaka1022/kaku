import { describe, it, expect } from 'vitest';
import { createEditor } from '../src/webview/editor.js';
import { flattenDoc } from '../src/webview/comment-doc-text.js';

function docFor(markdown: string) {
  const editor = createEditor({ element: document.createElement('div'), content: markdown });
  return editor.state.doc;
}

describe('flattenDoc', () => {
  it('単一段落で posAt / offsetAt が往復一致する', () => {
    const doc = docFor('こんにちは世界');
    const flat = flattenDoc(doc);
    expect(flat.text).toBe('こんにちは世界');
    const pos = flat.posAt(3);
    expect(flat.offsetAt(pos)).toBe(3);
  });

  it('複数段落は改行1文字で連結され、段落を跨いでも往復する', () => {
    const doc = docFor('一段落目\n\n二段落目');
    const flat = flattenDoc(doc);
    expect(flat.text).toBe('一段落目\n二段落目');

    const offsetOfSecond = flat.text.indexOf('二');
    const pos = flat.posAt(offsetOfSecond);
    expect(flat.offsetAt(pos)).toBe(offsetOfSecond);
  });

  it('強調やリンクを含むテキストはマークアップ記号を含まない可視テキストになる', () => {
    const doc = docFor('**重要**な指摘と[リンク](https://example.com)です');
    const flat = flattenDoc(doc);
    expect(flat.text).toBe('重要な指摘とリンクです');
    expect(flat.text).not.toContain('*');
    expect(flat.text).not.toContain('[');
    expect(flat.text).not.toContain('](');
  });

  it('見出しや箇条書きの記号は可視テキストに含まれない', () => {
    const doc = docFor('# 見出し\n\n- 項目A\n- 項目B');
    const flat = flattenDoc(doc);
    expect(flat.text).not.toContain('#');
    expect(flat.text).not.toContain('-');
    expect(flat.text).toBe('見出し\n項目A\n項目B');
  });

  it('blockquote 内の段落で改行が二重に入らない', () => {
    const doc = docFor('前置き\n\n> 引用段落\n\n後書き');
    const flat = flattenDoc(doc);
    expect(flat.text).toBe('前置き\n引用段落\n後書き');
    expect(flat.text).not.toContain('\n\n');
  });

  it('段落末尾のオフセットは次の段落に食い込まない', () => {
    const doc = docFor('一段落目\n\n二段落目');
    const flat = flattenDoc(doc);
    const end = flat.text.indexOf('\n');
    const from = flat.posAt(0);
    const to = flat.posAt(end);

    // 段落末尾のオフセットが次段落の開始位置に解決されると to が 1 多くなる
    expect(to - from).toBe('一段落目'.length);
  });

  it('全オフセット位置で offsetAt(posAt(o)) === o が成り立つ', () => {
    const doc = docFor(
      '# 見出し\n\nこれは**強調**と[リンク](https://example.com)を含む段落です。\n\n> 引用の中の段落\n\n- 項目A\n- 項目B\n\n最後の段落。',
    );
    const flat = flattenDoc(doc);
    for (let offset = 0; offset <= flat.text.length; offset += 1) {
      const pos = flat.posAt(offset);
      expect(flat.offsetAt(pos)).toBe(offset);
    }
  });
});
