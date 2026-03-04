import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { OpenClawController } from './openclawController.js';
import { readLayoutFromFile, writeLayoutToFile } from './layoutPersistence.js';
import { GLOBAL_KEY_SOUND_ENABLED } from './constants.js';

export class PixelClawViewProvider implements vscode.WebviewViewProvider {
	private controller: OpenClawController;
	private webviewView: vscode.WebviewView | undefined;

	constructor(private readonly context: vscode.ExtensionContext) {
		this.controller = new OpenClawController();
	}

	private get extensionUri(): vscode.Uri {
		return this.context.extensionUri;
	}

	resolveWebviewView(webviewView: vscode.WebviewView) {
		this.webviewView = webviewView;
		webviewView.webview.options = { enableScripts: true };
		webviewView.webview.html = getWebviewContent(webviewView.webview, this.extensionUri);

		this.controller.setPostMessage((msg) => {
			webviewView.webview.postMessage(msg);
		});

		// Restore sound setting from VS Code global state
		const soundEnabled = this.context.globalState.get<boolean>(GLOBAL_KEY_SOUND_ENABLED, true);
		this.controller.soundEnabled = soundEnabled;

		// Start agent discovery
		this.controller.start();

		webviewView.webview.onDidReceiveMessage(async (message) => {
			if (message.type === 'webviewReady') {
				const extensionPath = this.extensionUri.fsPath;
				const bundledAssetsDir = path.join(extensionPath, 'dist', 'assets');
				let assetsRoot: string | null = null;

				if (fs.existsSync(bundledAssetsDir)) {
					assetsRoot = path.join(extensionPath, 'dist');
				} else {
					const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
					if (workspaceRoot) {
						assetsRoot = workspaceRoot;
					}
				}

				if (assetsRoot) {
					await this.controller.handleWebviewReady(assetsRoot);
				} else {
					console.log('[Extension] No assets directory found');
				}
			} else if (message.type === 'saveLayout') {
				this.controller.handleMessage(message);
			} else if (message.type === 'saveAgentSeats') {
				this.controller.handleMessage(message);
			} else if (message.type === 'setSoundEnabled') {
				this.context.globalState.update(GLOBAL_KEY_SOUND_ENABLED, message.enabled);
				this.controller.handleMessage(message);
			} else if (message.type === 'closeAgent') {
				this.controller.handleMessage(message);
			} else if (message.type === 'openClaude' || message.type === 'focusAgent') {
				// No-op in OpenClaw mode — agents are discovered automatically
			} else if (message.type === 'exportLayout') {
				const layout = readLayoutFromFile();
				if (!layout) {
					vscode.window.showWarningMessage('PixelClaw: No saved layout to export.');
					return;
				}
				const uri = await vscode.window.showSaveDialog({
					filters: { 'JSON Files': ['json'] },
					defaultUri: vscode.Uri.file(path.join(os.homedir(), 'pixelclaw-layout.json')),
				});
				if (uri) {
					fs.writeFileSync(uri.fsPath, JSON.stringify(layout, null, 2), 'utf-8');
					vscode.window.showInformationMessage('PixelClaw: Layout exported successfully.');
				}
			} else if (message.type === 'importLayout') {
				const uris = await vscode.window.showOpenDialog({
					filters: { 'JSON Files': ['json'] },
					canSelectMany: false,
				});
				if (!uris || uris.length === 0) return;
				try {
					const raw = fs.readFileSync(uris[0].fsPath, 'utf-8');
					const imported = JSON.parse(raw) as Record<string, unknown>;
					if (imported.version !== 1 || !Array.isArray(imported.tiles)) {
						vscode.window.showErrorMessage('PixelClaw: Invalid layout file.');
						return;
					}
					this.controller.handleMessage({ type: 'saveLayout', layout: imported });
					webviewView.webview.postMessage({ type: 'layoutLoaded', layout: imported });
					vscode.window.showInformationMessage('PixelClaw: Layout imported successfully.');
				} catch {
					vscode.window.showErrorMessage('PixelClaw: Failed to read or parse layout file.');
				}
			}
		});
	}

	/** Export current saved layout to webview-ui/public/assets/default-layout.json (dev utility) */
	exportDefaultLayout(): void {
		const layout = readLayoutFromFile();
		if (!layout) {
			vscode.window.showWarningMessage('PixelClaw: No saved layout found.');
			return;
		}
		const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
		if (!workspaceRoot) {
			vscode.window.showErrorMessage('PixelClaw: No workspace folder found.');
			return;
		}
		const targetPath = path.join(workspaceRoot, 'webview-ui', 'public', 'assets', 'default-layout.json');
		const json = JSON.stringify(layout, null, 2);
		fs.writeFileSync(targetPath, json, 'utf-8');
		vscode.window.showInformationMessage(`PixelClaw: Default layout exported to ${targetPath}`);
	}

	dispose() {
		this.controller.stop();
	}
}

export function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
	const distPath = vscode.Uri.joinPath(extensionUri, 'dist', 'webview');
	const indexPath = vscode.Uri.joinPath(distPath, 'index.html').fsPath;

	let html = fs.readFileSync(indexPath, 'utf-8');

	html = html.replace(/(href|src)="\.\/([^"]+)"/g, (_match, attr, filePath) => {
		const fileUri = vscode.Uri.joinPath(distPath, filePath);
		const webviewUri = webview.asWebviewUri(fileUri);
		return `${attr}="${webviewUri}"`;
	});

	return html;
}
