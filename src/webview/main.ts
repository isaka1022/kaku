import { Editor } from '@tiptap/core';
import { Placeholder } from '@tiptap/extension-placeholder';
import { BubbleMenu } from '@tiptap/extension-bubble-menu';
import { buildCoreExtensions } from './editor.js';
import { serializeMarkdown } from './markdown.js';
import { extractHeadings } from './outline.js';

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
type IncomingMessage = InitMessage | UpdateMessage | TypefaceMessage;

interface EditorAction {
  label: string;
  run: (editor: Editor) => void;
}

const vscode = acquireVsCodeApi();
const DEBOUNCE_MS = 250;
const OUTLINE_DEBOUNCE_MS = 300;
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
footer.append(countEl);

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

appRoot.append(outlineEl, page, footer, plusButton, plusMenu, slashMenu, bubbleEl);

let editor: Editor | null = null;
let dirty = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;
let outlineTimer: ReturnType<typeof setTimeout> | undefined;
let slashOpen = false;
let slashIndex = 0;

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

function refreshBubbleActive(): void {
  if (!editor) {
    return;
  }
  BUBBLE_ACTIONS.forEach((action, i) => {
    bubbleButtons[i].classList.toggle('is-active', action.isActive(editor!));
  });
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

// --- 外側クリック / Escape でメニューを閉じる ---
document.addEventListener('mousedown', (ev) => {
  const target = ev.target as Node;
  if (!plusButton.contains(target) && !plusMenu.contains(target)) {
    hidePlusMenu();
  }
  if (!slashMenu.contains(target)) {
    hideSlashMenu();
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    hidePlusMenu();
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
    ],
  });

  editor.on('update', () => {
    dirty = true;
    updateFooter();
    scheduleEdit();
    scheduleOutline();
  });
  editor.on('selectionUpdate', onSelectionChanged);
  editor.on('transaction', onSelectionChanged);
  editor.view.dom.addEventListener('keydown', handleSlashKeydown, { capture: true });
  editor.view.dom.addEventListener('compositionend', () => {
    if (dirty) {
      scheduleEdit();
    }
  });

  updateFooter();
  rebuildOutline();
  refreshPlusButton();
}

window.addEventListener('message', (event: MessageEvent<IncomingMessage>) => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      if (!editor) {
        createEditorInstance(message.body, message.typeface);
      } else {
        editor.commands.setContent(message.body, { emitUpdate: false });
        applyTypeface(message.typeface);
        updateFooter();
        rebuildOutline();
      }
      renderProperties(message.frontmatterSummary);
      break;
    case 'update':
      if (editor) {
        editor.commands.setContent(message.body, { emitUpdate: false });
        dirty = false;
        updateFooter();
        rebuildOutline();
      }
      renderProperties(message.frontmatterSummary);
      break;
    case 'typeface':
      applyTypeface(message.typeface);
      break;
  }
});

vscode.postMessage({ type: 'ready' });
