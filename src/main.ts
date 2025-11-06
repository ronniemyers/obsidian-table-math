import {
  Editor,
  MarkdownView,
  Plugin,
  TFile,
  MarkdownPostProcessorContext,
} from 'obsidian';

import { TableMathSettings, DEFAULT_SETTINGS, TableCell } from './types';
import { VaultIndexManager } from './managers/VaultIndexManager';
import { FormulaEvaluator } from './processors/FormulaEvaluator';
import { TableRecalculator } from './processors/TableRecalculator';
import { TableMathSettingTab } from './ui/SettingsTab';

export default class TableMathPlugin extends Plugin {
  settings!: TableMathSettings;
  private indexManager!: VaultIndexManager;
  private recalculator!: TableRecalculator;

  async onload() {
    await this.loadSettings();

    this.indexManager = new VaultIndexManager(this.app, this.manifest.id);
    await this.indexManager.load();

    this.recalculator = new TableRecalculator(
      this.app,
      this.settings,
      this.indexManager
    );

    this.registerMarkdownPostProcessor((element, context) => {
      this.processTablePreview(element, context);
    });

    this.addSettingTab(new TableMathSettingTab(this.app, this));

    // Defer expensive operations until workspace is ready
    this.app.workspace.onLayoutReady(() => {
      this.registerEventHandlers();
      void this.indexAllNotes();
    });
  }

  private async indexAllNotes(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();

    const BATCH_SIZE = 50;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (file) => {
          try {
            const content = await this.app.vault.read(file);

            if (!content.includes('|') || !content.includes('=')) {
              return;
            }

            if (
              content.includes('=SUM(') ||
              content.includes('=AVG(') ||
              content.includes('=MIN(') ||
              content.includes('=MAX(') ||
              content.includes('=NOTE(')
            ) {
              const editor: Partial<Editor> = {
                getValue: () => content,
                setValue: () => {},
                getCursor: () => ({ line: 0, ch: 0 }),
                setCursor: () => {},
                getScrollInfo: () => ({ top: 0, left: 0 }),
                scrollTo: () => {},
              };

              const view: Partial<MarkdownView> = {
                file,
                editor: editor as Editor,
              };

              this.recalculator.recalculateCurrentNote(
                editor as Editor,
                view as MarkdownView,
                true
              );
            }
          } catch {
            // Silently skip files that can't be read
          }
        })
      );

      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  onunload() {}

  private registerEventHandlers(): void {
    this.registerEvent(
      this.app.workspace.on('editor-change', (editor: Editor) => {
        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (view) {
          this.recalculator.debounceRecalc(editor, view);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile && file.extension === 'md') {
          try {
            const content = await this.app.vault.read(file);

            if (!content.includes('|') || !content.includes('=')) {
              return;
            }

            if (
              content.includes('=SUM(') ||
              content.includes('=AVG(') ||
              content.includes('=MIN(') ||
              content.includes('=MAX(') ||
              content.includes('=NOTE(')
            ) {
              const editor: Partial<Editor> = {
                getValue: () => content,
                setValue: () => {},
                getCursor: () => ({ line: 0, ch: 0 }),
                setCursor: () => {},
                getScrollInfo: () => ({ top: 0, left: 0 }),
                scrollTo: () => {},
              };

              const view: Partial<MarkdownView> = {
                file,
                editor: editor as Editor,
              };

              this.recalculator.recalculateCurrentNote(
                editor as Editor,
                view as MarkdownView,
                true
              );
            }
          } catch {
            // Silently skip files that can't be processed
          }
        }
      })
    );
  }

  private processTablePreview(
    element: HTMLElement,
    context: MarkdownPostProcessorContext
  ): void {
    try {
      const tables = element.querySelectorAll('table');
      if (tables.length === 0) return;

      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !view.file) return;

      const file = view.file;
      const metadata = this.app.metadataCache.getFileCache(file);

      tables.forEach((table) => {
        const rows = Array.from(table.querySelectorAll('tr'));

        const tableData: string[][] = [];
        rows.forEach((row) => {
          const cells = Array.from(row.querySelectorAll('td, th'));
          const rowData = cells.map((cell) => {
            const text = cell.textContent?.trim() || '';
            return text;
          });
          tableData.push(rowData);
        });

        const evaluator = new FormulaEvaluator(
          this.settings,
          this.indexManager
        );

        const firstRow = tableData[0] || [];
        const firstRowNumbers = firstRow.filter(
          (c) => !isNaN(parseFloat(c)) && isFinite(parseFloat(c))
        );
        const isFirstRowHeader = firstRowNumbers.length < firstRow.length / 2;

        const tableRows: TableCell[][] = tableData.map((rowData, r) =>
          rowData.map((c, col) => {
            if (isFirstRowHeader && r === 0) {
              return {
                row: r,
                col: col,
                content: c,
                isFormula: c.startsWith('='),
                value: undefined,
              };
            }

            const isFormula = c.startsWith('=');
            const parsed = isFormula ? undefined : evaluator.parseNumber(c);

            return {
              row: r,
              col: col,
              content: c,
              isFormula: isFormula,
              value: parsed,
            };
          })
        );

        rows.forEach((row, rowIndex) => {
          const cells = Array.from(row.querySelectorAll('td, th'));

          cells.forEach((cell, cellIndex) => {
            const content = cell.textContent?.trim() || '';

            if (content.startsWith('=')) {
              const result = evaluator.evaluateFormula(
                content,
                tableRows,
                rowIndex,
                cellIndex,
                metadata,
                {}
              );

              if (result !== null) {
                tableRows[rowIndex][cellIndex].value = result;
              }
            }
          });
        });

        rows.forEach((row, rowIndex) => {
          const cells = Array.from(row.querySelectorAll('td, th'));

          cells.forEach((cell, cellIndex) => {
            const cellData = tableRows[rowIndex][cellIndex];

            if (cellData.isFormula && cellData.value !== undefined) {
              let currency = evaluator.extractCurrency(cellData.content);

              const noteMatch = cellData.content.match(
                /^=NOTE\("([^"]+)"\)\.(\w+)$/i
              );
              if (noteMatch && !currency) {
                currency = evaluator.getNoteCurrency(
                  noteMatch[1],
                  noteMatch[2]
                );
              }

              const formatted = evaluator.formatNumber(
                cellData.value,
                currency
              );
              cell.empty();
              cell.createEl('strong', { text: formatted });
              cell.setAttribute('data-formula', cellData.content);
              cell.classList.add('table-math-computed');
            }
          });
        });
      });
    } catch (error) {
      console.error('Table Math preview error:', error);
    }
  }

  async loadSettings() {
    this.settings = Object.assign(
      {},
      DEFAULT_SETTINGS,
      (await this.loadData()) as Partial<TableMathSettings>
    );
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
