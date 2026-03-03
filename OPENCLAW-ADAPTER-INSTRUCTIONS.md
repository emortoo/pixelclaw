# Pixel Agents → OpenClaw Live Monitor: Implementation Instructions

## Project Context

This is a fork of [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents) — a VS Code extension that visualizes AI coding agents as animated pixel art characters in a virtual office. The original only works with Claude Code terminals.

**Goal:** Modify this fork so it monitors **OpenClaw agents** instead of Claude Code terminals, then extract the whole thing into a **standalone web app** (no VS Code dependency) that can be accessed from a browser or phone.

**End result:** A live pixel-art dashboard where each OpenClaw agent appears as an animated character. Characters walk around, sit at desks, type when the agent runs tools, show speech bubbles when waiting for input, and idle when inactive. Accessible via `http://localhost:3847` or over Tailscale from mobile.

---

## Important: Read Before Starting

- **Do NOT modify anything in `webview-ui/src/office/`** (sprites, game engine, canvas rendering) unless absolutely necessary for the integration. The rendering layer is already complete and works perfectly.
- The webview receives typed messages and animates characters. Your job is to **change where those messages come from** (OpenClaw instead of Claude Code terminals).
- Study `CLAUDE.md` in the repo root first — it documents the full architecture and file responsibilities.
- Study `src/types.ts` to understand the `AgentState` and message interfaces the webview expects.

---

## Phase 1: Understand the Current Architecture

Before writing any code, read and understand these files in order:

1. `CLAUDE.md` — Full architecture overview
2. `src/types.ts` — Shared interfaces (AgentState, PersistedAgent, message types)
3. `src/constants.ts` — All backend magic numbers, paths, timing values
4. `src/fileWatcher.ts` — How it watches JSONL transcript files (fs.watch + polling, readNewLines)
5. `src/transcriptParser.ts` — How it parses JSONL lines into tool_use/tool_result events
6. `src/agentManager.ts` — Terminal lifecycle: launch, remove, restore, persist
7. `src/PixelAgentsViewProvider.ts` — WebviewViewProvider, message dispatch to webview
8. `src/extension.ts` — Entry point: activate(), deactivate()
9. `webview-ui/src/hooks/useExtensionMessages.ts` — How the webview receives and handles messages

After reading each file, summarize what it does and what needs to change for OpenClaw support. Present this summary before making any changes.

---

## Phase 2: Understand OpenClaw's Data Format

OpenClaw stores session transcripts at:
```
~/.openclaw/agents/<agentId>/sessions/<session-id>.jsonl
```

There is also an index file at:
```
~/.openclaw/agents/<agentId>/sessions/sessions.json
```

And a telemetry log at:
```
~/.openclaw/logs/telemetry.jsonl
```

### OpenClaw JSONL Schema

Each line in a session .jsonl file is a JSON object with this structure:

```jsonc
// Session metadata (first line)
{
  "type": "session",
  "timestamp": "2026-03-03T10:00:00.000Z",
  // ... session config
}

// Message records
{
  "type": "message",
  "timestamp": "2026-03-03T10:00:05.123Z",
  "message": {
    "role": "user" | "assistant" | "toolResult",
    "content": [
      // Text content
      { "type": "text", "text": "I'll help you with that..." },
      
      // Tool call (agent performing an action)
      { "type": "toolCall", "name": "exec", "input": { "command": "ls -la" } },
      { "type": "toolCall", "name": "write", "input": { "file_path": "src/app.ts", "content": "..." } },
      { "type": "toolCall", "name": "read", "input": { "path": "package.json" } },
      
      // Thinking blocks (can be ignored for visualization)
      { "type": "thinking", "text": "..." }
    ],
    "usage": {
      "cost": { "total": 0.0034 }
    }
  }
}
```

### Claude Code JSONL Schema (current, for comparison)

```jsonc
// Tool use
{ "type": "tool_use", "name": "Write", "input": { "file_path": "...", "content": "..." } }

// Tool result
{ "type": "tool_result", "tool_use_id": "abc123", "content": "File written successfully" }
```

### Key Differences
| Aspect | Claude Code | OpenClaw |
|--------|-------------|----------|
| Path | `~/.claude/projects/<hash>/<session>.jsonl` | `~/.openclaw/agents/<agentId>/sessions/<session>.jsonl` |
| Tool events | Top-level `type: "tool_use"` | Nested in `message.content[].type === "toolCall"` |
| Tool results | Top-level `type: "tool_result"` | `message.role === "toolResult"` |
| Agent discovery | VS Code terminal creation events | Filesystem scan of `~/.openclaw/agents/` |
| Session index | None (one file per project) | `sessions.json` maps keys to session IDs |

### OpenClaw Tool Names to Animation States

Map these OpenClaw tool names to pixel character animations:

| Tool Name(s) | Animation State | Character Behavior |
|--------------|----------------|-------------------|
| `write`, `edit`, `patch`, `multiEdit` | **typing** | Character sits at desk, typing animation |
| `read`, `glob`, `grep`, `ls`, `search` | **reading** | Character sits at desk, reading animation |
| `exec`, `bash`, `shell` | **typing** | Character at desk, typing + show command in bubble |
| `browser`, `fetch`, `webSearch` | **reading** | Character reading with browse indicator |
| `todoRead`, `todoWrite` | **typing** | Character at desk |
| Any unknown tool | **typing** | Default to typing animation |
| No tool activity for 30s+ | **idle** | Character wanders, then returns to desk |
| `message.role === "user"` (incoming) | **attention** | Speech bubble: "!" or "Waiting for input" |

---

## Phase 3: Modify the Backend (src/)

### Step 3.1: Update Constants

File: `src/constants.ts`

Add OpenClaw-specific constants alongside the existing Claude Code ones (don't delete the originals yet — we may want a mode toggle later):

```typescript
// OpenClaw paths
export const OPENCLAW_DIR = path.join(os.homedir(), '.openclaw');
export const OPENCLAW_AGENTS_DIR = path.join(OPENCLAW_DIR, 'agents');
export const OPENCLAW_TELEMETRY_LOG = path.join(OPENCLAW_DIR, 'logs', 'telemetry.jsonl');

// Agent activity timeout (ms) — agent considered idle after this
export const AGENT_IDLE_TIMEOUT = 30_000;

// Agent discovery poll interval (ms)
export const AGENT_DISCOVERY_INTERVAL = 15_000;

// Session file considered "active" if modified within this window (ms)
export const SESSION_ACTIVE_WINDOW = 5 * 60 * 1000;
```

### Step 3.2: Create OpenClaw Transcript Parser

Create a new file: `src/openclawParser.ts`

This file should export a function that takes a raw JSONL line string and returns a parsed event object that the existing webview message system can understand. 

Requirements:
- Parse the `{ type: "message", message: { role, content[] } }` structure
- Extract `toolCall` items from `message.content[]` and map tool names to animation states (typing, reading)
- Extract `text` items for speech bubbles (truncate to ~80 characters)
- Handle `toolResult` role for tool completion events
- Skip `type: "session"` metadata lines
- Skip `thinking` content blocks
- Return null for unparseable lines (never throw)
- Include the timestamp from the record

The returned event should match whatever interface `transcriptParser.ts` currently returns so the rest of the pipeline doesn't need changes. Study `transcriptParser.ts` to see what shape the webview expects.

### Step 3.3: Create OpenClaw Agent Discovery

Create a new file: `src/openclawAgentDiscovery.ts`

This module replaces the VS Code terminal-based agent lifecycle with filesystem-based discovery.

Requirements:
- Export a `discoverAgents()` function that scans `~/.openclaw/agents/` and returns an array of discovered agents with: `id`, `sessionsDir`, `latestSessionFile`, `isActive` (based on file modification time)
- Export a `watchForNewAgents(callback)` function that polls every `AGENT_DISCOVERY_INTERVAL` and fires the callback when new agent directories appear
- For each agent, determine the latest session by sorting `.jsonl` files in the sessions directory
- Read the `sessions.json` index file if present to get session metadata
- An agent is "active" if its latest session file was modified within `SESSION_ACTIVE_WINDOW`

### Step 3.4: Modify fileWatcher.ts

Adapt the existing file watcher to work with OpenClaw session files.

Key changes:
- Instead of watching a single session file tied to a VS Code terminal, watch the sessions directory for each discovered OpenClaw agent
- When a new `.jsonl` file appears in an agent's sessions directory, start tailing it
- The core `readNewLines()` logic (reading from last known offset) should stay the same — it's format-agnostic
- Use `openclawParser.ts` instead of `transcriptParser.ts` to parse each new line
- Support watching multiple agents simultaneously (one watcher per agent)

### Step 3.5: Modify agentManager.ts

Replace the VS Code terminal lifecycle with OpenClaw agent lifecycle.

Key changes:
- Remove all VS Code terminal creation/management code
- On startup, call `discoverAgents()` and create a pixel character for each agent
- Map each agent to a character index (cycle through the 6 available characters)
- Use `watchForNewAgents()` to detect new agents and spawn characters for them
- Track agent activity state: when an agent goes idle (no JSONL writes for `AGENT_IDLE_TIMEOUT`), update its character state to idle
- Persist agent-to-character mapping so characters keep their assigned seats across restarts

### Step 3.6: Update PixelAgentsViewProvider.ts

Minimal changes needed:
- Replace terminal-based agent spawning with the new OpenClaw discovery system
- The `postMessage()` calls to the webview should stay the same — just ensure the message shapes match what the webview expects
- On webview ready (`restoreAgents`), load from OpenClaw discovery instead of workspace state

### Step 3.7: Update extension.ts

- On `activate()`, scan for OpenClaw agents and start monitoring
- Remove Claude Code terminal event listeners
- Add the agent discovery polling loop
- Register a command to manually refresh/rescan agents

---

## Phase 4: Create Standalone Mode

After Phase 3 works as a VS Code extension, extract it into a standalone web app.

### Step 4.1: Create Server Directory

Create `server/` at the project root with:
- `server/index.ts` — Express + WebSocket server
- `server/bridge.ts` — Bridges OpenClaw file watchers to WebSocket clients

### Step 4.2: Build the Server

The server should:
1. Serve the built `webview-ui/dist/` as static files
2. Run a WebSocket server on the same port (default: 3847)
3. On WebSocket connection:
   - Run `discoverAgents()` and send the full agent list
   - Start file watchers for all active agents
   - Forward parsed JSONL events to all connected WebSocket clients
4. Continue polling for new agents
5. Support multiple simultaneous browser clients

### Step 4.3: Adapt webview-ui for Standalone Mode

Create a thin adapter in `webview-ui/src/hooks/` that detects whether it's running inside VS Code or standalone:

```typescript
// If acquireVsCodeApi is available → VS Code mode (use postMessage)
// If not → standalone mode (use WebSocket to localhost:3847)
```

This way the same webview code works in both contexts. The adapter should implement the same message interface so the rest of the React code doesn't need changes.

### Step 4.4: Add Scripts

Add to `package.json`:
```json
{
  "scripts": {
    "server": "npx ts-node server/index.ts",
    "build:standalone": "cd webview-ui && npm run build",
    "start": "npm run build:standalone && npm run server"
  }
}
```

---

## Phase 5: Polish and Test

### Step 5.1: Test with Real OpenClaw Agents

1. Start an OpenClaw agent: `openclaw agent -m "hello from test"`
2. Run the standalone server: `npm run start`
3. Open `http://localhost:3847`
4. Verify:
   - Agent appears as a pixel character
   - Character animates when agent uses tools
   - Speech bubbles appear for text responses
   - Character goes idle when agent finishes
   - New agents are auto-discovered

### Step 5.2: Add Agent Labels

Modify the webview to show the OpenClaw agent ID as a label above or below each character. This helps identify which pixel character maps to which agent when monitoring multiple agents.

### Step 5.3: Add Cost Tracking (Optional Enhancement)

Since OpenClaw JSONL includes `message.usage.cost.total`, display a running cost counter per agent in the UI. Show it as a small badge near the character or in a sidebar panel.

### Step 5.4: Mobile PWA (Optional Enhancement)

Add a `manifest.json` and service worker to `webview-ui/public/` so the standalone web app can be installed as a PWA on mobile. This gives a native-feeling app icon and full-screen experience when monitoring from a phone.

---

## File Change Summary

| File | Action | Description |
|------|--------|-------------|
| `src/constants.ts` | MODIFY | Add OpenClaw paths and timing constants |
| `src/openclawParser.ts` | CREATE | Parse OpenClaw JSONL into animation events |
| `src/openclawAgentDiscovery.ts` | CREATE | Filesystem-based agent discovery |
| `src/fileWatcher.ts` | MODIFY | Watch OpenClaw session directories instead of Claude paths |
| `src/agentManager.ts` | MODIFY | Replace terminal lifecycle with OpenClaw discovery |
| `src/PixelAgentsViewProvider.ts` | MODIFY | Wire up OpenClaw discovery on webview ready |
| `src/extension.ts` | MODIFY | Activate with OpenClaw scanning instead of terminal events |
| `server/index.ts` | CREATE | Express + WebSocket standalone server |
| `server/bridge.ts` | CREATE | Bridges file watchers to WebSocket clients |
| `webview-ui/src/hooks/useStandaloneSocket.ts` | CREATE | WebSocket adapter for standalone mode |
| `webview-ui/src/hooks/useExtensionMessages.ts` | MODIFY | Add standalone mode detection |
| `package.json` | MODIFY | Add standalone scripts |
| `webview-ui/src/office/` | NO CHANGE | Do not touch the game engine or rendering |
| `webview-ui/src/constants.ts` | NO CHANGE | Frontend constants stay the same |

---

## Execution Order

Do this in order. Commit after each phase works.

1. **Read and summarize** all files listed in Phase 1. Present the summary.
2. **Phase 3.1–3.2**: Constants + Parser. Write tests for the parser.
3. **Phase 3.3**: Agent discovery. Test it finds agents on disk.
4. **Phase 3.4–3.6**: Wire everything together in the VS Code extension. Test it.
5. **Phase 4**: Extract to standalone. Test in browser.
6. **Phase 5**: Polish, test with real agents, add labels.

---

## Constraints

- TypeScript strict mode is enabled. No `any` types without justification.
- `erasableSyntaxOnly: true` — do not use TypeScript enums. Use `as const` objects.
- All magic numbers go in `src/constants.ts` (backend) or `webview-ui/src/constants.ts` (frontend).
- Do not add new npm dependencies without asking first.
- Follow the existing code style: no unused locals/parameters, consistent naming.
- The pixel art aesthetic must be maintained in any new UI elements (sharp corners, solid backgrounds, hard shadows, FS Pixel Sans font).
