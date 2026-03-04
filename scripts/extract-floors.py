#!/usr/bin/env python3
"""
Extract floor tile patterns from VX Ace A2 autotile sheet.

Source: Asset/Office Tileset/Office VX Ace/A2 Office Floors.png (512x384)
Output: webview-ui/public/assets/floors.png (112x16 strip, 7 grayscale patterns)

VX Ace A2 autotile blocks are 64x96 (2x3 sub-tiles of 32x32).
The center (no-edge) tile is at sub-tile position (1, 2) in each block.
We extract 7 diverse patterns, scale 32->16, and convert to grayscale.
"""

import os
from PIL import Image

# VX Ace A2 autotile dimensions
BLOCK_W = 64   # 2 sub-tiles x 32px
BLOCK_H = 96   # 3 sub-tiles x 32px
SUB_TILE = 32  # Each sub-tile is 32x32

# Output dimensions
OUT_TILE = 16  # PixelClaw floor tile size
PATTERN_COUNT = 7

# Block positions (col, row) in the A2 block grid.
# The A2 sheet is 8 blocks across x 4 blocks down.
# We pick 7 blocks that give diverse grayscale patterns:
#   Row 0: solid/subtle textures
#   Row 1: visible grid/diamond/dot patterns
#   Row 2: more patterns
BLOCK_PICKS = [
    (0, 0),  # Pattern 0: dark subtle
    (3, 0),  # Pattern 1: blue-ish solid
    (0, 1),  # Pattern 2: grid lines
    (2, 1),  # Pattern 3: diamond crosshatch
    (3, 1),  # Pattern 4: diamond variant
    (5, 1),  # Pattern 5: dot pattern
    (6, 1),  # Pattern 6: small dot pattern
]


def extract_center_tile(img, block_col, block_row):
    """Extract the center (no-edge) 32x32 tile from an A2 autotile block.

    In VX Ace A2 format, the center tile is at sub-tile position (1, 2)
    within the 2x3 sub-tile grid of each 64x96 block.
    """
    bx = block_col * BLOCK_W
    by = block_row * BLOCK_H
    # Center tile = sub-tile at column 1, row 2
    x = bx + SUB_TILE  # offset by 32px (column 1)
    y = by + 2 * SUB_TILE  # offset by 64px (row 2)
    return img.crop((x, y, x + SUB_TILE, y + SUB_TILE))


def to_grayscale_tile(tile):
    """Convert a 32x32 RGBA tile to 16x16 grayscale (as RGBA for PNG output)."""
    # Scale down to 16x16 using nearest neighbor (preserve pixel art)
    scaled = tile.resize((OUT_TILE, OUT_TILE), Image.NEAREST)
    # Convert to grayscale (luminance: 0.299R + 0.587G + 0.114B)
    gray = scaled.convert('L')
    # Convert back to RGBA for consistent PNG output
    return gray.convert('RGBA')


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)

    src_path = os.path.join(
        project_root, 'Asset', 'Office Tileset', 'Office VX Ace', 'A2 Office Floors.png'
    )
    out_path = os.path.join(project_root, 'webview-ui', 'public', 'assets', 'floors.png')

    if not os.path.exists(src_path):
        print(f"ERROR: Source not found: {src_path}")
        return

    img = Image.open(src_path).convert('RGBA')
    block_cols = img.width // BLOCK_W
    block_rows = img.height // BLOCK_H
    print(f"Source: {img.width}x{img.height}px ({block_cols} x {block_rows} A2 blocks)")

    # Create output strip (112x16, transparent background)
    strip = Image.new('RGBA', (OUT_TILE * PATTERN_COUNT, OUT_TILE), (0, 0, 0, 0))

    for i, (bc, br) in enumerate(BLOCK_PICKS):
        if bc >= block_cols or br >= block_rows:
            print(f"  SKIP pattern {i}: block ({bc},{br}) out of range")
            continue
        tile = extract_center_tile(img, bc, br)
        gray_tile = to_grayscale_tile(tile)
        strip.paste(gray_tile, (i * OUT_TILE, 0))
        print(f"  Pattern {i}: block ({bc},{br}) extracted")

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    strip.save(out_path, 'PNG')
    print(f"\nSaved {strip.width}x{strip.height}px strip to {out_path}")


if __name__ == '__main__':
    main()
