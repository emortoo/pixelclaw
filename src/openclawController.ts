import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentState, PostMessageFn } from './types.js';
import { createAgentState, removeAgent, sendExistingAgents, startAgentFileWatching } from './agentManager.js';
import { processOpenClawLine } from './openclawParser.js';
import { reassignAgentToFile } from './fileWatcher.js';
import type { DiscoveredAgent } from './openclawAgentDiscovery.js';
import { discoverAgents, watchForNewAgents } from './openclawAgentDiscovery.js';
import type { LoadedAssets, LoadedFloorTiles, LoadedWallTiles, LoadedCharacterSprites } from './assetLoader.js';
import {
	loadFurnitureAssets,
	sendAssetsToWebview,
	loadFloorTiles,
	sendFloorTilesToWebview,
	loadWallTiles,
	sendWallTilesToWebview,
	loadCharacterSprites,
	sendCharacterSpritesToWebview,
	loadDefaultLayout,
} from './assetLoader.js';
import { readLayoutFromFile, writeLayoutToFile, watchLayoutFile } from './layoutPersistence.js';
import type { LayoutWatcher } from './layoutPersistence.js';
import { JSONL_POLL_INTERVAL_MS, AGENT_IDLE_TIMEOUT_MS } from './constants.js';

const PIXELCLAW_DIR = path.join(os.homedir(), '.pixelclaw');
const AGENTS_PERSIST_FILE = path.join(PIXELCLAW_DIR, 'agents.json');

export class OpenClawController {
	agents = new Map<number, AgentState>();
	nextAgentId = { current: 1 };

	// Timer/watcher maps
	fileWatchers = new Map<number, fs.FSWatcher>();
	pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
	waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
	permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();
	jsonlPollTimers = new Map<number, ReturnType<typeof setInterval>>();

	// Discovery state
	knownAgentIds = new Set<string>();
	knownSessionFiles = new Map<string, string>();
	discoveryHandle: { stop: () => void } | null = null;

	// Idle check timer
	idleCheckTimer: ReturnType<typeof setInterval> | null = null;

	// Agent-to-character persistence
	agentMeta: Record<string, { palette?: number; hueShift?: number; seatId?: string }> = {};

	// Layout
	defaultLayout: Record<string, unknown> | null = null;
	layoutWatcher: LayoutWatcher | null = null;

	// Sound settings
	soundEnabled = true;

	// Cached assets (loaded once, sent to each new client)
	private cachedCharSprites: LoadedCharacterSprites | null = null;
	private cachedFloorTiles: LoadedFloorTiles | null = null;
	private cachedWallTiles: LoadedWallTiles | null = null;
	private cachedFurnitureAssets: LoadedAssets | null = null;
	private assetsLoaded = false;

	private postMessage: PostMessageFn = () => {};

	setPostMessage(fn: PostMessageFn): void {
		this.postMessage = fn;
	}

	start(): void {
		this.loadPersistedAgentMeta();
		const discovered = discoverAgents();
		for (const d of discovered) {
			this.createAgentFromDiscovery(d);
		}

		this.discoveryHandle = watchForNewAgents(
			this.knownAgentIds,
			this.knownSessionFiles,
			(agent) => this.onNewAgent(agent),
			(agent) => this.onSessionChanged(agent),
		);

		// Periodic idle check: if no data for AGENT_IDLE_TIMEOUT_MS, mark as waiting
		this.idleCheckTimer = setInterval(() => {
			const now = Date.now();
			for (const [agentId, agent] of this.agents) {
				if (!agent.isWaiting && (now - agent.lastDataMs) > AGENT_IDLE_TIMEOUT_MS) {
					agent.isWaiting = true;
					this.postMessage({
						type: 'agentStatus',
						id: agentId,
						status: 'waiting',
					});
				}
			}
		}, 10_000); // Check every 10s
	}

	stop(): void {
		this.discoveryHandle?.stop();
		this.discoveryHandle = null;
		this.layoutWatcher?.dispose();
		this.layoutWatcher = null;
		if (this.idleCheckTimer) {
			clearInterval(this.idleCheckTimer);
			this.idleCheckTimer = null;
		}

		for (const id of [...this.agents.keys()]) {
			removeAgent(
				id, this.agents,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, () => this.persistAgentMeta(),
			);
		}
	}

	/**
	 * Handle webviewReady from a client. Sends full state to the specified target.
	 * Pass a target postMessage to avoid mutating the shared broadcast function.
	 */
	async handleWebviewReady(assetsRoot: string, target?: PostMessageFn): Promise<void> {
		const send = target || this.postMessage;

		// Load assets once (cached for subsequent clients)
		if (!this.assetsLoaded) {
			try {
				this.cachedCharSprites = await loadCharacterSprites(assetsRoot);
				this.cachedFloorTiles = await loadFloorTiles(assetsRoot);
				this.cachedWallTiles = await loadWallTiles(assetsRoot);
				this.cachedFurnitureAssets = await loadFurnitureAssets(assetsRoot);
				this.defaultLayout = loadDefaultLayout(assetsRoot);
				this.assetsLoaded = true;
			} catch (err) {
				console.error('[OpenClawController] Error loading assets:', err);
			}
		}

		// Send settings
		send({ type: 'settingsLoaded', soundEnabled: this.soundEnabled });

		// Send cached assets to this client
		if (this.cachedCharSprites) {
			sendCharacterSpritesToWebview(send, this.cachedCharSprites);
		}
		if (this.cachedFloorTiles) {
			sendFloorTilesToWebview(send, this.cachedFloorTiles);
		}
		if (this.cachedWallTiles) {
			sendWallTilesToWebview(send, this.cachedWallTiles);
		}
		if (this.cachedFurnitureAssets) {
			sendAssetsToWebview(send, this.cachedFurnitureAssets);
		}

		// Send layout
		this.sendLayout(send);
		this.startLayoutWatcher();

		// Send existing agents
		sendExistingAgents(this.agents, this.agentMeta, send);
	}

	handleMessage(message: Record<string, unknown>): void {
		const type = message.type as string;

		if (type === 'saveLayout') {
			this.layoutWatcher?.markOwnWrite();
			writeLayoutToFile(message.layout as Record<string, unknown>);
		} else if (type === 'saveAgentSeats') {
			this.agentMeta = message.seats as Record<string, { palette?: number; hueShift?: number; seatId?: string }>;
			this.persistAgentMeta();
		} else if (type === 'setSoundEnabled') {
			this.soundEnabled = message.enabled as boolean;
			this.persistAgentMeta(); // Sound setting saved alongside agent meta
		} else if (type === 'closeAgent') {
			const agentId = message.id as number;
			removeAgent(
				agentId, this.agents,
				this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
				this.jsonlPollTimers, () => this.persistAgentMeta(),
			);
			this.postMessage({ type: 'agentClosed', id: agentId });
		} else if (type === 'openClaude' || type === 'focusAgent') {
			// No-op in standalone mode — agents are discovered automatically
		}
	}

	private createAgentFromDiscovery(discovered: DiscoveredAgent): number {
		const id = this.nextAgentId.current++;
		const agent = createAgentState(
			id,
			discovered.agentId,
			discovered.sessionsDir,
			discovered.latestSessionFile,
			discovered.agentId, // Use agentId as folderName for labeling
		);

		this.agents.set(id, agent);
		this.knownAgentIds.add(discovered.agentId);
		this.knownSessionFiles.set(discovered.agentId, discovered.latestSessionFile);

		console.log(`[OpenClawController] Agent ${id}: created for OpenClaw agent "${discovered.agentId}" (session: ${path.basename(discovered.latestSessionFile)})`);

		// Skip to end of existing data for existing agents (don't replay history)
		try {
			if (fs.existsSync(discovered.latestSessionFile)) {
				const stat = fs.statSync(discovered.latestSessionFile);
				agent.fileOffset = stat.size;
			}
		} catch { /* ignore */ }

		// Start file watching
		startAgentFileWatching(
			id, this.agents,
			this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
			this.postMessage, processOpenClawLine,
		);

		// Notify webview
		this.postMessage({ type: 'agentCreated', id, folderName: discovered.agentId });

		return id;
	}

	private onNewAgent(discovered: DiscoveredAgent): void {
		console.log(`[OpenClawController] New agent discovered: ${discovered.agentId}`);
		this.createAgentFromDiscovery(discovered);
	}

	private onSessionChanged(discovered: DiscoveredAgent): void {
		// Find existing agent by openclawAgentId
		let agentId: number | null = null;
		for (const [id, agent] of this.agents) {
			if (agent.openclawAgentId === discovered.agentId) {
				agentId = id;
				break;
			}
		}
		if (agentId === null) return;

		console.log(`[OpenClawController] Session changed for agent ${discovered.agentId}: ${path.basename(discovered.latestSessionFile)}`);
		reassignAgentToFile(
			agentId, discovered.latestSessionFile,
			this.agents, this.fileWatchers, this.pollingTimers, this.waitingTimers, this.permissionTimers,
			this.postMessage, processOpenClawLine, () => this.persistAgentMeta(),
		);
	}

	private sendLayout(target?: PostMessageFn): void {
		const send = target || this.postMessage;
		const fromFile = readLayoutFromFile();
		if (fromFile) {
			send({ type: 'layoutLoaded', layout: fromFile });
		} else if (this.defaultLayout) {
			writeLayoutToFile(this.defaultLayout);
			send({ type: 'layoutLoaded', layout: this.defaultLayout });
		} else {
			send({ type: 'layoutLoaded', layout: null });
		}
	}

	private startLayoutWatcher(): void {
		if (this.layoutWatcher) return;
		this.layoutWatcher = watchLayoutFile((layout) => {
			console.log('[OpenClawController] External layout change — pushing to webview');
			this.postMessage({ type: 'layoutLoaded', layout });
		});
	}

	private loadPersistedAgentMeta(): void {
		try {
			if (fs.existsSync(AGENTS_PERSIST_FILE)) {
				const raw = fs.readFileSync(AGENTS_PERSIST_FILE, 'utf-8');
				const data = JSON.parse(raw);
				this.agentMeta = data.agentMeta || {};
				this.soundEnabled = data.soundEnabled ?? true;
				// Restore next agent ID
				if (typeof data.nextAgentId === 'number') {
					this.nextAgentId.current = data.nextAgentId;
				}
			}
		} catch {
			// Fresh start
		}
	}

	private persistAgentMeta(): void {
		try {
			if (!fs.existsSync(PIXELCLAW_DIR)) {
				fs.mkdirSync(PIXELCLAW_DIR, { recursive: true });
			}
			const data = {
				agentMeta: this.agentMeta,
				soundEnabled: this.soundEnabled,
				nextAgentId: this.nextAgentId.current,
			};
			const json = JSON.stringify(data, null, 2);
			const tmpPath = AGENTS_PERSIST_FILE + '.tmp';
			fs.writeFileSync(tmpPath, json, 'utf-8');
			fs.renameSync(tmpPath, AGENTS_PERSIST_FILE);
		} catch (err) {
			console.error('[OpenClawController] Failed to persist agent meta:', err);
		}
	}
}
