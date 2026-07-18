import { Extension } from '@tiptap/core';
import { Plugin } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const WIKILINK_RE = /\[\[[^[\]]+\]\]/g;

/**
 * wikilink `[[...]]` を Tiptap ノード化せず、プレーンテキストのまま inline decoration で視覚化する。
 * ノード化しないことでラウンドトリップが自明に安全になる。
 */
export const WikilinkDecoration = Extension.create({
  name: 'wikilinkDecoration',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node: ProseMirrorNode, pos: number) => {
              if (!node.isText || !node.text) {
                return;
              }
              const text = node.text;
              WIKILINK_RE.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = WIKILINK_RE.exec(text)) !== null) {
                const from = pos + match.index;
                const to = from + match[0].length;
                decorations.push(Decoration.inline(from, to, { class: 'wikilink' }));
              }
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
