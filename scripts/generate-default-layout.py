#!/usr/bin/env python3
"""
Generate a furnished default office layout for PixelClaw.

Output: webview-ui/public/assets/default-layout.json

Creates a ~15x12 office with:
- Walls around perimeter (row 0)
- Floor tiles with colors
- 4 desk+chair workstations
- Bookshelves, monitors, plants, wall items
"""

import os
import json
import time
import random

# Tile types (from webview-ui/src/office/types.ts)
WALL = 0
FLOOR_1 = 1
FLOOR_2 = 2
FLOOR_3 = 3
FLOOR_4 = 4
FLOOR_5 = 5
FLOOR_6 = 6
FLOOR_7 = 7
VOID = 8

# Layout dimensions
COLS = 15
ROWS = 12


def uid():
    """Generate a unique furniture ID matching PixelClaw format."""
    ts = int(time.time() * 1000)
    suffix = ''.join(random.choices('abcdefghijklmnopqrstuvwxyz0123456789', k=4))
    return f"f-{ts}-{suffix}"


def make_tiles():
    """Create the tile grid: walls on top row, floor elsewhere, void outside."""
    tiles = []
    for r in range(ROWS):
        for c in range(COLS):
            if r == 0:
                # Top row: walls
                tiles.append(WALL)
            elif c == 0 or c == COLS - 1 or r == ROWS - 1:
                # Side and bottom borders: floor (could be walls too)
                tiles.append(FLOOR_1)
            else:
                # Interior: alternating floor patterns for visual interest
                tiles.append(FLOOR_1)
    return tiles


def make_tile_colors():
    """Create per-tile floor colors. Walls get null, floors get a warm office color."""
    colors = []
    # Warm office floor color (tan/beige)
    floor_color = {"h": 30, "s": 25, "b": 10, "c": 5, "colorize": True}

    for r in range(ROWS):
        for c in range(COLS):
            if r == 0:
                # Wall row: wall color
                colors.append({"h": 25, "s": 15, "b": -10, "c": 0, "colorize": True})
            else:
                colors.append(floor_color)
    return colors


def make_furniture():
    """Place furniture items to create a functional office."""
    items = []

    # ── 4 Desk + Chair workstations ──
    # Two rows of 2 desks each, facing down (chair behind = BACK orientation)
    # Row 1: desks at rows 3-4
    # Row 2: desks at rows 7-8

    # Workstation 1: top-left area
    items.append({"uid": uid(), "type": "DESK_WOOD", "col": 2, "row": 4})
    items.append({"uid": uid(), "type": "CHAIR_OFFICE_BACK", "col": 2, "row": 3})
    items.append({"uid": uid(), "type": "MONITOR_DARK", "col": 2, "row": 3})

    # Workstation 2: top-right area
    items.append({"uid": uid(), "type": "DESK_WOOD", "col": 6, "row": 4})
    items.append({"uid": uid(), "type": "CHAIR_OFFICE_BACK", "col": 6, "row": 3})
    items.append({"uid": uid(), "type": "MONITOR_BLUE", "col": 7, "row": 3})

    # Workstation 3: bottom-left area
    items.append({"uid": uid(), "type": "DESK_LIGHT", "col": 2, "row": 8})
    items.append({"uid": uid(), "type": "CHAIR_OFFICE_BACK", "col": 3, "row": 7})

    # Workstation 4: bottom-right area
    items.append({"uid": uid(), "type": "DESK_GREY", "col": 6, "row": 8})
    items.append({"uid": uid(), "type": "CHAIR_OFFICE_BACK", "col": 7, "row": 7})

    # ── Bookshelves along right wall ──
    items.append({"uid": uid(), "type": "BOOKSHELF_FULL", "col": 11, "row": 1})
    items.append({"uid": uid(), "type": "BOOKSHELF_WOOD", "col": 11, "row": 3})

    # ── Water cooler in corner ──
    items.append({"uid": uid(), "type": "WATER_COOLER", "col": 13, "row": 10})

    # ── Plants for decoration ──
    items.append({"uid": uid(), "type": "PLANT_SMALL", "col": 10, "row": 10})
    items.append({"uid": uid(), "type": "PLANT_TALL_1", "col": 1, "row": 9})

    # ── Wall items ──
    items.append({"uid": uid(), "type": "CLOCK_BLUE", "col": 5, "row": 0})
    items.append({"uid": uid(), "type": "PAINTING_LANDSCAPE", "col": 8, "row": -1})
    items.append({"uid": uid(), "type": "WHITEBOARD", "col": 2, "row": -1})

    # ── Filing cabinet ──
    items.append({"uid": uid(), "type": "FILING_CABINET", "col": 13, "row": 5})

    # ── Fridge in break area ──
    items.append({"uid": uid(), "type": "FRIDGE", "col": 11, "row": 9})

    return items


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    out_path = os.path.join(
        project_root, 'webview-ui', 'public', 'assets', 'default-layout.json'
    )

    layout = {
        "version": 1,
        "cols": COLS,
        "rows": ROWS,
        "tiles": make_tiles(),
        "tileColors": make_tile_colors(),
        "furniture": make_furniture(),
    }

    # Validate
    expected_tiles = COLS * ROWS
    assert len(layout["tiles"]) == expected_tiles, \
        f"Tile count mismatch: {len(layout['tiles'])} != {expected_tiles}"
    assert len(layout["tileColors"]) == expected_tiles, \
        f"Color count mismatch: {len(layout['tileColors'])} != {expected_tiles}"

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(layout, f, indent=2)

    print(f"Layout: {COLS}x{ROWS} grid")
    print(f"  Tiles: {expected_tiles}")
    print(f"  Furniture: {len(layout['furniture'])} items")
    print(f"Saved to {out_path}")


if __name__ == '__main__':
    main()
