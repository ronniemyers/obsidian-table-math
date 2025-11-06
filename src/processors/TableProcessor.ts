import { CachedMetadata } from 'obsidian';

import { TableCell, VaultIndexValue } from '../types';
import { FormulaEvaluator } from './FormulaEvaluator';

export class TableProcessor {
  private evaluator: FormulaEvaluator;

  private static readonly SEPARATOR_REGEX = /^[-:|\s]*$/;
  private static readonly MARKDOWN_REGEX = /\*\*|\*|_|~~(.+?)~~|==(.+?)==/g;

  constructor(evaluator: FormulaEvaluator) {
    this.evaluator = evaluator;
  }

  isTableLine(line: string): boolean {
    return line.trim().startsWith('|') && line.trim().endsWith('|');
  }

  extractTable(
    lines: string[],
    startIndex: number
  ): { table: string[]; startLine: number; endLine: number } | null {
    const table: string[] = [];
    let i = startIndex;

    while (i > 0 && this.isTableLine(lines[i - 1])) {
      i--;
    }
    const startLine = i;

    while (i < lines.length && this.isTableLine(lines[i])) {
      table.push(lines[i]);
      i++;
    }

    if (table.length < 2) {
      return null;
    }

    return { table, startLine, endLine: i - 1 };
  }

  processTable(
    table: string[],
    metadata: CachedMetadata | null,
    noteVariables: { [key: string]: VaultIndexValue }
  ): string[] {
    const rows: TableCell[][] = [];

    for (let r = 0; r < table.length; r++) {
      const line = table[r];
      const parts = line.split('|');
      const rowCells: TableCell[] = [];

      for (let c = 1; c < parts.length - 1; c++) {
        const content = parts[c].trim();
        const isFormula = content.charCodeAt(0) === 61;
        rowCells.push({
          row: r,
          col: c - 1,
          content,
          isFormula,
          value: isFormula ? undefined : this.evaluator.parseNumber(content),
        });
      }
      rows.push(rowCells);
    }

    const hasSeparator =
      rows.length > 1 &&
      rows[1].every((cell) =>
        TableProcessor.SEPARATOR_REGEX.test(cell.content)
      );

    for (let r = 0; r < rows.length; r++) {
      if (hasSeparator && r === 1) continue;

      for (let c = 0; c < rows[r].length; c++) {
        const cell = rows[r][c];
        if (cell.isFormula) {
          const result = this.evaluator.evaluateFormula(
            cell.content,
            rows,
            r,
            c,
            metadata,
            noteVariables
          );
          if (result !== null) {
            cell.value = result;
          }
        }
      }

      if (rows[r].length >= 2 && rows[r][0].content && !rows[r][0].isFormula) {
        const cleanName = rows[r][0].content
          .replace(TableProcessor.MARKDOWN_REGEX, '$1$2')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_|_$/g, '');

        const lastCell = rows[r][rows[r].length - 1];
        if (lastCell.value !== undefined) {
          const currency = lastCell.isFormula
            ? this.evaluator.extractCurrency(lastCell.content)
            : null;
          noteVariables[cleanName] = {
            value: lastCell.value,
            currency: currency || undefined,
          };
        }
      }
    }

    const newTable: string[] = [];
    for (let r = 0; r < rows.length; r++) {
      const cellContents = rows[r].map((cell) => {
        if (cell.isFormula && cell.value !== undefined) {
          const currency = this.evaluator.extractCurrency(cell.content);
          return this.evaluator.formatNumber(cell.value, currency);
        }
        return cell.content;
      });
      newTable.push('| ' + cellContents.join(' | ') + ' |');
    }

    return newTable;
  }
}
