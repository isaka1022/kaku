import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { resolveAnchor } from '../comments/anchor.js';
import type { KakuComment } from '../comments/schema.js';
import { flattenDoc } from './comment-doc-text.js';

export interface CommentRange {
  from: number;
  to: number;
}

export interface CommentPluginState {
  decorations: DecorationSet;
  ranges: ReadonlyMap<string, CommentRange>;
}

export const commentPluginKey = new PluginKey<CommentPluginState>('kakuComment');

interface SetCommentsMeta {
  type: 'setComments';
  comments: readonly KakuComment[];
}

function resolveComments(
  comments: readonly KakuComment[],
  doc: ProseMirrorNode
): CommentPluginState {
  const flat = flattenDoc(doc);
  const decorations: Decoration[] = [];
  const ranges = new Map<string, CommentRange>();

  for (const comment of comments) {
    if (comment.status === 'resolved') continue;
    const resolved = resolveAnchor(flat.text, comment.anchor);
    if (!resolved) continue;

    const from = flat.posAt(resolved.start);
    const to = flat.posAt(resolved.end);
    decorations.push(
      Decoration.inline(from, to, {
        class: `comment-mark comment-status-${comment.status}`,
        'data-comment-id': comment.id,
      })
    );
    ranges.set(comment.id, { from, to });
  }

  return { decorations: DecorationSet.create(doc, decorations), ranges };
}

function mapCommentState(prev: CommentPluginState, tr: Transaction): CommentPluginState {
  const decorations = prev.decorations.map(tr.mapping, tr.doc);
  const ranges = new Map<string, CommentRange>();
  for (const [id, range] of prev.ranges) {
    const from = tr.mapping.map(range.from, -1);
    const to = tr.mapping.map(range.to, 1);
    // 対象テキストが削除されると範囲が潰れる。幅ゼロを残すと「範囲マップに無い＝orphaned」が崩れる
    if (from >= to) continue;
    ranges.set(id, { from, to });
  }
  return { decorations, ranges };
}

/**
 * コメントの注釈範囲を ProseMirror decoration として描画する。
 * 全件再解決は setComments meta が来たときのみ行い、通常の編集では tr.mapping で追従する。
 */
export const CommentDecoration = Extension.create({
  name: 'commentDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin<CommentPluginState>({
        key: commentPluginKey,
        state: {
          init(): CommentPluginState {
            return { decorations: DecorationSet.empty, ranges: new Map() };
          },
          apply(tr, prev, _oldState, newState): CommentPluginState {
            const meta = tr.getMeta(commentPluginKey) as SetCommentsMeta | undefined;
            if (meta?.type === 'setComments') {
              return resolveComments(meta.comments, newState.doc);
            }
            if (tr.docChanged) {
              return mapCommentState(prev, tr);
            }
            return prev;
          },
        },
        props: {
          decorations(state) {
            return commentPluginKey.getState(state)?.decorations ?? null;
          },
        },
      }),
    ];
  },
});

export function setComments(editor: Editor, comments: readonly KakuComment[]): void {
  const meta: SetCommentsMeta = { type: 'setComments', comments };
  editor.view.dispatch(editor.state.tr.setMeta(commentPluginKey, meta));
}

export function getCommentRanges(editor: Editor): ReadonlyMap<string, CommentRange> {
  return commentPluginKey.getState(editor.state)?.ranges ?? new Map();
}
