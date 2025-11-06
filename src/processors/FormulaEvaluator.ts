import { CachedMetadata } from 'obsidian';

import { TableCell, TableMathSettings, VaultIndexValue } from '../types';
import { VaultIndexManager } from '../managers/VaultIndexManager';

export class FormulaEvaluator {
  private settings: TableMathSettings;
  private indexManager: VaultIndexManager;

  private static readonly FUNCTION_PATTERNS = {
    SUM: /SUM\((col|row)(?:,\s*(?:[A-Z]{3}|data))*\)/gi,
    AVG: /AVG\((col|row)(?:,\s*(?:[A-Z]{3}|data))*\)/gi,
    MIN: /MIN\((col|row)(?:,\s*(?:[A-Z]{3}|data))*\)/gi,
    MAX: /MAX\((col|row)(?:,\s*(?:[A-Z]{3}|data))*\)/gi,
    NOTE: /NOTE\("([^"]+)"\)\.(\w+)/gi,
  };

  constructor(settings: TableMathSettings, indexManager: VaultIndexManager) {
    this.settings = settings;
    this.indexManager = indexManager;
  }

  evaluateFormula(
    formula: string,
    rows: TableCell[][],
    currentRow: number,
    currentCol: number,
    metadata: CachedMetadata | null,
    noteVariables: { [key: string]: VaultIndexValue }
  ): number | null {
    const expr = formula.substring(1).trim();

    try {
      let processedExpr = expr;

      FormulaEvaluator.FUNCTION_PATTERNS.SUM.lastIndex = 0;
      processedExpr = processedExpr.replace(
        FormulaEvaluator.FUNCTION_PATTERNS.SUM,
        (match) => {
          const { range, dataOnly } = this.parseRangeArgs(match);
          const result = this.evaluateSUM(
            range,
            rows,
            currentRow,
            currentCol,
            dataOnly
          );
          return result !== null ? result.toString() : 'null';
        }
      );

      FormulaEvaluator.FUNCTION_PATTERNS.AVG.lastIndex = 0;
      processedExpr = processedExpr.replace(
        FormulaEvaluator.FUNCTION_PATTERNS.AVG,
        (match) => {
          const { range, dataOnly } = this.parseRangeArgs(match);
          const result = this.evaluateAVG(
            range,
            rows,
            currentRow,
            currentCol,
            dataOnly
          );
          return result !== null ? result.toString() : 'null';
        }
      );

      FormulaEvaluator.FUNCTION_PATTERNS.MIN.lastIndex = 0;
      processedExpr = processedExpr.replace(
        FormulaEvaluator.FUNCTION_PATTERNS.MIN,
        (match) => {
          const { range, dataOnly } = this.parseRangeArgs(match);
          const result = this.evaluateMIN(
            range,
            rows,
            currentRow,
            currentCol,
            dataOnly
          );
          return result !== null ? result.toString() : 'null';
        }
      );

      FormulaEvaluator.FUNCTION_PATTERNS.MAX.lastIndex = 0;
      processedExpr = processedExpr.replace(
        FormulaEvaluator.FUNCTION_PATTERNS.MAX,
        (match) => {
          const { range, dataOnly } = this.parseRangeArgs(match);
          const result = this.evaluateMAX(
            range,
            rows,
            currentRow,
            currentCol,
            dataOnly
          );
          return result !== null ? result.toString() : 'null';
        }
      );

      FormulaEvaluator.FUNCTION_PATTERNS.NOTE.lastIndex = 0;
      processedExpr = processedExpr.replace(
        FormulaEvaluator.FUNCTION_PATTERNS.NOTE,
        (_match, noteName: string, varName: string) => {
          const result = this.evaluateNOTE(noteName, varName);
          return result !== null ? result.toString() : 'null';
        }
      );

      if (processedExpr.includes('null')) {
        return null;
      }

      const result = this.evaluateExpression(processedExpr);
      return result;
    } catch {
      return null;
    }
  }

  private parseRangeArgs(functionCall: string): {
    range: string;
    dataOnly: boolean;
  } {
    const argsMatch = functionCall.match(/\(([^)]+)\)/);
    if (!argsMatch) return { range: '', dataOnly: false };

    const args = argsMatch[1].split(',').map((a) => a.trim());
    const range = args[0];
    const dataOnly = args.some((arg) => arg.toLowerCase() === 'data');

    return { range, dataOnly };
  }

  extractCurrency(formula: string): string | null {
    const match = formula.match(/,\s*([A-Z]{3})(?:\s*,|\s*\))/i);
    return match ? match[1].toUpperCase() : null;
  }

  private evaluateSUM(
    args: string,
    rows: TableCell[][],
    currentRow: number,
    currentCol: number,
    dataOnly: boolean = false
  ): number | null {
    const values = this.getRangeValues(
      args,
      rows,
      currentRow,
      currentCol,
      dataOnly
    );
    if (values.length === 0) return null;
    return values.reduce((sum, val) => sum + val, 0);
  }

  private evaluateAVG(
    args: string,
    rows: TableCell[][],
    currentRow: number,
    currentCol: number,
    dataOnly: boolean = false
  ): number | null {
    const values = this.getRangeValues(
      args,
      rows,
      currentRow,
      currentCol,
      dataOnly
    );
    if (values.length === 0) return null;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  private evaluateMIN(
    args: string,
    rows: TableCell[][],
    currentRow: number,
    currentCol: number,
    dataOnly: boolean = false
  ): number | null {
    const values = this.getRangeValues(
      args,
      rows,
      currentRow,
      currentCol,
      dataOnly
    );
    if (values.length === 0) return null;
    return Math.min(...values);
  }

  private evaluateMAX(
    args: string,
    rows: TableCell[][],
    currentRow: number,
    currentCol: number,
    dataOnly: boolean = false
  ): number | null {
    const values = this.getRangeValues(
      args,
      rows,
      currentRow,
      currentCol,
      dataOnly
    );
    if (values.length === 0) return null;
    return Math.max(...values);
  }

  private evaluateNOTE(noteName: string, variableName: string): number | null {
    const result = this.indexManager.getNoteValue(noteName, variableName);
    return result ? result.value : null;
  }

  getNoteCurrency(noteName: string, variableName: string): string | null {
    const result = this.indexManager.getNoteValue(noteName, variableName);
    return result?.currency || null;
  }

  private getRangeValues(
    range: string,
    rows: TableCell[][],
    currentRow: number,
    currentCol: number,
    dataOnly: boolean = false
  ): number[] {
    const values: number[] = [];
    const normalizedRange = range.trim().toLowerCase();

    const hasSeparator =
      rows.length > 1 &&
      rows[1].every((cell) => /^[-:|\s]*$/.test(cell.content));

    if (normalizedRange === 'row') {
      for (const cell of rows[currentRow]) {
        if (cell.col !== currentCol && cell.value !== undefined) {
          if (dataOnly && cell.isFormula) {
            continue;
          }
          values.push(cell.value);
        }
      }
    } else if (normalizedRange === 'col') {
      for (let r = 0; r < rows.length; r++) {
        if (
          r !== currentRow &&
          !(hasSeparator && r === 1) &&
          rows[r][currentCol]
        ) {
          const cell = rows[r][currentCol];
          if (cell.value !== undefined) {
            if (dataOnly && cell.isFormula) {
              continue;
            }
            values.push(cell.value);
          }
        }
      }
    }

    return values;
  }

  private evaluateExpression(expr: string): number {
    const sanitized = expr.replace(/[^0-9+\-*/.() ]/g, '');
    if (sanitized.length === 0) {
      throw new Error('Invalid expression');
    }
    try {
      return this.parseExpression(sanitized);
    } catch {
      throw new Error('Failed to evaluate expression');
    }
  }

  private parseExpression(expr: string): number {
    let pos = 0;

    const peek = (): string => expr[pos] || '';
    const consume = (): string => expr[pos++] || '';

    const parseNumber = (): number => {
      let num = '';
      while (
        pos < expr.length &&
        (peek().match(/[0-9.]/) || (peek() === '-' && num === ''))
      ) {
        num += consume();
      }
      const result = parseFloat(num);
      if (isNaN(result)) throw new Error('Invalid number');
      return result;
    };

    const parseFactor = (): number => {
      while (peek() === ' ') consume();

      if (peek() === '(') {
        consume(); // consume '('
        const result = parseAddSub();
        if (consume() !== ')') throw new Error('Mismatched parentheses');
        return result;
      }

      return parseNumber();
    };

    const parseMulDiv = (): number => {
      let left = parseFactor();

      while (peek() === '*' || peek() === '/') {
        const op = consume();
        const right = parseFactor();
        if (op === '*') {
          left = left * right;
        } else {
          if (right === 0) throw new Error('Division by zero');
          left = left / right;
        }
      }

      return left;
    };

    const parseAddSub = (): number => {
      let left = parseMulDiv();

      while (peek() === '+' || (peek() === '-' && pos > 0)) {
        const op = consume();
        const right = parseMulDiv();
        if (op === '+') {
          left = left + right;
        } else {
          left = left - right;
        }
      }

      return left;
    };

    return parseAddSub();
  }

  formatNumber(num: number, currency?: string | null): string {
    if (currency) {
      try {
        return num.toLocaleString(this.settings.locale, {
          style: 'currency',
          currency: currency,
          minimumFractionDigits: this.settings.precision,
          maximumFractionDigits: this.settings.precision,
        });
      } catch {
        return num.toLocaleString(this.settings.locale, {
          minimumFractionDigits: this.settings.precision,
          maximumFractionDigits: this.settings.precision,
        });
      }
    }

    return num.toLocaleString(this.settings.locale, {
      minimumFractionDigits: 0,
      maximumFractionDigits: this.settings.precision,
    });
  }

  parseNumber(text: string): number | undefined {
    const cleaned = text.replace(/[,$€£¥₹]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? undefined : num;
  }
}
