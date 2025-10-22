import { App, PluginSettingTab, Setting } from 'obsidian';

import type TableMathPlugin from '../main';

export class TableMathSettingTab extends PluginSettingTab {
	plugin: TableMathPlugin;

	constructor(app: App, plugin: TableMathPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Precision')
			.setDesc('Number of decimal places to display (0-10)')
			.addText((text: any) => text
				.setPlaceholder('2')
				.setValue(String(this.plugin.settings.precision))
				.onChange(async (value: string) => {
					const num = parseInt(value);
					if (!isNaN(num) && num >= 0 && num <= 10) {
						this.plugin.settings.precision = num;
						await this.plugin.saveSettings();
						this.app.workspace.trigger('layout-change');
					}
				}));

		new Setting(containerEl)
			.setName('Locale')
			.setDesc('Locale for number formatting (en-US, de-DE, fr-FR)')
			.addText((text: any) => text
				.setPlaceholder('en-US')
				.setValue(this.plugin.settings.locale)
				.onChange(async (value: string) => {
					this.plugin.settings.locale = value;
					await this.plugin.saveSettings();
					this.app.workspace.trigger('layout-change');
				}));
	}
}

