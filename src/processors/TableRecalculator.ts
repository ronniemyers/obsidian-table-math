import { Editor, MarkdownView, App } from 'obsidian';

import { TableMathSettings, VaultIndexValue } from '../types';
import { VaultIndexManager } from '../managers/VaultIndexManager';
import { FormulaEvaluator } from './FormulaEvaluator';
import { TableProcessor } from './TableProcessor';

export class TableRecalculator {
  private app: App;
  private settings: TableMathSettings;
  private indexManager: VaultIndexManager;
  private processor: TableProcessor;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private contentHashCache: Map<string, string> = new Map();
  private tableCache: Map<string, { hash: string; processed: string[] }> =
    new Map();

  constructor(
    app: App,
    settings: TableMathSettings,
    indexManager: VaultIndexManager
  ) {
    this.app = app;
    this.settings = settings;
    this.indexManager = indexManager;

    const evaluator = new FormulaEvaluator(settings, indexManager);
    this.processor = new TableProcessor(evaluator);
  }

  debounceRecalc(editor: Editor, view: MarkdownView): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.recalculateCurrentNote(editor, view, true);
    }, 500);
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return hash.toString(36);
  }

  private findTableAtCursor(
    lines: string[],
    cursorLine: number
  ): { start: number; end: number } | null {
    let start = cursorLine;
    let end = cursorLine;

    while (start > 0 && this.processor.isTableLine(lines[start - 1])) {
      start--;
    }

    while (
      end < lines.length - 1 &&
      this.processor.isTableLine(lines[end + 1])
    ) {
      end++;
    }

    if (this.processor.isTableLine(lines[cursorLine])) {
      return { start, end };
    }

    return null;
  }

  private hasFormulas(table: string[]): boolean {
    for (let i = 0; i < table.length; i++) {
      const line = table[i];
      const eqIndex = line.indexOf('=');
      if (eqIndex > 0 && line[eqIndex - 1] === ' ') {
        return true;
      }
    }
    return false;
  }

  recalculateCurrentNote(
    editor: Editor,
    view: MarkdownView,
    silent: boolean = false
  ): void {
    const content = editor.getValue();
    const lines = content.split('\n');
    const file = view.file;

    if (!file) {
      return;
    }

    const noteName = file.basename;

    const contentHash = this.simpleHash(content);
    const cachedHash = this.contentHashCache.get(noteName);

    if (cachedHash === contentHash && silent) {
      return;
    }

    this.contentHashCache.set(noteName, contentHash);

    const metadata = this.app.metadataCache.getFileCache(file);
    const noteVariables: { [key: string]: VaultIndexValue } = {};

    const cursorLine = editor.getCursor().line;
    const cursorTable = this.findTableAtCursor(lines, cursorLine);
    const isEditing = silent && cursorTable !== null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (this.processor.isTableLine(line)) {
        const tableData = this.processor.extractTable(lines, i);
        if (tableData) {
          const { table, startLine, endLine } = tableData;

          if (!this.hasFormulas(table)) {
            i = endLine;
            continue;
          }

          if (
            isEditing &&
            cursorTable &&
            (startLine < cursorTable.start || startLine > cursorTable.end)
          ) {
            i = endLine;
            continue;
          }

          const tableKey = `${noteName}-${startLine}`;
          const tableHash = this.simpleHash(table.join('\n'));
          const cached = this.tableCache.get(tableKey);

          if (cached && cached.hash === tableHash) {
            i = endLine;
            continue;
          }

          const parsedCells: string[][] = [];
          for (let r = 0; r < table.length; r++) {
            const parts = table[r].split('|');
            const cells: string[] = [];
            for (let c = 1; c < parts.length - 1; c++) {
              cells.push(parts[c].trim());
            }
            parsedCells.push(cells);
          }

          for (let r = 0; r < parsedCells.length; r++) {
            const cells = parsedCells[r];
            for (let c = 0; c < cells.length; c++) {
              if (cells[c].charCodeAt(0) === 61) {
                const cellKey = `${startLine + r}-${c}`;
                this.indexManager.storeFormula(noteName, cellKey, cells[c]);
              }
            }
          }

          const processedTable = this.processor.processTable(
            table,
            metadata,
            noteVariables
          );

          this.tableCache.set(tableKey, {
            hash: tableHash,
            processed: processedTable,
          });

          for (let r = 0; r < processedTable.length; r++) {
            const parts = processedTable[r].split('|');
            for (let c = 1; c < parts.length - 1; c++) {
              const cellKey = `${startLine + r}-${c - 1}`;
              const formula = this.indexManager.getFormula(noteName, cellKey);
              if (formula) {
                this.indexManager.storeComputedValue(
                  noteName,
                  cellKey,
                  parts[c].trim()
                );
              }
            }
          }

          i = endLine;
        }
      }
    }

    this.indexManager.updateNote(noteName, noteVariables);
    if (Object.keys(noteVariables).length > 0) {
      void this.indexManager.save();
    }
  }
}
