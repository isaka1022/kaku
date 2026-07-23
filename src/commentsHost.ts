import * as vscode from 'vscode';
import type { CommentsSidecarFile } from './comments/schema.js';
import { parseSidecar } from './comments/schema.js';

/** 対象 .md と同じディレクトリの `<ファイル名>.comments.json` を指す Uri を返す。 */
export function sidecarUriFor(mdUri: vscode.Uri): vscode.Uri {
  const fileName = mdUri.path.split('/').pop() ?? '';
  return vscode.Uri.joinPath(mdUri, '..', `${fileName}.comments.json`);
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof vscode.FileSystemError && error.code === 'FileNotFound';
}

/** 存在しなければ null。破損・未対応バージョンは例外を投げる（握り潰さない） */
export async function readSidecar(mdUri: vscode.Uri): Promise<CommentsSidecarFile | null> {
  const uri = sidecarUriFor(mdUri);
  let bytes: Uint8Array;
  try {
    bytes = await vscode.workspace.fs.readFile(uri);
  } catch (error) {
    if (isFileNotFound(error)) {
      return null;
    }
    throw error;
  }
  return parseSidecar(Buffer.from(bytes).toString('utf8'));
}

/** 書き込みと自分の書き込みを検知するエコー抑制の両方がこの1つの書式に依存する。 */
export function serializeSidecar(data: CommentsSidecarFile): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

export async function writeSidecar(mdUri: vscode.Uri, data: CommentsSidecarFile): Promise<void> {
  const uri = sidecarUriFor(mdUri);
  await vscode.workspace.fs.writeFile(uri, Buffer.from(serializeSidecar(data), 'utf8'));
}

export async function deleteSidecarIfExists(mdUri: vscode.Uri): Promise<void> {
  const uri = sidecarUriFor(mdUri);
  try {
    await vscode.workspace.fs.delete(uri);
  } catch (error) {
    if (isFileNotFound(error)) {
      return;
    }
    throw error;
  }
}
