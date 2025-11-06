export interface TableMathSettings {
  precision: number;
  locale: string;
}

export const DEFAULT_SETTINGS: TableMathSettings = {
  precision: 2,
  locale: 'en-US',
};

export interface VaultIndexValue {
  value: number;
  currency?: string;
}

export interface VaultIndex {
  [noteName: string]: {
    [variableName: string]: VaultIndexValue;
  };
}

export interface TableCell {
  row: number;
  col: number;
  content: string;
  isFormula: boolean;
  value?: number;
}
