import type { Editor } from '@tiptap/core';

const WIKILINK_ESCAPED_RE = /\\?\[\\?\[([^[\]\\]+?)\\?\]\\?\]/g;

/** serializer がエスケープした（あるいはそのままの）wikilink を `[[...]]` に復元する。 */
export function restoreWikilinks(markdown: string): string {
  return markdown.replace(WIKILINK_ESCAPED_RE, '[[$1]]');
}

interface MarkdownStorage {
  getMarkdown(): string;
}

/** エディタ内容を Markdown へシリアライズする（wikilink 復元込み）。 */
export function serializeMarkdown(editor: Editor): string {
  const storage = (editor.storage as unknown as Record<string, unknown>).markdown as
    | MarkdownStorage
    | undefined;
  if (!storage) {
    throw new Error('tiptap-markdown storage is not available');
  }
  return restoreWikilinks(storage.getMarkdown());
}
