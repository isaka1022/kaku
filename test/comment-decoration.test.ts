import { describe, it, expect } from 'vitest';
import { createEditor, buildCoreExtensions } from '../src/webview/editor.js';
import { CommentDecoration, setComments, getCommentRanges } from '../src/webview/comment-decoration.js';
import { flattenDoc } from '../src/webview/comment-doc-text.js';
import { extractAnchor } from '../src/comments/anchor.js';
import type { KakuComment, CommentAnchor, CommentStatus } from '../src/comments/schema.js';

function editorFor(markdown: string) {
  return createEditor({
    element: document.createElement('div'),
    content: markdown,
    extensions: [...buildCoreExtensions(), CommentDecoration],
  });
}

function anchorFor(flatText: string, quote: string): CommentAnchor {
  const start = flatText.indexOf(quote);
  if (start === -1) throw new Error(`quote not found in fixture: ${quote}`);
  const anchor = extractAnchor(flatText, start, start + quote.length);
  if (!anchor) throw new Error('failed to extract anchor');
  return anchor;
}

function makeComment(
  id: string,
  anchor: CommentAnchor,
  status: CommentStatus = 'open'
): KakuComment {
  return {
    id,
    anchor,
    body: '',
    status,
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
  };
}

describe('CommentDecoration', () => {
  it('setComments 後に getCommentRanges が対象テキストの位置と一致する範囲を返す', () => {
    const editor = editorFor('前置きです。重要な指摘です。後書きです。');
    const flat = flattenDoc(editor.state.doc);
    const anchor = anchorFor(flat.text, '重要な指摘');

    setComments(editor, [makeComment('c1', anchor)]);

    const start = flat.text.indexOf('重要な指摘');
    const expected = { from: flat.posAt(start), to: flat.posAt(start + '重要な指摘'.length) };
    expect(getCommentRanges(editor).get('c1')).toEqual(expected);
  });

  it('status が resolved のコメントは範囲マップに含まれない', () => {
    const editor = editorFor('前置きです。重要な指摘です。後書きです。');
    const flat = flattenDoc(editor.state.doc);
    const anchor = anchorFor(flat.text, '重要な指摘');

    setComments(editor, [makeComment('c1', anchor, 'resolved')]);

    expect(getCommentRanges(editor).has('c1')).toBe(false);
  });

  it('本文に存在しない quote のコメントは範囲マップに含まれない（orphaned 相当）', () => {
    const editor = editorFor('前置きです。重要な指摘です。後書きです。');
    const missingAnchor: CommentAnchor = { quote: '存在しない文字列', prefix: '', suffix: '' };

    setComments(editor, [makeComment('c1', missingAnchor)]);

    expect(getCommentRanges(editor).has('c1')).toBe(false);
  });

  it('コメント範囲より前のテキストを編集すると、範囲が編集量ぶんズレて追従する', () => {
    const editor = editorFor('前置きです。重要な指摘です。後書きです。');
    const flat = flattenDoc(editor.state.doc);
    const anchor = anchorFor(flat.text, '重要な指摘');

    setComments(editor, [makeComment('c1', anchor)]);
    const before = getCommentRanges(editor).get('c1')!;

    editor.commands.insertContentAt(1, 'あああ');

    const after = getCommentRanges(editor).get('c1')!;
    expect(after.from).toBe(before.from + 3);
    expect(after.to).toBe(before.to + 3);
  });

  it('コメント対象のテキストを削除すると範囲マップから消える', () => {
    const editor = editorFor('前置きです。重要な指摘です。後書きです。');
    const flat = flattenDoc(editor.state.doc);
    const anchor = anchorFor(flat.text, '重要な指摘');

    setComments(editor, [makeComment('c1', anchor)]);
    const range = getCommentRanges(editor).get('c1')!;

    editor.commands.deleteRange({ from: range.from, to: range.to });

    expect(getCommentRanges(editor).has('c1')).toBe(false);
  });

  it('複数コメントを同時にセットしても各々正しく解決される', () => {
    const editor = editorFor('前置きです。重要な指摘です。後書きです。');
    const flat = flattenDoc(editor.state.doc);
    const anchor1 = anchorFor(flat.text, '重要な指摘');
    const anchor2 = anchorFor(flat.text, '後書き');

    setComments(editor, [makeComment('c1', anchor1), makeComment('c2', anchor2)]);

    const ranges = getCommentRanges(editor);
    const start1 = flat.text.indexOf('重要な指摘');
    const start2 = flat.text.indexOf('後書き');
    expect(ranges.get('c1')).toEqual({
      from: flat.posAt(start1),
      to: flat.posAt(start1 + '重要な指摘'.length),
    });
    expect(ranges.get('c2')).toEqual({
      from: flat.posAt(start2),
      to: flat.posAt(start2 + '後書き'.length),
    });
  });
});
