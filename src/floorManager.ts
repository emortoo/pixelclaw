/**
 * Floor Management System for PixelClaw Web4
 * 
 * Manages multiple floors with:
 * - Floor registry and metadata
 * - Floor switching
 * - Cross-floor agent visibility
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const PIXELCLAW_DIR = path.join(os.homedir(), '.pixelclaw');
const FLOORS_REGISTRY_FILE = path.join(PIXELCLAW_DIR, 'floors-registry.json');
const FLOOR_LAYOUT_PREFIX = 'layout-floor-';

export interface FloorMetadata {
  id: string;
  name: string;
  description?: string;
  type: 'office' | 'meeting' | 'break' | 'reception' | 'custom';
  size: {
    cols: number;
    rows: number;
  };
  capacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface FloorRegistry {
  version: number;
  activeFloorId: string;
  floors: Record<string, FloorMetadata>;
}

export class FloorManager {
  private registry: FloorRegistry;

  constructor() {
    this.registry = this.loadRegistry();
    this.ensureDefaultFloor();
  }

  /**
   * Load floor registry from disk
   */
  private loadRegistry(): FloorRegistry {
    try {
      if (fs.existsSync(FLOORS_REGISTRY_FILE)) {
        const data = JSON.parse(fs.readFileSync(FLOORS_REGISTRY_FILE, 'utf-8'));
        console.log(`[FloorManager] Loaded registry with ${Object.keys(data.floors || {}).length} floors`);
        return data;
      }
    } catch (err) {
      console.error('[FloorManager] Failed to load registry:', err);
    }

    return {
      version: 1,
      activeFloorId: 'ceo',
      floors: {}
    };
  }

  /**
   * Save registry to disk
   */
  private saveRegistry(): void {
    try {
      if (!fs.existsSync(PIXELCLAW_DIR)) {
        fs.mkdirSync(PIXELCLAW_DIR, { recursive: true });
      }
      
      const tmpPath = FLOORS_REGISTRY_FILE + '.tmp';
      fs.writeFileSync(tmpPath, JSON.stringify(this.registry, null, 2), 'utf-8');
      fs.renameSync(tmpPath, FLOORS_REGISTRY_FILE);
    } catch (err) {
      console.error('[FloorManager] Failed to save registry:', err);
    }
  }

  /**
   * Ensure default floors exist
   */
  private ensureDefaultFloor(): void {
    if (Object.keys(this.registry.floors).length === 0) {
      this.createFloor('ceo', {
        name: 'CEO Floor',
        description: 'Executive suite with private office and boardroom',
        type: 'office',
        size: { cols: 32, rows: 26 },
        capacity: 10
      });
    }
  }

  /**
   * Create a new floor
   */
  createFloor(id: string, metadata: Omit<FloorMetadata, 'id' | 'createdAt' | 'updatedAt'>): FloorMetadata {
    const now = new Date().toISOString();
    const floor: FloorMetadata = {
      id,
      ...metadata,
      createdAt: now,
      updatedAt: now
    };

    this.registry.floors[id] = floor;
    this.saveRegistry();

    // Create empty layout file
    const layoutPath = path.join(PIXELCLAW_DIR, `${FLOOR_LAYOUT_PREFIX}${id}.json`);
    if (!fs.existsSync(layoutPath)) {
      const emptyLayout = {
        version: 1,
        cols: metadata.size.cols,
        rows: metadata.size.rows,
        tiles: this.generateEmptyTiles(metadata.size.cols, metadata.size.rows),
        furniture: []
      };
      fs.writeFileSync(layoutPath, JSON.stringify(emptyLayout, null, 2), 'utf-8');
    }

    console.log(`[FloorManager] Created floor: ${id}`);
    return floor;
  }

  /**
   * Generate empty floor tiles
   */
  private generateEmptyTiles(cols: number, rows: number): number[] {
    const tiles: number[] = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Border is dark wood (2), interior is light wood (1)
        if (r === 0 || r === rows - 1 || c === 0 || c === cols - 1) {
          tiles.push(2);
        } else {
          tiles.push(1);
        }
      }
    }
    return tiles;
  }

  /**
   * Get floor metadata
   */
  getFloor(id: string): FloorMetadata | undefined {
    return this.registry.floors[id];
  }

  /**
   * List all floors
   */
  listFloors(): FloorMetadata[] {
    return Object.values(this.registry.floors);
  }

  /**
   * Get active floor
   */
  getActiveFloor(): FloorMetadata {
    return this.registry.floors[this.registry.activeFloorId] || this.registry.floors['ceo'];
  }

  /**
   * Switch to a different floor
   */
  switchFloor(id: string): boolean {
    if (!this.registry.floors[id]) {
      console.error(`[FloorManager] Floor not found: ${id}`);
      return false;
    }

    // Save current layout
    this.saveCurrentLayout();

    // Switch active floor
    this.registry.activeFloorId = id;
    this.registry.floors[id].updatedAt = new Date().toISOString();
    this.saveRegistry();

    // Copy floor layout to active layout.json
    const floorLayoutPath = path.join(PIXELCLAW_DIR, `${FLOOR_LAYOUT_PREFIX}${id}.json`);
    const activeLayoutPath = path.join(PIXELCLAW_DIR, 'layout.json');
    
    if (fs.existsSync(floorLayoutPath)) {
      fs.copyFileSync(floorLayoutPath, activeLayoutPath);
    }

    console.log(`[FloorManager] Switched to floor: ${id}`);
    return true;
  }

  /**
   * Save current layout to active floor
   */
  saveCurrentLayout(): void {
    const activeId = this.registry.activeFloorId;
    const activeLayoutPath = path.join(PIXELCLAW_DIR, 'layout.json');
    const floorLayoutPath = path.join(PIXELCLAW_DIR, `${FLOOR_LAYOUT_PREFIX}${activeId}.json`);
    
    if (fs.existsSync(activeLayoutPath)) {
      fs.copyFileSync(activeLayoutPath, floorLayoutPath);
      this.registry.floors[activeId].updatedAt = new Date().toISOString();
      this.saveRegistry();
    }
  }

  /**
   * Delete a floor
   */
  deleteFloor(id: string): boolean {
    if (id === 'ceo') {
      console.error('[FloorManager] Cannot delete default CEO floor');
      return false;
    }

    delete this.registry.floors[id];
    this.saveRegistry();

    // Delete layout file
    const layoutPath = path.join(PIXELCLAW_DIR, `${FLOOR_LAYOUT_PREFIX}${id}.json`);
    if (fs.existsSync(layoutPath)) {
      fs.unlinkSync(layoutPath);
    }

    console.log(`[FloorManager] Deleted floor: ${id}`);
    return true;
  }

  /**
   * Get layout file path for a floor
   */
  getLayoutPath(floorId: string): string {
    return path.join(PIXELCLAW_DIR, `${FLOOR_LAYOUT_PREFIX}${floorId}.json`);
  }
}

// Singleton instance
export const floorManager = new FloorManager();

// Auto-save current layout periodically
setInterval(() => {
  floorManager.saveCurrentLayout();
}, 60000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[FloorManager] Saving current layout...');
  floorManager.saveCurrentLayout();
});
