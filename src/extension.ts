import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { splitFrontmatter, combineDocument } from './frontmatter.js';

const VIEW_TYPE = 'kaku.editor';

type Typeface = 'gothic' | 'mincho';

function getTypeface(): Typeface {
  const value = vscode.workspace.getConfiguration('kaku').get<string>('typeface', 'gothic');
  return value === 'mincho' ? 'mincho' : 'gothic';
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

    const messageSub = webview.onDidReceiveMessage(
      (message: { type: string; body?: string; message?: string }) => {
        if (message.type === 'ready') {
          sendState('init');
        } else if (message.type === 'edit' && typeof message.body === 'string') {
          void applyBody(message.body);
        } else if (message.type === 'error' && typeof message.message === 'string') {
          void vscode.window.showErrorMessage(`kaku: ${message.message}`);
        }
      },
    );

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
}

export function deactivate(): void {
  // no-op
}
