/**
 * Agent AI Behavior System for PixelClaw Web4
 * 
 * Simulates realistic agent behaviors:
 * - Autonomous movement between floors
 * - Task scheduling and execution
 * - Meeting participation
 * - Break schedules
 * - Social interactions
 */

import { agentDB, type AgentState } from './agentDatabase.js';
import { floorManager } from './floorManager.js';

interface Task {
  id: string;
  type: 'work' | 'meeting' | 'break' | 'social' | 'travel';
  floorId: string;
  seatId?: string;
  duration: number; // minutes
  priority: number;
  description: string;
}

interface Meeting {
  id: string;
  title: string;
  floorId: string;
  seatId: string;
  startTime: Date;
  endTime: Date;
  attendees: string[];
}

export class AgentBehaviorEngine {
  private tasks: Map<string, Task[]> = new Map();
  private meetings: Map<string, Meeting> = new Map();
  private isRunning = false;
  private intervalId?: NodeJS.Timeout;

  /**
   * Start the behavior engine
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log('[AgentAI] Behavior engine started');
    
    // Main behavior loop - every 10 seconds
    this.intervalId = setInterval(() => {
      this.updateAgents();
    }, 10000);

    // Schedule daily tasks
    this.scheduleDailyTasks();
  }

  /**
   * Stop the behavior engine
   */
  stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    
    console.log('[AgentAI] Behavior engine stopped');
  }

  /**
   * Schedule daily tasks for all agents
   */
  private scheduleDailyTasks(): void {
    const agents = agentDB.list();
    
    for (const agent of agents) {
      const dailyTasks: Task[] = [];
      
      // Morning work session
      dailyTasks.push({
        id: `${agent.profile.id}-morning-work`,
        type: 'work',
        floorId: agent.profile.department === 'Engineering' ? 'engineering' : 'ceo',
        duration: 120,
        priority: 8,
        description: 'Morning work session'
      });

      // Lunch break
      dailyTasks.push({
        id: `${agent.profile.id}-lunch`,
        type: 'break',
        floorId: 'breakroom',
        duration: 45,
        priority: 9,
        description: 'Lunch break'
      });

      // Afternoon work session
      dailyTasks.push({
        id: `${agent.profile.id}-afternoon-work`,
        type: 'work',
        floorId: agent.profile.department === 'Engineering' ? 'engineering' : 'ceo',
        duration: 180,
        priority: 8,
        description: 'Afternoon work session'
      });

      // Random social interaction
      if (Math.random() > 0.5) {
        dailyTasks.push({
          id: `${agent.profile.id}-social`,
          type: 'social',
          floorId: 'breakroom',
          duration: 15,
          priority: 5,
          description: 'Coffee chat with colleagues'
        });
      }

      this.tasks.set(agent.profile.id, dailyTasks);
    }
  }

  /**
   * Update all agents' behaviors
   */
  private updateAgents(): void {
    const now = new Date();
    const agents = agentDB.list();

    for (const agent of agents) {
      // Skip if agent is in a meeting
      if (this.isAgentInMeeting(agent.profile.id)) {
        continue;
      }

      // Get current task
      const agentTasks = this.tasks.get(agent.profile.id) || [];
      const currentTask = agentTasks[0];

      if (!currentTask) {
        // No tasks - set to idle
        if (agent.state.status !== 'idle') {
          agentDB.setStatus(agent.profile.id, 'idle', 'Waiting for tasks');
        }
        continue;
      }

      // Execute current task
      this.executeTask(agent.profile.id, currentTask);
    }

    // Update meetings
    this.updateMeetings();
  }

  /**
   * Execute a task for an agent
   */
  private executeTask(agentId: string, task: Task): void {
    const agent = agentDB.get(agentId);
    if (!agent) return;

    // Check if agent is on the right floor
    if (agent.position.floorId !== task.floorId) {
      // Travel to floor
      agentDB.setStatus(agentId, 'travel', `Traveling to ${task.floorId}`);
      agentDB.setPosition(agentId, task.floorId, '', 0, 0);
      agentDB.logActivity(agentId, 'travel', `Traveled to ${task.floorId}`);
      return;
    }

    // Execute task based on type
    switch (task.type) {
      case 'work':
        agentDB.setStatus(agentId, 'working', task.description);
        break;
      case 'break':
        agentDB.setStatus(agentId, 'away', task.description);
        break;
      case 'social':
        agentDB.setStatus(agentId, 'meeting', task.description);
        break;
      case 'travel':
        agentDB.setStatus(agentId, 'travel', task.description);
        break;
    }

    // Simulate task completion (remove after duration)
    setTimeout(() => {
      const tasks = this.tasks.get(agentId) || [];
      const index = tasks.findIndex(t => t.id === task.id);
      if (index > -1) {
        tasks.splice(index, 1);
        agentDB.logActivity(agentId, 'task_complete', `Completed: ${task.description}`);
      }
    }, task.duration * 60 * 1000);
  }

  /**
   * Schedule a meeting
   */
  scheduleMeeting(title: string, floorId: string, seatId: string, 
                  duration: number, attendeeIds: string[]): Meeting {
    const meetingId = `meeting-${Date.now()}`;
    const now = new Date();
    const endTime = new Date(now.getTime() + duration * 60000);

    const meeting: Meeting = {
      id: meetingId,
      title,
      floorId,
      seatId,
      startTime: now,
      endTime,
      attendees: attendeeIds
    };

    this.meetings.set(meetingId, meeting);

    // Notify attendees
    for (const agentId of attendeeIds) {
      agentDB.setStatus(agentId, 'meeting', `In meeting: ${title}`);
      agentDB.logActivity(agentId, 'meeting_joined', `Joined meeting: ${title}`);
    }

    console.log(`[AgentAI] Meeting scheduled: ${title} with ${attendeeIds.length} attendees`);
    return meeting;
  }

  /**
   * Check if agent is in a meeting
   */
  private isAgentInMeeting(agentId: string): boolean {
    const now = new Date();
    for (const meeting of this.meetings.values()) {
      if (meeting.attendees.includes(agentId) && 
          now >= meeting.startTime && 
          now < meeting.endTime) {
        return true;
      }
    }
    return false;
  }

  /**
   * Update meetings (end expired ones)
   */
  private updateMeetings(): void {
    const now = new Date();
    for (const [meetingId, meeting] of this.meetings.entries()) {
      if (now >= meeting.endTime) {
        // End meeting
        for (const agentId of meeting.attendees) {
          agentDB.setStatus(agentId, 'idle', 'Meeting ended');
          agentDB.logActivity(agentId, 'meeting_left', `Left meeting: ${meeting.title}`);
        }
        this.meetings.delete(meetingId);
        console.log(`[AgentAI] Meeting ended: ${meeting.title}`);
      }
    }
  }

  /**
   * Get active meetings
   */
  getActiveMeetings(): Meeting[] {
    const now = new Date();
    return Array.from(this.meetings.values()).filter(m => 
      now >= m.startTime && now < m.endTime
    );
  }

  /**
   * Trigger a social event (all agents to break room)
   */
  triggerSocialEvent(eventName: string, duration: number = 30): void {
    const agents = agentDB.list();
    const agentIds = agents.map(a => a.profile.id);
    
    this.scheduleMeeting(
      eventName,
      'breakroom',
      'center',
      duration,
      agentIds
    );
    
    console.log(`[AgentAI] Social event triggered: ${eventName}`);
  }

  /**
   * Get agent schedule
   */
  getAgentSchedule(agentId: string): Task[] {
    return this.tasks.get(agentId) || [];
  }
}

// Singleton instance
export const agentAI = new AgentBehaviorEngine();

// Auto-start
agentAI.start();

// Graceful shutdown
process.on('SIGINT', () => {
  agentAI.stop();
});
