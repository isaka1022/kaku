import { Editor, type Extensions } from '@tiptap/core';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { Markdown } from 'tiptap-markdown';
import { WikilinkDecoration } from './wikilink-decoration.js';

/**
 * webview とテストで共有する中核拡張。シリアライズに影響する拡張のみを含み、
 * Placeholder / BubbleMenu のような UI 専用拡張は main.ts 側で追加する。
 */
export function buildCoreExtensions(): Extensions {
  return [
    StarterKit.configure({ link: false }),
    Link.configure({ openOnClick: false, autolink: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    Markdown.configure({
      html: false,
      tightLists: true,
      bulletListMarker: '-',
      linkify: false,
      breaks: false,
    }),
    WikilinkDecoration,
  ];
}

export interface CreateEditorOptions {
  element?: HTMLElement;
  content?: string;
  editable?: boolean;
  extensions?: Extensions;
}

/** テストおよび webview から Tiptap インスタンスを生成する共通ファクトリ。 */
export function createEditor(options: CreateEditorOptions = {}): Editor {
  return new Editor({
    element: options.element,
    content: options.content ?? '',
    editable: options.editable ?? true,
    extensions: options.extensions ?? buildCoreExtensions(),
  });
}
