import * as path from 'path';
import type { AgentState, PostMessageFn } from './types.js';
import {
	cancelWaitingTimer,
	startWaitingTimer,
	clearAgentActivity,
	startPermissionTimer,
} from './timerManager.js';
import {
	TOOL_DONE_DELAY_MS,
	TEXT_IDLE_DELAY_MS,
	BASH_COMMAND_DISPLAY_MAX_LENGTH,
} from './constants.js';

const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion']);

/** Counter per agent for generating tool IDs (OpenClaw toolCalls lack IDs) */
const toolIdCounters = new Map<number, number>();

function nextToolId(agentId: number): string {
	const seq = (toolIdCounters.get(agentId) || 0) + 1;
	toolIdCounters.set(agentId, seq);
	return `oc-${agentId}-${seq}`;
}

export function formatOpenClawToolStatus(toolName: string, input: Record<string, unknown>): string {
	const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : '';
	const lower = toolName.toLowerCase();

	switch (lower) {
		case 'read': return `Reading ${base(input.file_path || input.path)}`;
		case 'write': return `Writing ${base(input.file_path || input.path)}`;
		case 'edit':
		case 'patch':
		case 'multiedit': return `Editing ${base(input.file_path || input.path)}`;
		case 'glob': return 'Searching files';
		case 'grep':
		case 'search': return 'Searching code';
		case 'exec':
		case 'bash':
		case 'shell': {
			const cmd = (input.command as string) || '';
			return `Running: ${cmd.length > BASH_COMMAND_DISPLAY_MAX_LENGTH ? cmd.slice(0, BASH_COMMAND_DISPLAY_MAX_LENGTH) + '\u2026' : cmd}`;
		}
		case 'browser':
		case 'fetch':
		case 'websearch': return 'Fetching web content';
		case 'todoread': return 'Reading todos';
		case 'todowrite': return 'Writing todos';
		case 'ls': return 'Searching files';
		default: return `Using ${toolName}`;
	}
}

export function processOpenClawLine(
	agentId: number,
	line: string,
	agents: Map<number, AgentState>,
	waitingTimers: Map<number, ReturnType<typeof setTimeout>>,
	permissionTimers: Map<number, ReturnType<typeof setTimeout>>,
	postMessage: PostMessageFn,
): void {
	const agent = agents.get(agentId);
	if (!agent) return;

	let record: Record<string, unknown>;
	try {
		record = JSON.parse(line);
	} catch {
		return; // Silently skip malformed lines
	}

	const type = record.type as string | undefined;

	// Skip session records
	if (type === 'session') return;

	if (type !== 'message') return;

	const message = record.message as Record<string, unknown> | undefined;
	const role = message?.role as string | undefined;
	const content = message?.content;

	if (role === 'assistant') {
		if (!Array.isArray(content)) {
			// Text-only string content
			if (typeof content === 'string' && content.trim() && !agent.hadToolsInTurn) {
				startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, postMessage);
			}
			return;
		}

		const blocks = content as Array<Record<string, unknown>>;
		const toolCalls = blocks.filter(b => b.type === 'toolCall');
		const hasText = blocks.some(b => b.type === 'text' && typeof b.text === 'string' && (b.text as string).trim());

		if (toolCalls.length > 0) {
			cancelWaitingTimer(agentId, waitingTimers);
			agent.isWaiting = false;
			agent.hadToolsInTurn = true;
			postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

			let hasNonExemptTool = false;
			for (const tc of toolCalls) {
				const toolName = (tc.name as string) || '';
				const toolInput = (tc.arguments as Record<string, unknown>) || {};
				const toolId = nextToolId(agentId);
				const status = formatOpenClawToolStatus(toolName, toolInput);

				console.log(`[PixelClaw] Agent ${agentId} tool start: ${toolId} ${status}`);
				agent.activeToolIds.add(toolId);
				agent.activeToolStatuses.set(toolId, status);
				agent.activeToolNames.set(toolId, toolName);
				agent.toolQueue.push(toolId);

				if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
					hasNonExemptTool = true;
				}

				postMessage({
					type: 'agentToolStart',
					id: agentId,
					toolId,
					status,
				});
			}

			if (hasNonExemptTool) {
				startPermissionTimer(agentId, agents, permissionTimers, PERMISSION_EXEMPT_TOOLS, postMessage);
			}
		} else if (hasText && !agent.hadToolsInTurn) {
			// Text-only response, no tools used in this turn
			startWaitingTimer(agentId, TEXT_IDLE_DELAY_MS, agents, waitingTimers, postMessage);
		}
	} else if (role === 'toolResult') {
		// FIFO dequeue: match to oldest active tool
		if (agent.toolQueue.length > 0) {
			const completedToolId = agent.toolQueue.shift()!;
			console.log(`[PixelClaw] Agent ${agentId} tool done: ${completedToolId}`);

			agent.activeToolIds.delete(completedToolId);
			agent.activeToolStatuses.delete(completedToolId);
			agent.activeToolNames.delete(completedToolId);

			const toolId = completedToolId;
			setTimeout(() => {
				postMessage({
					type: 'agentToolDone',
					id: agentId,
					toolId,
				});
			}, TOOL_DONE_DELAY_MS);

			// All tools completed — reset for text-idle detection
			if (agent.activeToolIds.size === 0) {
				agent.hadToolsInTurn = false;
			}
		}
	} else if (role === 'user') {
		// New user prompt — new turn starting
		cancelWaitingTimer(agentId, waitingTimers);
		clearAgentActivity(agent, agentId, permissionTimers, postMessage);
		agent.hadToolsInTurn = false;
		agent.toolQueue = [];
	}
}
