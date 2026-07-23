import { Editor } from '@tiptap/core';
import { Placeholder } from '@tiptap/extension-placeholder';
import { BubbleMenu } from '@tiptap/extension-bubble-menu';
import { buildCoreExtensions } from './editor.js';
import { serializeMarkdown } from './markdown.js';
import { extractHeadings } from './outline.js';
import { CommentDecoration, setComments, getCommentRanges } from './comment-decoration.js';
import { flattenDoc } from './comment-doc-text.js';
import { extractAnchor, DEFAULT_CONTEXT_CHARS } from '../comments/anchor.js';
import type { CommentAnchor, KakuComment } from '../comments/schema.js';

interface VsCodeApi {
  postMessage(message: unknown): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

type Typeface = 'gothic' | 'mincho';

interface InitMessage {
  type: 'init';
  body: string;
  frontmatterSummary: string;
  typeface: Typeface;
}
interface UpdateMessage {
  type: 'update';
  body: string;
  frontmatterSummary: string;
}
interface TypefaceMessage {
  type: 'typeface';
  typeface: Typeface;
}
interface CommentsMessage {
  type: 'comments';
  comments: KakuComment[];
  broken: boolean;
  contextChars?: number;
}
type IncomingMessage = InitMessage | UpdateMessage | TypefaceMessage | CommentsMessage;

interface EditorAction {
  label: string;
  run: (editor: Editor) => void;
}

const vscode = acquireVsCodeApi();
const DEBOUNCE_MS = 250;
const OUTLINE_DEBOUNCE_MS = 300;
const ANCHOR_DEBOUNCE_MS = 500;
const GENKOU_CHARS_PER_SHEET = 400;

// --- エラー可視化: 何よりも先に登録し、初期化失敗を必ず画面に出す ---
function showErrorOverlay(message: string, stack?: string): void {
  let overlay = document.getElementById('kaku-error-overlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'kaku-error-overlay';
    overlay.setAttribute(
      'style',
      [
        'position:fixed',
        'top:0',
        'left:0',
        'right:0',
        'z-index:99999',
        'background:#B3261E',
        'color:#fff',
        'padding:10px 14px',
        'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
        'font-size:12px',
        'line-height:1.5',
        'white-space:pre-wrap',
        'max-height:40vh',
        'overflow:auto',
      ].join(';'),
    );
    document.body.appendChild(overlay);
  }
  overlay.textContent = stack ? `${message}\n${stack}` : message;
}

function reportError(message: string, stack?: string): void {
  showErrorOverlay(message, stack);
  vscode.postMessage({ type: 'error', message });
}

function headOfStack(err: unknown): string | undefined {
  return err instanceof Error && err.stack
    ? err.stack.split('\n').slice(0, 4).join('\n')
    : undefined;
}

window.addEventListener('error', (ev) => {
  reportError(ev.message, headOfStack(ev.error));
});
window.addEventListener('unhandledrejection', (ev) => {
  const reason: unknown = ev.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  reportError(message, headOfStack(reason));
});

// --- DOM 構築を webview 側に一元化（HTML との ID 契約を持たない） ---
function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  return node;
}

// #app が無い環境（旧 HTML 混在等）でも body にフォールバックし、null 参照で死なせない
const appRoot = document.getElementById('app') ?? document.body;

const outlineEl = createEl('nav', 'outline');
outlineEl.setAttribute('aria-label', 'アウトライン');
outlineEl.hidden = true;

const page = createEl('div', 'page');
const column = createEl('div', 'column');
const propertiesEl = createEl('details', 'properties');
propertiesEl.hidden = true;
const propertiesSummary = createEl('summary');
propertiesSummary.textContent = 'プロパティ';
const propertiesBody = createEl('pre');
propertiesEl.append(propertiesSummary, propertiesBody);
const host = createEl('div', 'editor-host');
column.append(propertiesEl, host);
page.append(column);

const footer = createEl('div', 'footer');
const countEl = createEl('span', 'count');
const commentToggleBtn = createEl('button', 'comment-toggle');
commentToggleBtn.type = 'button';
footer.append(countEl, commentToggleBtn);

const plusButton = createEl('button', 'plus-button');
plusButton.type = 'button';
plusButton.setAttribute('aria-label', 'ブロックを挿入');
plusButton.textContent = '＋';
plusButton.hidden = true;

const plusMenu = createEl('div', 'plus-menu');
plusMenu.hidden = true;

const slashMenu = createEl('div', 'plus-menu slash-menu');
slashMenu.hidden = true;

const bubbleEl = createEl('div', 'bubble-menu');

const commentInputEl = createEl('div', 'comment-input');
commentInputEl.hidden = true;
const commentTextarea = document.createElement('textarea');
const commentSubmitBtn = document.createElement('button');
commentSubmitBtn.type = 'button';
commentSubmitBtn.textContent = '追加';
commentInputEl.append(commentTextarea, commentSubmitBtn);

const commentPopoverEl = createEl('div', 'comment-popover');
commentPopoverEl.hidden = true;
const commentPopoverBody = createEl('div', 'comment-popover-body');
const commentPopoverActions = createEl('div', 'comment-popover-actions');
const commentResolveBtn = document.createElement('button');
commentResolveBtn.type = 'button';
commentResolveBtn.textContent = '解決';
const commentDeleteBtn = document.createElement('button');
commentDeleteBtn.type = 'button';
commentDeleteBtn.textContent = '削除';
commentPopoverActions.append(commentResolveBtn, commentDeleteBtn);
commentPopoverEl.append(commentPopoverBody, commentPopoverActions);

const commentPanelEl = createEl('aside', 'comment-panel');
commentPanelEl.setAttribute('aria-label', 'コメント一覧');

appRoot.append(
  outlineEl,
  page,
  footer,
  plusButton,
  plusMenu,
  slashMenu,
  bubbleEl,
  commentInputEl,
  commentPopoverEl,
  commentPanelEl,
);

let editor: Editor | null = null;
let dirty = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let outlineTimer: ReturnType<typeof setTimeout> | undefined;
let anchorTimer: ReturnType<typeof setTimeout> | undefined;
let slashOpen = false;
let slashIndex = 0;
let currentComments: KakuComment[] = [];
let commentsBroken = false;
let contextChars = DEFAULT_CONTEXT_CHARS;
let pendingCommentRange: { from: number; to: number } | null = null;
let activePopoverCommentId: string | null = null;
let commentPanelOpen = false;

function applyTypeface(typeface: Typeface): void {
  document.body.dataset.typeface = typeface;
}

// --- 挿入アクション（＋メニューとスラッシュメニューで共通利用） ---
const PLUS_ACTIONS: ReadonlyArray<EditorAction> = [
  { label: '見出し2', run: (e) => e.chain().focus().setHeading({ level: 2 }).run() },
  { label: '見出し3', run: (e) => e.chain().focus().setHeading({ level: 3 }).run() },
  { label: '箇条書き', run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: '引用', run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: 'コード', run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { label: '罫線', run: (e) => e.chain().focus().setHorizontalRule().run() },
];

function buildActionMenu(
  container: HTMLElement,
  onRun: (action: EditorAction) => void,
): HTMLButtonElement[] {
  return PLUS_ACTIONS.map((action) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'plus-menu-btn';
    btn.textContent = action.label;
    btn.addEventListener('mousedown', (ev) => ev.preventDefault());
    btn.addEventListener('click', () => onRun(action));
    container.appendChild(btn);
    return btn;
  });
}

// --- 文字数・原稿用紙枚数 ---
function updateFooter(): void {
  if (!editor) {
    return;
  }
  const chars = editor.getText().replace(/\s/g, '').length;
  const sheets = (chars / GENKOU_CHARS_PER_SHEET).toFixed(1);
  countEl.textContent = `${chars.toLocaleString('ja-JP')}字（原稿用紙 ${sheets}枚）`;
}

function renderProperties(summary: string): void {
  const trimmed = summary.trim();
  if (!trimmed) {
    propertiesEl.hidden = true;
    propertiesBody.textContent = '';
    return;
  }
  propertiesEl.hidden = false;
  propertiesBody.textContent = trimmed;
}

// --- 拡張側への編集送信（デバウンス + IME 保留） ---
function flushEdit(): void {
  if (!editor || !dirty) {
    return;
  }
  dirty = false;
  vscode.postMessage({ type: 'edit', body: serializeMarkdown(editor) });
}

function scheduleEdit(): void {
  if (!editor || editor.view.composing) {
    return; // IME 変換中は保留し、compositionend で flush する
  }
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushEdit, DEBOUNCE_MS);
}

// --- バブルツールバー ---
const COMMENT_BUBBLE_LABEL = '💬';

const BUBBLE_ACTIONS: ReadonlyArray<{
  label: string;
  isActive: (e: Editor) => boolean;
  run: (e: Editor) => void;
}> = [
  { label: 'B', isActive: (e) => e.isActive('bold'), run: (e) => e.chain().focus().toggleBold().run() },
  { label: 'H2', isActive: (e) => e.isActive('heading', { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: 'H3', isActive: (e) => e.isActive('heading', { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  { label: '•', isActive: (e) => e.isActive('bulletList'), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: '“', isActive: (e) => e.isActive('blockquote'), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: '🔗', isActive: (e) => e.isActive('link'), run: (e) => toggleLink(e) },
  { label: COMMENT_BUBBLE_LABEL, isActive: (e) => isSelectionCommented(e), run: (e) => openCommentInput(e) },
];

function toggleLink(e: Editor): void {
  if (e.isActive('link')) {
    e.chain().focus().unsetLink().run();
    return;
  }
  const url = window.prompt('リンク先 URL');
  if (url) {
    e.chain().focus().setLink({ href: url }).run();
  }
}

const bubbleButtons: HTMLButtonElement[] = BUBBLE_ACTIONS.map((action) => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bubble-btn';
  btn.textContent = action.label;
  btn.addEventListener('mousedown', (ev) => ev.preventDefault());
  btn.addEventListener('click', () => {
    if (editor) {
      action.run(editor);
    }
  });
  bubbleEl.appendChild(btn);
  return btn;
});

const commentButtonIndex = BUBBLE_ACTIONS.findIndex((action) => action.label === COMMENT_BUBBLE_LABEL);

function refreshBubbleActive(): void {
  if (!editor) {
    return;
  }
  BUBBLE_ACTIONS.forEach((action, i) => {
    bubbleButtons[i].classList.toggle('is-active', action.isActive(editor!));
  });
  if (commentButtonIndex >= 0) {
    bubbleButtons[commentButtonIndex].disabled = commentsBroken;
  }
}

// --- ＋ ブロック挿入メニュー ---
function hidePlusMenu(): void {
  plusMenu.hidden = true;
}

buildActionMenu(plusMenu, (action) => {
  if (editor) {
    action.run(editor);
  }
  hidePlusMenu();
});

plusButton.addEventListener('mousedown', (ev) => ev.preventDefault());
plusButton.addEventListener('click', () => {
  plusMenu.hidden = !plusMenu.hidden;
});

/** 空の段落にカーソルがあるとき、行の左に「＋」ボタンを表示する。 */
function refreshPlusButton(): void {
  if (!editor) {
    return;
  }
  const { selection } = editor.state;
  const { $from, empty } = selection;
  const node = $from.parent;
  const isEmptyParagraph = empty && node.type.name === 'paragraph' && node.content.size === 0;
  if (!isEmptyParagraph) {
    plusButton.hidden = true;
    hidePlusMenu();
    return;
  }
  const coords = editor.view.coordsAtPos($from.pos);
  const hostRect = host.getBoundingClientRect();
  plusButton.hidden = false;
  plusButton.style.top = `${coords.top}px`;
  plusButton.style.left = `${hostRect.left - 34}px`;
  plusMenu.style.top = `${coords.bottom + 4}px`;
  plusMenu.style.left = `${hostRect.left - 34}px`;
}

// --- スラッシュコマンドメニュー ---
const slashButtons = buildActionMenu(slashMenu, (action) => runSlashAction(action));

function hideSlashMenu(): void {
  slashOpen = false;
  slashMenu.hidden = true;
}

function renderSlashSelection(): void {
  slashButtons.forEach((btn, i) => btn.classList.toggle('is-selected', i === slashIndex));
}

function runSlashAction(action: EditorAction): void {
  if (!editor) {
    return;
  }
  const { $from } = editor.state.selection;
  editor.chain().focus().deleteRange({ from: $from.pos - 1, to: $from.pos }).run();
  action.run(editor);
  hideSlashMenu();
}

/** 空の段落の本文が "/" だけのときにスラッシュメニューを開く。IME 変換中は評価しない。 */
function refreshSlashMenu(): void {
  if (!editor || editor.view.composing) {
    return;
  }
  const { $from, empty } = editor.state.selection;
  const node = $from.parent;
  const isTrigger = empty && node.type.name === 'paragraph' && node.textContent === '/';
  if (!isTrigger) {
    hideSlashMenu();
    return;
  }
  if (!slashOpen) {
    slashOpen = true;
    slashIndex = 0;
  }
  const coords = editor.view.coordsAtPos($from.pos);
  slashMenu.style.top = `${coords.bottom + 4}px`;
  slashMenu.style.left = `${coords.left}px`;
  renderSlashSelection();
  slashMenu.hidden = false;
}

function handleSlashKeydown(ev: KeyboardEvent): void {
  if (!slashOpen) {
    return;
  }
  const count = PLUS_ACTIONS.length;
  switch (ev.key) {
    case 'ArrowDown':
      ev.preventDefault();
      ev.stopImmediatePropagation();
      slashIndex = (slashIndex + 1) % count;
      renderSlashSelection();
      break;
    case 'ArrowUp':
      ev.preventDefault();
      ev.stopImmediatePropagation();
      slashIndex = (slashIndex - 1 + count) % count;
      renderSlashSelection();
      break;
    case 'Enter':
      ev.preventDefault();
      ev.stopImmediatePropagation();
      runSlashAction(PLUS_ACTIONS[slashIndex]);
      break;
    case 'Escape':
      ev.preventDefault();
      ev.stopImmediatePropagation();
      hideSlashMenu();
      break;
    default:
      break;
  }
}

// --- アウトラインサイドバー ---
function headingElements(): HTMLElement[] {
  return Array.from(host.querySelectorAll('h1, h2, h3'));
}

function scheduleOutline(): void {
  clearTimeout(outlineTimer);
  outlineTimer = setTimeout(rebuildOutline, OUTLINE_DEBOUNCE_MS);
}

function rebuildOutline(): void {
  if (!editor) {
    return;
  }
  const headings = extractHeadings(serializeMarkdown(editor));
  outlineEl.textContent = '';
  if (headings.length === 0) {
    outlineEl.hidden = true;
    return;
  }
  outlineEl.hidden = false;
  headings.forEach((heading, index) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `outline-item level-${heading.level}`;
    item.textContent = heading.text;
    item.title = heading.text;
    item.addEventListener('mousedown', (ev) => ev.preventDefault());
    item.addEventListener('click', () => jumpToHeading(index));
    outlineEl.appendChild(item);
  });
  refreshOutlineActive();
}

function jumpToHeading(index: number): void {
  if (!editor) {
    return;
  }
  const el = headingElements()[index];
  if (!el) {
    return;
  }
  const pos = editor.view.posAtDOM(el, 0);
  editor.chain().setTextSelection(pos).focus().run();
  el.scrollIntoView({ block: 'start' });
}

function refreshOutlineActive(): void {
  if (!editor || outlineEl.hidden) {
    return;
  }
  const items = Array.from(outlineEl.children) as HTMLElement[];
  const els = headingElements();
  const cursor = editor.state.selection.from;
  let activeIndex = -1;
  els.forEach((el, i) => {
    if (editor!.view.posAtDOM(el, 0) <= cursor) {
      activeIndex = i;
    }
  });
  items.forEach((item, i) => item.classList.toggle('is-active', i === activeIndex));
}

// --- コメント注釈: 追加導線（バブルメニュー ＋ インライン入力） ---
function isSelectionCommented(e: Editor): boolean {
  const { from, to } = e.state.selection;
  for (const range of getCommentRanges(e).values()) {
    if (from < range.to && to > range.from) {
      return true;
    }
  }
  return false;
}

function closeCommentInput(): void {
  commentInputEl.hidden = true;
  pendingCommentRange = null;
}

function openCommentInput(e: Editor): void {
  if (commentsBroken) {
    return;
  }
  const { from, to } = e.state.selection;
  if (from === to) {
    return;
  }
  pendingCommentRange = { from, to };
  const coords = e.view.coordsAtPos(from);
  commentInputEl.style.top = `${coords.bottom + 4}px`;
  commentInputEl.style.left = `${coords.left}px`;
  commentTextarea.value = '';
  commentInputEl.hidden = false;
  commentTextarea.focus();
}

function submitCommentInput(): void {
  if (!editor || !pendingCommentRange) {
    return;
  }
  const body = commentTextarea.value.trim();
  if (!body) {
    return;
  }
  const flat = flattenDoc(editor.state.doc);
  const anchor = extractAnchor(
    flat.text,
    flat.offsetAt(pendingCommentRange.from),
    flat.offsetAt(pendingCommentRange.to),
    contextChars,
  );
  closeCommentInput();
  if (!anchor) {
    return;
  }
  vscode.postMessage({ type: 'commentAdd', anchor, body });
}

commentTextarea.addEventListener('mousedown', (ev) => ev.stopPropagation());
commentSubmitBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
commentSubmitBtn.addEventListener('click', submitCommentInput);
commentTextarea.addEventListener('keydown', (ev) => {
  if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
    ev.preventDefault();
    submitCommentInput();
  } else if (ev.key === 'Escape') {
    ev.preventDefault();
    closeCommentInput();
  }
});

// --- コメント注釈: ハイライトクリックでポップオーバー ---
function findCommentElement(target: EventTarget | null): Element | null {
  let node: Node | null = target instanceof Node ? target : null;
  while (node) {
    if (node instanceof Element && node.hasAttribute('data-comment-id')) {
      return node;
    }
    node = node.parentNode;
  }
  return null;
}

function closeCommentPopover(): void {
  commentPopoverEl.hidden = true;
  activePopoverCommentId = null;
}

function openCommentPopover(id: string, anchorEl: Element): void {
  const comment = currentComments.find((c) => c.id === id);
  if (!comment) {
    return;
  }
  activePopoverCommentId = id;
  commentPopoverBody.textContent = comment.body;
  const rect = anchorEl.getBoundingClientRect();
  commentPopoverEl.style.top = `${rect.bottom + 4}px`;
  commentPopoverEl.style.left = `${rect.left}px`;
  commentPopoverEl.hidden = false;
}

commentResolveBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
commentResolveBtn.addEventListener('click', () => {
  if (!activePopoverCommentId) {
    return;
  }
  vscode.postMessage({ type: 'commentUpdate', id: activePopoverCommentId, status: 'resolved' });
  closeCommentPopover();
});
commentDeleteBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
commentDeleteBtn.addEventListener('click', () => {
  if (!activePopoverCommentId) {
    return;
  }
  vscode.postMessage({ type: 'commentDelete', id: activePopoverCommentId });
  closeCommentPopover();
});

host.addEventListener('click', (ev) => {
  const el = findCommentElement(ev.target);
  if (!el) {
    return;
  }
  const id = el.getAttribute('data-comment-id');
  if (id) {
    openCommentPopover(id, el);
  }
});

// --- コメント注釈: トグル式の右パネル ---
function isCommentOrphaned(
  comment: KakuComment,
  ranges: ReadonlyMap<string, { from: number; to: number }>,
): boolean {
  if (comment.status === 'resolved') {
    return false;
  }
  return comment.status === 'orphaned' || !ranges.has(comment.id);
}

function updateCommentToggleLabel(): void {
  const openCount = currentComments.filter((c) => c.status === 'open').length;
  commentToggleBtn.textContent = `コメント (${openCount})`;
}

function toggleCommentPanel(): void {
  commentPanelOpen = !commentPanelOpen;
  commentPanelEl.classList.toggle('is-open', commentPanelOpen);
}

commentToggleBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
commentToggleBtn.addEventListener('click', toggleCommentPanel);

function scrollToComment(id: string): void {
  if (!editor) {
    return;
  }
  const range = getCommentRanges(editor).get(id);
  if (!range) {
    return;
  }
  editor.commands.setTextSelection(range);
  editor.commands.scrollIntoView();
}

function renderCommentPanel(): void {
  updateCommentToggleLabel();
  commentPanelEl.textContent = '';

  if (commentsBroken) {
    const warning = createEl('p', 'comment-panel-warning');
    warning.textContent = 'コメントファイルの読み込みに失敗しました。';
    commentPanelEl.append(warning);
    return;
  }

  const ranges = editor ? getCommentRanges(editor) : new Map<string, { from: number; to: number }>();
  const primary = currentComments.filter((c) => c.status === 'open' && !isCommentOrphaned(c, ranges));
  const secondary = currentComments.filter((c) => c.status !== 'open' || isCommentOrphaned(c, ranges));

  for (const comment of [...primary, ...secondary]) {
    const orphaned = isCommentOrphaned(comment, ranges);
    const item = createEl('button', 'comment-item');
    item.type = 'button';
    item.classList.toggle('is-resolved', comment.status === 'resolved');
    item.classList.toggle('is-orphaned', orphaned);
    const body = createEl('div', 'comment-item-body');
    body.textContent = comment.body;
    const status = createEl('div', 'comment-item-status');
    status.textContent = orphaned
      ? '対象を見失ったコメント'
      : comment.status === 'resolved'
        ? '解決済み'
        : '未解決';
    item.append(body, status);
    item.addEventListener('mousedown', (ev) => ev.preventDefault());
    item.addEventListener('click', () => scrollToComment(comment.id));
    commentPanelEl.append(item);
  }
}

// --- コメント注釈: アンカー更新（本文編集から 500ms debounce） ---
function anchorsEqual(a: CommentAnchor, b: CommentAnchor): boolean {
  return a.quote === b.quote && a.prefix === b.prefix && a.suffix === b.suffix;
}

function checkAnchors(): void {
  if (!editor || currentComments.length === 0) {
    return;
  }
  const flat = flattenDoc(editor.state.doc);
  const ranges = getCommentRanges(editor);
  const updates: Array<{ id: string; anchor: CommentAnchor }> = [];
  const next = currentComments.map((comment) => {
    const range = ranges.get(comment.id);
    if (!range) {
      return comment;
    }
    const anchor = extractAnchor(flat.text, flat.offsetAt(range.from), flat.offsetAt(range.to), contextChars);
    if (!anchor || anchorsEqual(anchor, comment.anchor)) {
      return comment;
    }
    updates.push({ id: comment.id, anchor });
    return { ...comment, anchor };
  });
  if (updates.length === 0) {
    return;
  }
  currentComments = next;
  vscode.postMessage({ type: 'commentAnchors', anchors: updates });
  renderCommentPanel();
}

function scheduleAnchorCheck(): void {
  clearTimeout(anchorTimer);
  anchorTimer = setTimeout(checkAnchors, ANCHOR_DEBOUNCE_MS);
}

// --- 外側クリック / Escape でメニューを閉じる ---
document.addEventListener('mousedown', (ev) => {
  const target = ev.target as Node;
  if (!plusButton.contains(target) && !plusMenu.contains(target)) {
    hidePlusMenu();
  }
  if (!slashMenu.contains(target)) {
    hideSlashMenu();
  }
  if (!commentInputEl.contains(target) && !bubbleEl.contains(target)) {
    closeCommentInput();
  }
  if (!commentPopoverEl.contains(target) && !findCommentElement(target)) {
    closeCommentPopover();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    hidePlusMenu();
    closeCommentInput();
    closeCommentPopover();
  }
});

function onSelectionChanged(): void {
  refreshBubbleActive();
  refreshPlusButton();
  refreshSlashMenu();
  refreshOutlineActive();
}

function createEditorInstance(body: string, typeface: Typeface): void {
  applyTypeface(typeface);
  editor = new Editor({
    element: host,
    content: body,
    extensions: [
      ...buildCoreExtensions(),
      Placeholder.configure({ placeholder: 'ここから書きはじめる' }),
      BubbleMenu.configure({
        element: bubbleEl,
        shouldShow: ({ editor: e, state }) => e.isEditable && !state.selection.empty,
      }),
      CommentDecoration,
    ],
  });

  editor.on('update', () => {
    dirty = true;
    updateFooter();
    scheduleEdit();
    scheduleOutline();
    scheduleAnchorCheck();
  });
  editor.on('selectionUpdate', onSelectionChanged);
  editor.on('transaction', onSelectionChanged);
  editor.view.dom.addEventListener('keydown', handleSlashKeydown, { capture: true });
  editor.view.dom.addEventListener('compositionend', () => {
    if (dirty) {
      scheduleEdit();
    }
  });

  // comments メッセージが init より先に届いても取りこぼさない
  setComments(editor, currentComments);
  updateFooter();
  rebuildOutline();
  refreshPlusButton();
  renderCommentPanel();
}

window.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      if (!editor) {
        createEditorInstance(message.body, message.typeface);
      } else {
        editor.commands.setContent(message.body, { emitUpdate: false });
        setComments(editor, currentComments);
        applyTypeface(message.typeface);
        updateFooter();
        rebuildOutline();
      }
      renderProperties(message.frontmatterSummary);
      break;
    case 'update':
      if (editor) {
        editor.commands.setContent(message.body, { emitUpdate: false });
        setComments(editor, currentComments);
        dirty = false;
        updateFooter();
        rebuildOutline();
      }
      renderProperties(message.frontmatterSummary);
      break;
    case 'typeface':
      applyTypeface(message.typeface);
      break;
    case 'comments':
      currentComments = message.comments;
      commentsBroken = message.broken;
      contextChars = message.contextChars ?? DEFAULT_CONTEXT_CHARS;
      if (editor) {
        setComments(editor, currentComments);
      }
      renderCommentPanel();
      break;
  }
});

vscode.postMessage({ type: 'ready' });
