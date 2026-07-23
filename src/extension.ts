import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { splitFrontmatter, combineDocument } from './frontmatter.js';
import {
  sidecarUriFor,
  readSidecar,
  writeSidecar,
  deleteSidecarIfExists,
  serializeSidecar,
} from './commentsHost.js';
import type { CommentAnchor, CommentStatus, KakuComment } from './comments/schema.js';
import { createSidecar, parseSidecar } from './comments/schema.js';

const VIEW_TYPE = 'kaku.editor';
const ANCHOR_SAVE_DEBOUNCE_MS = 250;

type Typeface = 'gothic' | 'mincho';

function getTypeface(): Typeface {
  const value = vscode.workspace.getConfiguration('kaku').get<string>('typeface', 'gothic');
  return value === 'mincho' ? 'mincho' : 'gothic';
}

function getContextChars(): number {
  return vscode.workspace.getConfiguration('kaku').get<number>('comments.contextChars', 40);
}

interface WebviewMessage {
  type: string;
  body?: string;
  message?: string;
  anchor?: CommentAnchor;
  id?: string;
  status?: CommentStatus;
  anchors?: Array<{ id: string; anchor: CommentAnchor }>;
}

class KakuEditorProvider implements vscode.CustomTextEditorProvider {
  constructor(private readonly context: vscode.ExtensionContext) {}

  public resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): void {
    const webview = webviewPanel.webview;
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist'), vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    webview.html = this.buildHtml(webview);

    let currentFrontmatter = splitFrontmatter(document.getText()).frontmatter;
    let lastSyncedText = document.getText();

    // コメント永続化は本文同期（lastSyncedText/applyBody）とは独立した別チャネル
    let comments: KakuComment[] = [];
    let sidecarBroken = false;
    let lastWrittenSidecarJson: string | undefined;
    let anchorSaveTimer: ReturnType<typeof setTimeout> | undefined;
    const sidecarUri = sidecarUriFor(document.uri);

    const sendComments = (): void => {
      webview.postMessage({
        type: 'comments',
        comments,
        broken: sidecarBroken,
        contextChars: getContextChars(),
      });
    };

    const markSidecarBroken = (error: unknown): void => {
      sidecarBroken = true;
      const detail = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(
        `kaku: コメントファイルの読み込みに失敗しました。以後このセッションではコメントの保存を行いません。(${detail})`,
      );
    };

    const loadComments = async (): Promise<void> => {
      try {
        const sidecar = await readSidecar(document.uri);
        comments = sidecar?.comments ?? [];
      } catch (error) {
        comments = [];
        markSidecarBroken(error);
      }
      sendComments();
    };

    const persistComments = async (): Promise<void> => {
      if (sidecarBroken) {
        return;
      }
      if (comments.length === 0) {
        await deleteSidecarIfExists(document.uri);
        lastWrittenSidecarJson = undefined;
        return;
      }
      const sidecar = createSidecar(
        vscode.workspace.asRelativePath(document.uri),
        comments,
        new Date().toISOString(),
      );
      lastWrittenSidecarJson = serializeSidecar(sidecar);
      await writeSidecar(document.uri, sidecar);
    };

    const scheduleAnchorSave = (): void => {
      if (anchorSaveTimer) {
        clearTimeout(anchorSaveTimer);
      }
      anchorSaveTimer = setTimeout(() => {
        anchorSaveTimer = undefined;
        void persistComments();
      }, ANCHOR_SAVE_DEBOUNCE_MS);
    };

    const onSidecarChange = async (): Promise<void> => {
      if (sidecarBroken) {
        return;
      }
      let bytes: Uint8Array;
      try {
        bytes = await vscode.workspace.fs.readFile(sidecarUri);
      } catch {
        return; // 削除と競合。onDidDelete 側で処理される
      }
      const raw = Buffer.from(bytes).toString('utf8');
      if (raw === lastWrittenSidecarJson) {
        return; // 自分の書き込みのecho
      }
      try {
        comments = parseSidecar(raw).comments;
        sendComments();
      } catch (error) {
        markSidecarBroken(error);
        sendComments();
      }
    };

    const onSidecarDelete = (): void => {
      if (comments.length > 0) {
        comments = [];
        sendComments();
      }
    };

    const sidecarWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.joinPath(sidecarUri, '..'),
        sidecarUri.path.split('/').pop() ?? '',
      ),
    );
    const sidecarChangeSub = sidecarWatcher.onDidChange(() => void onSidecarChange());
    const sidecarCreateSub = sidecarWatcher.onDidCreate(() => void onSidecarChange());
    const sidecarDeleteSub = sidecarWatcher.onDidDelete(() => onSidecarDelete());

    const sendState = (type: 'init' | 'update'): void => {
      const split = splitFrontmatter(document.getText());
      currentFrontmatter = split.frontmatter;
      webview.postMessage({
        type,
        body: split.body,
        frontmatterSummary: split.frontmatter,
        typeface: getTypeface(),
      });
    };

    const applyBody = async (body: string): Promise<void> => {
      const newText = combineDocument(currentFrontmatter, body);
      if (newText === document.getText()) {
        return;
      }
      lastSyncedText = newText;
      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(
        document.positionAt(0),
        document.positionAt(document.getText().length),
      );
      edit.replace(document.uri, fullRange, newText);
      await vscode.workspace.applyEdit(edit);
    };

    const messageSub = webview.onDidReceiveMessage((message: WebviewMessage) => {
      if (message.type === 'ready') {
        sendState('init');
        void loadComments();
      } else if (message.type === 'edit' && typeof message.body === 'string') {
        void applyBody(message.body);
      } else if (message.type === 'error' && typeof message.message === 'string') {
        void vscode.window.showErrorMessage(`kaku: ${message.message}`);
      } else if (message.type === 'commentAdd' && message.anchor && typeof message.body === 'string') {
        const now = new Date().toISOString();
        const anchor = message.anchor;
        const body = message.body;
        comments = [
          ...comments,
          { id: crypto.randomUUID(), anchor, body, status: 'open', createdAt: now, updatedAt: now },
        ];
        void persistComments().then(sendComments);
      } else if (message.type === 'commentUpdate' && typeof message.id === 'string') {
        const id = message.id;
        const now = new Date().toISOString();
        comments = comments.map((comment) =>
          comment.id === id
            ? {
                ...comment,
                body: typeof message.body === 'string' ? message.body : comment.body,
                status: message.status ?? comment.status,
                updatedAt: now,
              }
            : comment,
        );
        void persistComments().then(sendComments);
      } else if (message.type === 'commentDelete' && typeof message.id === 'string') {
        const id = message.id;
        comments = comments.filter((comment) => comment.id !== id);
        void persistComments().then(sendComments);
      } else if (message.type === 'commentAnchors' && Array.isArray(message.anchors)) {
        const anchorById = new Map(message.anchors.map((entry) => [entry.id, entry.anchor]));
        comments = comments.map((comment) => {
          const anchor = anchorById.get(comment.id);
          return anchor ? { ...comment, anchor } : comment;
        });
        scheduleAnchorSave();
      }
    });

    const changeSub = vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.document.uri.toString() !== document.uri.toString()) {
        return;
      }
      if (document.getText() === lastSyncedText) {
        return; // 自分が適用した編集はスキップ（ループ防止）
      }
      lastSyncedText = document.getText();
      sendState('update');
    });

    const configSub = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('kaku.typeface')) {
        webview.postMessage({ type: 'typeface', typeface: getTypeface() });
      }
    });

    webviewPanel.onDidDispose(() => {
      messageSub.dispose();
      changeSub.dispose();
      configSub.dispose();
      sidecarChangeSub.dispose();
      sidecarCreateSub.dispose();
      sidecarDeleteSub.dispose();
      sidecarWatcher.dispose();
      if (anchorSaveTimer) {
        clearTimeout(anchorSaveTimer);
      }
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = getNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js'),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'kaku.css'),
    );
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    // DOM 生成は webview 側（main.ts）に一元化し、HTML と JS の間の ID 契約を持たせない
    return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>kaku</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VIEW_TYPE, new KakuEditorProvider(context), {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: false,
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kaku.openWith', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri) {
        void vscode.window.showInformationMessage('アクティブな .md ファイルがありません。');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', uri, VIEW_TYPE);
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(async (event) => {
      for (const { oldUri, newUri } of event.files) {
        if (!oldUri.path.endsWith('.md')) {
          continue;
        }
        try {
          await vscode.workspace.fs.rename(sidecarUriFor(oldUri), sidecarUriFor(newUri), {
            overwrite: false,
          });
        } catch (error) {
          if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) {
            throw error;
          }
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidDeleteFiles(async (event) => {
      for (const uri of event.files) {
        if (uri.path.endsWith('.md')) {
          await deleteSidecarIfExists(uri);
        }
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('kaku.revealCommentsFile', async () => {
      const uri = vscode.window.activeTextEditor?.document.uri;
      if (!uri || !uri.path.endsWith('.md')) {
        void vscode.window.showInformationMessage('アクティブな .md ファイルがありません。');
        return;
      }
      try {
        const doc = await vscode.workspace.openTextDocument(sidecarUriFor(uri));
        await vscode.window.showTextDocument(doc);
      } catch {
        void vscode.window.showInformationMessage('コメントファイルが見つかりません。');
      }
    }),
  );
}

export function deactivate(): void {
  // no-op
}
