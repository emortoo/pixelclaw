import * as fs from 'fs';
import * as path from 'path';
import {
	OPENCLAW_AGENTS_DIR,
	OPENCLAW_SESSIONS_SUBDIR,
	AGENT_DISCOVERY_INTERVAL_MS,
	SESSION_ACTIVE_WINDOW_MS,
} from './constants.js';

export interface DiscoveredAgent {
	agentId: string;           // directory name under ~/.openclaw/agents/
	sessionsDir: string;       // full path to sessions/ directory
	latestSessionFile: string; // full path to most recent .jsonl
	isActive: boolean;         // modified within SESSION_ACTIVE_WINDOW_MS
	lastModifiedMs: number;
}

export function getLatestSession(sessionsDir: string): string | null {
	let files: string[];
	try {
		files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.jsonl'));
	} catch {
		return null;
	}
	if (files.length === 0) return null;

	let latest: string | null = null;
	let latestMtime = 0;
	for (const file of files) {
		const full = path.join(sessionsDir, file);
		try {
			const stat = fs.statSync(full);
			if (stat.mtimeMs > latestMtime) {
				latestMtime = stat.mtimeMs;
				latest = full;
			}
		} catch { /* skip */ }
	}
	return latest;
}

export function discoverAgents(): DiscoveredAgent[] {
	const agents: DiscoveredAgent[] = [];
	let entries: string[];
	try {
		entries = fs.readdirSync(OPENCLAW_AGENTS_DIR);
	} catch {
		return agents; // Directory doesn't exist yet
	}

	const now = Date.now();

	for (const entry of entries) {
		const agentDir = path.join(OPENCLAW_AGENTS_DIR, entry);
		try {
			const stat = fs.statSync(agentDir);
			if (!stat.isDirectory()) continue;
		} catch { continue; }

		const sessionsDir = path.join(agentDir, OPENCLAW_SESSIONS_SUBDIR);
		try {
			const stat = fs.statSync(sessionsDir);
			if (!stat.isDirectory()) continue;
		} catch { continue; }

		const latestSessionFile = getLatestSession(sessionsDir);
		if (!latestSessionFile) continue;

		let lastModifiedMs = 0;
		try {
			lastModifiedMs = fs.statSync(latestSessionFile).mtimeMs;
		} catch { continue; }

		agents.push({
			agentId: entry,
			sessionsDir,
			latestSessionFile,
			isActive: (now - lastModifiedMs) < SESSION_ACTIVE_WINDOW_MS,
			lastModifiedMs,
		});
	}

	return agents;
}

export function watchForNewAgents(
	knownAgentIds: Set<string>,
	knownSessionFiles: Map<string, string>,
	onNewAgent: (agent: DiscoveredAgent) => void,
	onAgentSessionChanged: (agent: DiscoveredAgent) => void,
): { stop: () => void } {
	const timer = setInterval(() => {
		const discovered = discoverAgents();
		for (const agent of discovered) {
			if (!knownAgentIds.has(agent.agentId)) {
				knownAgentIds.add(agent.agentId);
				knownSessionFiles.set(agent.agentId, agent.latestSessionFile);
				onNewAgent(agent);
			} else {
				// Check if session file changed
				const prev = knownSessionFiles.get(agent.agentId);
				if (prev && prev !== agent.latestSessionFile) {
					knownSessionFiles.set(agent.agentId, agent.latestSessionFile);
					onAgentSessionChanged(agent);
				}
			}
		}
	}, AGENT_DISCOVERY_INTERVAL_MS);

	return {
		stop(): void {
			clearInterval(timer);
		},
	};
}
