import { App } from 'obsidian';

import { VaultIndex, VaultIndexValue } from '../types';

export class VaultIndexManager {
	private app: App;
	private vaultIndex: VaultIndex = {};
	private pluginDir: string;
	private dataFileName = 'data.json';
	private formulaCache: Map<string, Map<string, string>> = new Map();

	constructor(app: App, pluginId: string) {
		this.app = app;
		this.pluginDir = `${app.vault.configDir}/plugins/${pluginId}`;
	}

	async load(): Promise<void> {
		try {
			const dataPath = `${this.pluginDir}/${this.dataFileName}`;
			const data = await this.app.vault.adapter.read(dataPath);
			this.vaultIndex = JSON.parse(data);
		} catch (error) {
			this.vaultIndex = {};
		}
	}

	async save(): Promise<void> {
		const dataPath = `${this.pluginDir}/${this.dataFileName}`;
		await this.app.vault.adapter.write(
			dataPath,
			JSON.stringify(this.vaultIndex, null, 2)
		);
	}

	getIndex(): VaultIndex {
		return this.vaultIndex;
	}

	updateNote(noteName: string, variables: { [key: string]: VaultIndexValue }): void {
		if (Object.keys(variables).length > 0) {
			this.vaultIndex[noteName] = variables;
		}
	}

	getNoteValue(noteName: string, variableName: string): VaultIndexValue | null {
		if (this.vaultIndex[noteName] && this.vaultIndex[noteName][variableName] !== undefined) {
			return this.vaultIndex[noteName][variableName];
		}
		return null;
	}

	private computedValues: Map<string, Map<string, string>> = new Map();

	storeFormula(noteName: string, cellKey: string, formula: string): void {
		if (!this.formulaCache.has(noteName)) {
			this.formulaCache.set(noteName, new Map());
		}
		this.formulaCache.get(noteName)!.set(cellKey, formula);
	}

	getFormula(noteName: string, cellKey: string): string | null {
		return this.formulaCache.get(noteName)?.get(cellKey) || null;
	}

	storeComputedValue(noteName: string, cellKey: string, value: string): void {
		if (!this.computedValues.has(noteName)) {
			this.computedValues.set(noteName, new Map());
		}
		this.computedValues.get(noteName)!.set(cellKey, value);
	}

	getComputedValue(noteName: string, cellKey: string): string | null {
		return this.computedValues.get(noteName)?.get(cellKey) || null;
	}
}

