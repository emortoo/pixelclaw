import * as vscode from 'vscode';
import { PixelClawViewProvider } from './PixelClawViewProvider.js';
import { VIEW_ID, COMMAND_SHOW_PANEL, COMMAND_EXPORT_DEFAULT_LAYOUT } from './constants.js';

let providerInstance: PixelClawViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
	const provider = new PixelClawViewProvider(context);
	providerInstance = provider;

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(VIEW_ID, provider)
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_SHOW_PANEL, () => {
			vscode.commands.executeCommand(`${VIEW_ID}.focus`);
		})
	);

	context.subscriptions.push(
		vscode.commands.registerCommand(COMMAND_EXPORT_DEFAULT_LAYOUT, () => {
			provider.exportDefaultLayout();
		})
	);
}

export function deactivate() {
	providerInstance?.dispose();
}
