/**
 * CommentAnchor.quote は ProseMirror 上の可視テキストであり、Markdown ソース文字列ではない。
 * 例: 原文 `**重要**な指摘` に対し quote は `重要な指摘` になる。
 * AI による一括適用時は生の Markdown への置換ではなくエディタ経由で当てる必要がある。
 */

export const SIDECAR_VERSION = 1;

export interface CommentAnchor {
  quote: string;
  prefix: string;
  suffix: string;
}

export type CommentStatus = 'open' | 'resolved' | 'orphaned';

export interface KakuComment {
  id: string;
  anchor: CommentAnchor;
  body: string;
  status: CommentStatus;
  createdAt: string;
  updatedAt: string;
  author?: string;
  replies?: CommentReply[];
}

export interface CommentReply {
  id: string;
  body: string;
  author?: string;
  createdAt: string;
}

export interface CommentsSidecarFile {
  version: number;
  file: string;
  updatedAt: string;
  comments: KakuComment[];
}

export class SidecarParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SidecarParseError';
  }
}

export class UnsupportedSidecarVersionError extends Error {
  readonly version: number;

  constructor(version: number) {
    super(`unsupported sidecar version: ${version}`);
    this.name = 'UnsupportedSidecarVersionError';
    this.version = version;
  }
}

function isCommentAnchor(value: unknown): value is CommentAnchor {
  if (typeof value !== 'object' || value === null) return false;
  const anchor = value as Record<string, unknown>;
  return (
    typeof anchor.quote === 'string' &&
    typeof anchor.prefix === 'string' &&
    typeof anchor.suffix === 'string'
  );
}

function isCommentReply(value: unknown): value is CommentReply {
  if (typeof value !== 'object' || value === null) return false;
  const reply = value as Record<string, unknown>;
  if (typeof reply.id !== 'string' || typeof reply.body !== 'string') return false;
  if (typeof reply.createdAt !== 'string') return false;
  if (reply.author !== undefined && typeof reply.author !== 'string') return false;
  return true;
}

function isCommentStatus(value: unknown): value is CommentStatus {
  return value === 'open' || value === 'resolved' || value === 'orphaned';
}

function isKakuComment(value: unknown): value is KakuComment {
  if (typeof value !== 'object' || value === null) return false;
  const comment = value as Record<string, unknown>;
  if (typeof comment.id !== 'string') return false;
  if (!isCommentAnchor(comment.anchor)) return false;
  if (typeof comment.body !== 'string') return false;
  if (!isCommentStatus(comment.status)) return false;
  if (typeof comment.createdAt !== 'string') return false;
  if (typeof comment.updatedAt !== 'string') return false;
  if (comment.author !== undefined && typeof comment.author !== 'string') return false;
  if (comment.replies !== undefined) {
    if (!Array.isArray(comment.replies) || !comment.replies.every(isCommentReply)) return false;
  }
  return true;
}

export function parseSidecar(raw: string): CommentsSidecarFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SidecarParseError('invalid JSON');
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new SidecarParseError('sidecar must be a JSON object');
  }
  const data = parsed as Record<string, unknown>;

  if (typeof data.version !== 'number') {
    throw new SidecarParseError('missing or invalid "version"');
  }
  if (data.version > SIDECAR_VERSION) {
    throw new UnsupportedSidecarVersionError(data.version);
  }
  if (typeof data.file !== 'string') {
    throw new SidecarParseError('missing or invalid "file"');
  }
  if (typeof data.updatedAt !== 'string') {
    throw new SidecarParseError('missing or invalid "updatedAt"');
  }
  if (!Array.isArray(data.comments) || !data.comments.every(isKakuComment)) {
    throw new SidecarParseError('missing or invalid "comments"');
  }

  return {
    version: data.version,
    file: data.file,
    updatedAt: data.updatedAt,
    comments: data.comments,
  };
}

export function createSidecar(
  file: string,
  comments: KakuComment[],
  now: string
): CommentsSidecarFile {
  return {
    version: SIDECAR_VERSION,
    file,
    updatedAt: now,
    comments,
  };
}
