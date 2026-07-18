export interface FrontmatterSplit {
  /** frontmatter を含む先頭バイト列（区切り `---` とその改行まで）。存在しなければ空文字列 */
  frontmatter: string;
  /** frontmatter を除いた本文 */
  body: string;
}

const OPEN = '---\n';

/**
 * 先頭が `---\n` で始まり、次の行頭 `---`（`---\n` または EOF の `---`）までを frontmatter とみなす。
 * 先頭以外の `---` やコードフェンス内の `---` は frontmatter と見なさない（開始条件が先頭固定のため自明に安全）。
 */
export function splitFrontmatter(text: string): FrontmatterSplit {
  if (!text.startsWith(OPEN)) {
    return { frontmatter: '', body: text };
  }

  let cursor = OPEN.length;
  while (cursor <= text.length) {
    const newlineIndex = text.indexOf('\n', cursor);
    const lineEnd = newlineIndex === -1 ? text.length : newlineIndex;
    const line = text.slice(cursor, lineEnd);
    if (line === '---') {
      const end = newlineIndex === -1 ? text.length : newlineIndex + 1;
      return { frontmatter: text.slice(0, end), body: text.slice(end) };
    }
    if (newlineIndex === -1) {
      break;
    }
    cursor = newlineIndex + 1;
  }

  // 閉じ区切りが無い場合は frontmatter とみなさない
  return { frontmatter: '', body: text };
}

/** frontmatter（バイト保全済み）と本文を結合して元のドキュメント文字列に戻す。 */
export function combineDocument(frontmatter: string, body: string): string {
  return frontmatter + body;
}
