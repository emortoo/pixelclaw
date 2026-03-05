/**
 * Enhanced Agent Persistence for PixelClaw Web4
 * 
 * Extends agent storage to include:
 * - Persistent agent identity across sessions
 * - Agent state history and activity logs
 * - Agent profiles with names, roles, and attributes
 * - Cross-floor agent positioning
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PIXELCLAW_DIR = path.join(os.homedir(), '.pixelclaw');
const AGENTS_DB_FILE = path.join(PIXELCLAW_DIR, 'agents-database.json');
const AGENT_ACTIVITY_LOG = path.join(PIXELCLAW_DIR, 'agents-activity.jsonl');

export interface AgentProfile {
  id: string;
  name: string;
  role: 'ceo' | 'executive' | 'manager' | 'developer' | 'assistant' | 'guest';
  department?: string;
  avatar: {
    palette: number;
    hueShift: number;
    customSprite?: string;
  };
  createdAt: string;
  lastActive: string;
}

export interface AgentPosition {
  floorId: string;
  seatId: string;
  x: number;
  y: number;
}

export interface AgentState {
  status: 'idle' | 'working' | 'meeting' | 'away' | 'offline';
  currentTask?: string;
  activityLog: ActivityEntry[];
}

export interface ActivityEntry {
  timestamp: string;
  action: string;
  details?: string;
  duration?: number;
}

export interface PersistentAgent {
  profile: AgentProfile;
  position: AgentPosition;
  state: AgentState;
}

export class AgentDatabase {
  private agents: Map<string, PersistentAgent> = new Map();
  private dirty = false;

  constructor() {
    this.load();
  }

  /**
   * Load agents from disk
   */
  private load(): void {
    try {
      if (fs.existsSync(AGENTS_DB_FILE)) {
        const data = JSON.parse(fs.readFileSync(AGENTS_DB_FILE, 'utf-8'));
        for (const [id, agent] of Object.entries(data.agents || {})) {
          this.agents.set(id, agent as PersistentAgent);
        }
        console.log(`[AgentDB] Loaded ${this.agents.size} persistent agents`);
      }
    } catch (err) {
      console.error('[AgentDB] Failed to load:', err);
    }
  }

  /**
   * Save agents to disk
   */
  save(): void {
    if (!this.dirty) return;
    
    try {
      if (!fs.existsSync(PIXELCLAW_DIR)) {
        fs.mkdirSync(PIXELCLAW_DIR, { recursive: true });
      }
      
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        agents: Object.fromEntries(this.agents)
      };
      
      const tmpPath = AGENTS_DB_FILE + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8');
      fs.renameSync(tmpPath, AGENTS_DB_FILE);
      
      this.dirty = false;
      console.log('[AgentDB] Saved agents database');
    } catch (err) {
      console.error('[AgentDB] Failed to save:', err);
    }
  }

  /**
   * Get or create an agent
   */
  getOrCreate(id: string, defaults?: Partial<AgentProfile>): PersistentAgent {
    if (this.agents.has(id)) {
      return this.agents.get(id)!;
    }

    const now = new Date().toISOString();
    const agent: PersistentAgent = {
      profile: {
        id,
        name: defaults?.name || `Agent ${id}`,
        role: defaults?.role || 'assistant',
        department: defaults?.department,
        avatar: {
          palette: defaults?.avatar?.palette ?? Math.floor(Math.random() * 6),
          hueShift: defaults?.avatar?.hueShift ?? 0
        },
        createdAt: now,
        lastActive: now
      },
      position: {
        floorId: 'default',
        seatId: '',
        x: 0,
        y: 0
      },
      state: {
        status: 'idle',
        activityLog: []
      }
    };

    this.agents.set(id, agent);
    this.dirty = true;
    this.logActivity(id, 'created', 'Agent profile created');
    
    return agent;
  }

  /**
   * Update agent position
   */
  setPosition(id: string, floorId: string, seatId: string, x: number, y: number): void {
    const agent = this.agents.get(id);
    if (!agent) return;

    agent.position = { floorId, seatId, x, y };
    agent.profile.lastActive = new Date().toISOString();
    this.dirty = true;
  }

  /**
   * Update agent status
   */
  setStatus(id: string, status: AgentState['status'], task?: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;

    const oldStatus = agent.state.status;
    agent.state.status = status;
    agent.state.currentTask = task;
    agent.profile.lastActive = new Date().toISOString();
    this.dirty = true;

    if (oldStatus !== status) {
      this.logActivity(id, 'status_change', `Status: ${oldStatus} → ${status}`);
    }
  }

  /**
   * Log agent activity
   */
  logActivity(id: string, action: string, details?: string, duration?: number): void {
    const agent = this.agents.get(id);
    if (!agent) return;

    const entry: ActivityEntry = {
      timestamp: new Date().toISOString(),
      action,
      details,
      duration
    };

    agent.state.activityLog.push(entry);
    
    // Keep only last 100 entries
    if (agent.state.activityLog.length > 100) {
      agent.state.activityLog = agent.state.activityLog.slice(-100);
    }

    // Append to activity log file
    try {
      const logLine = JSON.stringify({ agentId: id, ...entry }) + '\n';
      fs.appendFileSync(AGENT_ACTIVITY_LOG, logLine, 'utf-8');
    } catch (err) {
      // Silent fail for logging
    }

    this.dirty = true;
  }

  /**
   * Get all agents on a specific floor
   */
  getAgentsOnFloor(floorId: string): PersistentAgent[] {
    return Array.from(this.agents.values())
      .filter(a => a.position.floorId === floorId);
  }

  /**
   * Get agent by ID
   */
  get(id: string): PersistentAgent | undefined {
    return this.agents.get(id);
  }

  /**
   * List all agents
   */
  list(): PersistentAgent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Auto-save periodically
   */
  startAutoSave(intervalMs = 30000): void {
    setInterval(() => this.save(), intervalMs);
  }
}

// Singleton instance
export const agentDB = new AgentDatabase();
agentDB.startAutoSave();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[AgentDB] Saving before exit...');
  agentDB.save();
  process.exit(0);
});

process.on('SIGTERM', () => {
  agentDB.save();
});
