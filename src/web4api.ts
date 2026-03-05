/**
 * PixelClaw Web4 API
 * 
 * RESTful endpoints for:
 * - Agent management
 * - Floor switching
 * - Activity monitoring
 */

import type { Request, Response } from 'express';
import { agentDB } from './agentDatabase.js';
import { floorManager } from './floorManager.js';
import { meetingManager } from './meetingManager.js';
import { agentAI } from './agentBehavior.js';

export function setupWeb4API(app: any): void {
  
  // ===== AGENT ENDPOINTS =====
  
  // List all agents
  app.get('/api/agents', (req: Request, res: Response) => {
    const agents = agentDB.list().map(agent => ({
      id: agent.profile.id,
      name: agent.profile.name,
      role: agent.profile.role,
      status: agent.state.status,
      floorId: agent.position.floorId,
      seatId: agent.position.seatId,
      lastActive: agent.profile.lastActive
    }));
    res.json({ agents });
  });

  // Get specific agent
  app.get('/api/agents/:id', (req: Request, res: Response) => {
    const agent = agentDB.get(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json({ agent });
  });

  // Update agent position
  app.post('/api/agents/:id/position', (req: Request, res: Response) => {
    const { floorId, seatId, x, y } = req.body;
    agentDB.setPosition(req.params.id, floorId, seatId, x, y);
    res.json({ success: true });
  });

  // Update agent status
  app.post('/api/agents/:id/status', (req: Request, res: Response) => {
    const { status, task } = req.body;
    agentDB.setStatus(req.params.id, status, task);
    res.json({ success: true });
  });

  // Get agent activity log
  app.get('/api/agents/:id/activity', (req: Request, res: Response) => {
    const agent = agentDB.get(req.params.id);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json({ 
      activityLog: agent.state.activityLog.slice(-50) // Last 50 entries
    });
  });

  // ===== FLOOR ENDPOINTS =====
  
  // List all floors
  app.get('/api/floors', (req: Request, res: Response) => {
    const floors = floorManager.listFloors();
    const activeFloor = floorManager.getActiveFloor();
    res.json({ floors, activeFloorId: activeFloor.id });
  });

  // Get specific floor
  app.get('/api/floors/:id', (req: Request, res: Response) => {
    const floor = floorManager.getFloor(req.params.id);
    if (!floor) {
      return res.status(404).json({ error: 'Floor not found' });
    }
    
    // Get agents on this floor
    const agents = agentDB.getAgentsOnFloor(req.params.id).map(a => ({
      id: a.profile.id,
      name: a.profile.name,
      seatId: a.position.seatId,
      status: a.state.status
    }));
    
    res.json({ floor, agents });
  });

  // Switch active floor
  app.post('/api/floors/:id/switch', (req: Request, res: Response) => {
    const success = floorManager.switchFloor(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Floor not found' });
    }
    res.json({ success: true, activeFloorId: req.params.id });
  });

  // Create new floor
  app.post('/api/floors', (req: Request, res: Response) => {
    const { id, name, description, type, size, capacity } = req.body;
    
    if (floorManager.getFloor(id)) {
      return res.status(409).json({ error: 'Floor already exists' });
    }
    
    const floor = floorManager.createFloor(id, {
      name,
      description,
      type,
      size,
      capacity
    });
    
    res.status(201).json({ floor });
  });

  // ===== ACTIVITY ENDPOINTS =====
  
  // Get overall activity stats
  app.get('/api/activity', (req: Request, res: Response) => {
    const agents = agentDB.list();
    const stats = {
      totalAgents: agents.length,
      activeNow: agents.filter(a => a.state.status === 'working').length,
      inMeetings: agents.filter(a => a.state.status === 'meeting').length,
      idle: agents.filter(a => a.state.status === 'idle').length,
      away: agents.filter(a => a.state.status === 'away').length
    };
    res.json({ stats });
  });

  // ===== MEETING ROOM ENDPOINTS =====
  
  // List all meeting rooms
  app.get('/api/rooms', (req: Request, res: Response) => {
    const { floorId } = req.query;
    const rooms = floorId 
      ? meetingManager.getRoomsOnFloor(floorId as string)
      : meetingManager.getRooms();
    res.json({ rooms });
  });

  // Get room availability
  app.get('/api/rooms/:id/availability', (req: Request, res: Response) => {
    const { start, end } = req.query;
    const startTime = new Date(start as string);
    const endTime = new Date(end as string);
    const available = meetingManager.isRoomAvailable(req.params.id, startTime, endTime);
    res.json({ available });
  });

  // Book a room
  app.post('/api/rooms/:id/book', (req: Request, res: Response) => {
    const { title, organizer, attendees, startTime, endTime, recurring } = req.body;
    const booking = meetingManager.bookRoom(
      req.params.id,
      title,
      organizer,
      attendees,
      new Date(startTime),
      new Date(endTime),
      recurring
    );
    
    if (!booking) {
      return res.status(409).json({ error: 'Room not available' });
    }
    
    res.status(201).json({ booking });
  });

  // Get bookings for a room
  app.get('/api/rooms/:id/bookings', (req: Request, res: Response) => {
    const bookings = meetingManager.getBookingsForRoom(req.params.id);
    res.json({ bookings });
  });

  // Get upcoming bookings
  app.get('/api/bookings/upcoming', (req: Request, res: Response) => {
    const { limit } = req.query;
    const bookings = meetingManager.getUpcomingBookings(parseInt(limit as string) || 10);
    res.json({ bookings });
  });

  // Cancel booking
  app.post('/api/bookings/:id/cancel', (req: Request, res: Response) => {
    const success = meetingManager.cancelBooking(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Booking not found' });
    }
    res.json({ success: true });
  });

  // ===== AI BEHAVIOR ENDPOINTS =====
  
  // Trigger social event
  app.post('/api/events/social', (req: Request, res: Response) => {
    const { name, duration } = req.body;
    agentAI.triggerSocialEvent(name, duration);
    res.json({ success: true, message: `Social event triggered: ${name}` });
  });

  // Get agent schedule
  app.get('/api/agents/:id/schedule', (req: Request, res: Response) => {
    const schedule = agentAI.getAgentSchedule(req.params.id);
    res.json({ schedule });
  });

  // Get active meetings
  app.get('/api/meetings/active', (req: Request, res: Response) => {
    const meetings = agentAI.getActiveMeetings();
    res.json({ meetings });
  });

  // ===== WEBSOCKET EVENTS =====
  
  // These would be integrated with the existing WebSocket server
  // to broadcast real-time updates
}

export { agentDB, floorManager, meetingManager, agentAI };
