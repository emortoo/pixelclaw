export type PostMessageFn = (msg: Record<string, unknown>) => void;

export interface AgentState {
	id: number;
	openclawAgentId: string;
	sessionsDir: string;
	jsonlFile: string;
	fileOffset: number;
	lineBuffer: string;
	activeToolIds: Set<string>;
	activeToolStatuses: Map<string, string>;
	activeToolNames: Map<string, string>;
	activeSubagentToolIds: Map<string, Set<string>>; // parentToolId → active sub-tool IDs
	activeSubagentToolNames: Map<string, Map<string, string>>; // parentToolId → (subToolId → toolName)
	isWaiting: boolean;
	permissionSent: boolean;
	hadToolsInTurn: boolean;
	toolQueue: string[]; // FIFO for OpenClaw tool result matching
	lastDataMs: number; // timestamp of last JSONL data received
	folderName?: string;
}

export interface PersistedAgent {
	id: number;
	openclawAgentId: string;
	jsonlFile: string;
	sessionsDir: string;
}
