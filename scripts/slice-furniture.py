#!/usr/bin/env python3
"""
Slice the 16x16 office tileset into individual furniture PNGs for PixelClaw.

Source: Asset/Office Tileset/Office Tileset All 16x16.png (256x512, 16px grid)
Output: webview-ui/public/assets/furniture/*.png + furniture-catalog.json

Usage:
  python3 scripts/slice-furniture.py                  # Slice and export
  python3 scripts/slice-furniture.py --preview        # Show grid occupancy
  python3 scripts/slice-furniture.py --preview-range 0 20  # Show rows 0-19
"""

import sys
import os
import json
from PIL import Image

TILE = 16  # 16px grid

# ── Furniture items to extract ─────────────────────────────────────────
# (id, label, category, col, row, w_tiles, h_tiles, extra_props)
# col/row = top-left tile in the 16px grid
# w_tiles/h_tiles = sprite size in 16px tiles

OFFICE_ITEMS = [
    # ── Desks (isDesk: true) ──
    ("DESK_WOOD", "Wooden Desk", "desks",
     1, 0, 2, 1, {"isDesk": True}),
    ("DESK_LIGHT", "Light Desk", "desks",
     4, 0, 2, 1, {"isDesk": True}),
    ("DESK_GREY", "Grey Desk", "desks",
     0, 2, 2, 1, {"isDesk": True}),

    # ── Chairs (rotation group CHAIR_OFFICE) ──
    ("CHAIR_OFFICE_FRONT", "Office Chair", "chairs",
     4, 16, 1, 1, {"orientation": "front", "groupId": "CHAIR_OFFICE"}),
    ("CHAIR_OFFICE_BACK", "Office Chair", "chairs",
     5, 16, 1, 1, {"orientation": "back", "groupId": "CHAIR_OFFICE"}),
    ("CHAIR_OFFICE_LEFT", "Office Chair", "chairs",
     6, 16, 1, 1, {"orientation": "left", "groupId": "CHAIR_OFFICE"}),
    ("CHAIR_OFFICE_RIGHT", "Office Chair", "chairs",
     7, 16, 1, 1, {"orientation": "right", "groupId": "CHAIR_OFFICE"}),

    # ── Armchairs (rotation group ARMCHAIR) ──
    ("ARMCHAIR_FRONT", "Armchair", "chairs",
     0, 16, 1, 1, {"orientation": "front", "groupId": "ARMCHAIR"}),
    ("ARMCHAIR_BACK", "Armchair", "chairs",
     1, 16, 1, 1, {"orientation": "back", "groupId": "ARMCHAIR"}),

    # ── Bookshelves (storage, backgroundTiles: 1) ──
    ("BOOKSHELF_WOOD", "Wooden Bookshelf", "storage",
     10, 6, 2, 2, {"backgroundTiles": 1}),
    ("BOOKSHELF_FULL", "Full Bookshelf", "storage",
     12, 6, 2, 2, {"backgroundTiles": 1}),

    # ── Electronics (canPlaceOnSurfaces) ──
    ("MONITOR_DARK", "Dark Monitor", "electronics",
     14, 22, 1, 2, {"canPlaceOnSurfaces": True}),
    ("MONITOR_BLUE", "Blue Monitor", "electronics",
     15, 22, 1, 2, {"canPlaceOnSurfaces": True}),

    # ── Wall items (canPlaceOnWalls) ──
    ("CLOCK_BLUE", "Wall Clock", "wall",
     0, 22, 1, 1, {"canPlaceOnWalls": True}),
    ("PAINTING_LANDSCAPE", "Landscape Painting", "wall",
     0, 24, 2, 2, {"canPlaceOnWalls": True}),
    ("PAINTING_LIGHTHOUSE", "Lighthouse Painting", "wall",
     2, 24, 2, 2, {"canPlaceOnWalls": True}),
    ("WHITEBOARD", "Whiteboard", "wall",
     2, 26, 2, 2, {"canPlaceOnWalls": True}),

    # ── Plants (decor) ──
    ("PLANT_SMALL", "Small Plant", "decor",
     1, 28, 1, 1, {}),
    ("PLANT_TALL_1", "Tall Plant", "decor",
     3, 28, 1, 2, {}),
    ("PLANT_TALL_2", "Tall Plant", "decor",
     5, 28, 1, 2, {}),

    # ── Appliances (misc) ──
    ("FRIDGE", "Office Fridge", "misc",
     12, 16, 2, 2, {}),
    ("VENDING_MACHINE", "Vending Machine", "misc",
     14, 16, 2, 2, {}),
    ("WATER_COOLER", "Water Cooler", "misc",
     8, 17, 1, 1, {}),

    # ── Other ──
    ("FILING_CABINET", "Filing Cabinet", "storage",
     1, 18, 1, 2, {}),
    ("RUG_BLUE", "Blue Rug", "decor",
     0, 30, 2, 2, {}),
    ("BOXES", "Cardboard Boxes", "storage",
     8, 28, 2, 1, {}),
]


def is_tile_empty(img, col, row):
    """Check if a 16x16 tile is fully transparent."""
    x0, y0 = col * TILE, row * TILE
    if x0 + TILE > img.width or y0 + TILE > img.height:
        return True
    region = img.crop((x0, y0, x0 + TILE, y0 + TILE))
    return all(p[3] < 8 for p in region.getdata())


def preview_grid(img, start_row=0, end_row=None):
    """Print ASCII grid showing occupied vs empty tiles."""
    cols = img.width // TILE
    rows = img.height // TILE
    if end_row is None:
        end_row = rows

    header = "     " + "".join(f"{c:>3}" for c in range(cols))
    print(header)
    print("     " + "---" * cols)

    for r in range(start_row, min(end_row, rows)):
        line = f"{r:>3} |"
        for c in range(cols):
            if is_tile_empty(img, c, r):
                line += "  ."
            else:
                line += "  #"
        print(line)


def slice_item(img, item):
    """Extract a multi-tile region from the tileset."""
    id_, label, category, col, row, w, h, extra = item
    x0 = col * TILE
    y0 = row * TILE
    x1 = x0 + w * TILE
    y1 = y0 + h * TILE
    return img.crop((x0, y0, x1, y1))


def make_catalog_entry(item):
    """Create a furniture-catalog.json entry."""
    id_, label, category, col, row, w, h, extra = item
    px_w = w * TILE
    px_h = h * TILE

    entry = {
        "id": id_,
        "name": id_.lower(),
        "label": label,
        "category": category,
        "file": f"furniture/{id_.lower()}.png",
        "width": px_w,
        "height": px_h,
        "footprintW": w,
        "footprintH": h,
        "isDesk": extra.get("isDesk", False),
        "canPlaceOnWalls": extra.get("canPlaceOnWalls", False),
    }

    for key in ("groupId", "orientation", "state",
                "canPlaceOnSurfaces", "backgroundTiles"):
        if key in extra:
            entry[key] = extra[key]

    # Mark grouped items
    if "groupId" in extra:
        entry["partOfGroup"] = True

    return entry


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)

    src_path = os.path.join(
        project_root, 'Asset', 'Office Tileset', 'Office Tileset All 16x16.png'
    )
    out_dir = os.path.join(
        project_root, 'webview-ui', 'public', 'assets', 'furniture'
    )

    if not os.path.exists(src_path):
        print(f"ERROR: Source tileset not found: {src_path}")
        sys.exit(1)

    img = Image.open(src_path).convert("RGBA")
    grid_cols = img.width // TILE
    grid_rows = img.height // TILE
    print(f"Tileset: {img.width}x{img.height}px = {grid_cols}x{grid_rows} tiles (16px grid)")

    # Preview mode
    if len(sys.argv) >= 2 and sys.argv[1] == "--preview":
        preview_grid(img)
        return
    if len(sys.argv) >= 2 and sys.argv[1] == "--preview-range":
        start = int(sys.argv[2])
        end = int(sys.argv[3])
        preview_grid(img, start, end)
        return

    # Slice mode
    os.makedirs(out_dir, exist_ok=True)

    catalog_entries = []
    for item in OFFICE_ITEMS:
        id_ = item[0]
        sprite = slice_item(img, item)

        # Skip if entirely empty
        pixels = sprite.getdata()
        if all(p[3] < 8 for p in pixels):
            print(f"  SKIP {id_} (empty)")
            continue

        png_path = os.path.join(out_dir, f"{id_.lower()}.png")
        sprite.save(png_path, "PNG")
        entry = make_catalog_entry(item)
        catalog_entries.append(entry)
        w, h = item[5], item[6]
        print(f"  OK {id_} ({w*TILE}x{h*TILE}px, {w}x{h} tiles)")

    # Write catalog
    catalog = {
        "version": 1,
        "totalAssets": len(catalog_entries),
        "categories": sorted(set(e["category"] for e in catalog_entries)),
        "assets": catalog_entries,
    }
    catalog_path = os.path.join(out_dir, "furniture-catalog.json")
    with open(catalog_path, "w") as f:
        json.dump(catalog, f, indent=2)

    print(f"\nExported {len(catalog_entries)} assets to {out_dir}/")
    print(f"Catalog written to {catalog_path}")


if __name__ == "__main__":
    main()
