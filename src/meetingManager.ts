/**
 * Meeting Room Booking System for PixelClaw Web4
 * 
 * Features:
 * - Book meeting rooms
 * - Check availability
 * - Recurring meetings
 * - Room capacity management
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { agentDB } from './agentDatabase.js';
import { agentAI } from './agentBehavior.js';

const PIXELCLAW_DIR = path.join(os.homedir(), '.pixelclaw');
const BOOKINGS_FILE = path.join(PIXELCLAW_DIR, 'meeting-bookings.json');

export interface Room {
  id: string;
  floorId: string;
  name: string;
  capacity: number;
  features: string[]; // 'whiteboard', 'projector', 'video_conf', etc.
  seatId: string; // Furniture UID for the meeting table
}

export interface Booking {
  id: string;
  roomId: string;
  title: string;
  organizer: string;
  attendees: string[];
  startTime: string;
  endTime: string;
  recurring?: 'daily' | 'weekly' | 'monthly';
  status: 'confirmed' | 'cancelled' | 'completed';
}

export class MeetingRoomManager {
  private rooms: Map<string, Room> = new Map();
  private bookings: Map<string, Booking> = new Map();

  constructor() {
    this.initializeRooms();
    this.loadBookings();
  }

  /**
   * Initialize default meeting rooms
   */
  private initializeRooms(): void {
    const defaultRooms: Room[] = [
      {
        id: 'boardroom-ceo',
        floorId: 'ceo',
        name: 'Executive Boardroom',
        capacity: 12,
        features: ['whiteboard', 'projector', 'video_conf'],
        seatId: 'board-table'
      },
      {
        id: 'meeting-eng-1',
        floorId: 'engineering',
        name: 'Engineering Meeting Room 1',
        capacity: 8,
        features: ['whiteboard', 'video_conf'],
        seatId: 'eng-meet-table'
      },
      {
        id: 'meeting-eng-2',
        floorId: 'engineering',
        name: 'Engineering Meeting Room 2',
        capacity: 6,
        features: ['whiteboard'],
        seatId: 'eng-meet-table-2'
      },
      {
        id: 'lounge-break',
        floorId: 'breakroom',
        name: 'Casual Lounge',
        capacity: 10,
        features: ['coffee', 'sofas'],
        seatId: 'lng-table'
      }
    ];

    for (const room of defaultRooms) {
      this.rooms.set(room.id, room);
    }
  }

  /**
   * Load bookings from disk
   */
  private loadBookings(): void {
    try {
      if (fs.existsSync(BOOKINGS_FILE)) {
        const data = JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf-8'));
        for (const booking of data.bookings || []) {
          this.bookings.set(booking.id, booking);
        }
        console.log(`[MeetingManager] Loaded ${this.bookings.size} bookings`);
      }
    } catch (err) {
      console.error('[MeetingManager] Failed to load bookings:', err);
    }
  }

  /**
   * Save bookings to disk
   */
  private saveBookings(): void {
    try {
      const data = {
        version: 1,
        updatedAt: new Date().toISOString(),
        bookings: Array.from(this.bookings.values())
      };
      fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[MeetingManager] Failed to save bookings:', err);
    }
  }

  /**
   * Get all rooms
   */
  getRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Get rooms on a specific floor
   */
  getRoomsOnFloor(floorId: string): Room[] {
    return Array.from(this.rooms.values()).filter(r => r.floorId === floorId);
  }

  /**
   * Get room by ID
   */
  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /**
   * Check room availability
   */
  isRoomAvailable(roomId: string, startTime: Date, endTime: Date): boolean {
    for (const booking of this.bookings.values()) {
      if (booking.roomId !== roomId || booking.status === 'cancelled') {
        continue;
      }

      const bookingStart = new Date(booking.startTime);
      const bookingEnd = new Date(booking.endTime);

      // Check for overlap
      if ((startTime >= bookingStart && startTime < bookingEnd) ||
          (endTime > bookingStart && endTime <= bookingEnd) ||
          (startTime <= bookingStart && endTime >= bookingEnd)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Book a room
   */
  bookRoom(roomId: string, title: string, organizer: string,
           attendees: string[], startTime: Date, 
           endTime: Date, recurring?: 'daily' | 'weekly' | 'monthly'): Booking | null {
    
    // Check if room exists
    const room = this.rooms.get(roomId);
    if (!room) {
      console.error(`[MeetingManager] Room not found: ${roomId}`);
      return null;
    }

    // Check capacity
    if (attendees.length > room.capacity) {
      console.error(`[MeetingManager] Room capacity exceeded: ${attendees.length}/${room.capacity}`);
      return null;
    }

    // Check availability
    if (!this.isRoomAvailable(roomId, startTime, endTime)) {
      console.error(`[MeetingManager] Room not available at requested time`);
      return null;
    }

    // Create booking
    const booking: Booking = {
      id: `booking-${Date.now()}`,
      roomId,
      title,
      organizer,
      attendees,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      recurring,
      status: 'confirmed'
    };

    this.bookings.set(booking.id, booking);
    this.saveBookings();

    // Schedule in AI behavior engine
    agentAI.scheduleMeeting(title, room.floorId, room.seatId,
      Math.round((endTime.getTime() - startTime.getTime()) / 60000),
      attendees);

    console.log(`[MeetingManager] Room booked: ${title} in ${room.name}`);
    return booking;
  }

  /**
   * Cancel a booking
   */
  cancelBooking(bookingId: string): boolean {
    const booking = this.bookings.get(bookingId);
    if (!booking) return false;

    booking.status = 'cancelled';
    this.saveBookings();

    // Notify attendees
    for (const agentId of booking.attendees) {
      agentDB.logActivity(agentId, 'meeting_cancelled', 
        `Meeting cancelled: ${booking.title}`);
    }

    console.log(`[MeetingManager] Booking cancelled: ${booking.title}`);
    return true;
  }

  /**
   * Get bookings for a room
   */
  getBookingsForRoom(roomId: string): Booking[] {
    return Array.from(this.bookings.values())
      .filter(b => b.roomId === roomId && b.status !== 'cancelled');
  }

  /**
   * Get bookings for an agent
   */
  getBookingsForAgent(agentId: string): Booking[] {
    return Array.from(this.bookings.values())
      .filter(b => b.attendees.includes(agentId) && b.status !== 'cancelled');
  }

  /**
   * Get upcoming bookings
   */
  getUpcomingBookings(limit: number = 10): Booking[] {
    const now = new Date();
    return Array.from(this.bookings.values())
      .filter(b => new Date(b.startTime) > now && b.status === 'confirmed')
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
      .slice(0, limit);
  }

  /**
   * Find available rooms
   */
  findAvailableRooms(startTime: Date, endTime: Date, 
                     capacity?: number, floorId?: string): Room[] {
    let rooms = Array.from(this.rooms.values());

    if (floorId) {
      rooms = rooms.filter(r => r.floorId === floorId);
    }

    if (capacity) {
      rooms = rooms.filter(r => r.capacity >= capacity);
    }

    return rooms.filter(r => this.isRoomAvailable(r.id, startTime, endTime));
  }
}

// Singleton instance
export const meetingManager = new MeetingRoomManager();

// Auto-save on shutdown
process.on('SIGINT', () => {
  console.log('\n[MeetingManager] Saving bookings...');
  meetingManager.saveBookings();
});
