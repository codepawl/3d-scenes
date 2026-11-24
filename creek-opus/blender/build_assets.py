"""Build every creek asset procedurally and export GLB files plus the shared layout.

Run with Blender 5.2 in the background (see tools/build-assets.ps1):
    blender --background --factory-startup --python blender/build_assets.py
"""

import json
import math
import os
import sys
import time

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, SCRIPT_DIR)

import numpy as np  # noqa: E402

from lib import asset_cabin, asset_culvert, asset_terrain, asset_trees, creek_layout, meshkit, shapes  # noqa: E402

PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
ASSET_DIR = os.path.join(PROJECT_DIR, "assets")
BUILD_DIR = os.path.join(SCRIPT_DIR, "build")


def log(message, started):
    print(f"[{time.time() - started:6.1f}s] {message}", flush=True)


def build_rocks():
    objects = []
    stone_material = meshkit.make_material("stone", roughness=0.82)
    wall_material = meshkit.make_material("wallstone", roughness=0.88)
    pebble_material = meshkit.make_material("pebble", roughness=0.7)
    for variant in range(creek_layout.Placements.STONE_VARIANTS):
        points, faces, colors = shapes.pancake_stone(1000 + variant * 17)
        objects.append(meshkit.build_mesh_object(f"stone_{variant}", points, faces, colors=colors, materials=[stone_material]))
    for variant in range(creek_layout.Placements.WALL_VARIANTS):
        points, faces, colors = shapes.wall_stone(2000 + variant * 31)
        objects.append(meshkit.build_mesh_object(f"wallstone_{variant}", points, faces, colors=colors, materials=[wall_material]))
    for variant in range(creek_layout.Placements.PEBBLE_VARIANTS):
        points, faces, colors = shapes.pebble(3000 + variant * 7)
        objects.append(meshkit.build_mesh_object(f"pebble_{variant}", points, faces, colors=colors, materials=[pebble_material]))
    return objects


def creek_samples(creek):
    spacing = 0.25
    rows = []
    for s in np.arange(0.0, creek.length, spacing):
        x, z = creek.point(s, 0.0)
        rows.append([
            round(float(x), 3), round(float(z), 3), round(float(s), 3),
            round(float(creek.water_level(s)), 4), round(float(creek.half_width(s)), 3), round(float(creek.depth(s)), 3),
        ])
    return spacing, rows


def write_layout(path, creek, terrain, placements, field_planes):
    culvert_s = creek.culvert_s
    culvert_floor = float(creek.water_level(culvert_s) - creek.depth(culvert_s))
    cabin_x, cabin_z = creek_layout.CABIN_POSITION
    footprint = [float(terrain.height_at(cabin_x + dx, cabin_z + dz)) for dx in (-2.4, 0, 2.4) for dz in (-3.0, 0, 2.0)]
    cabin_ground = float(np.mean(footprint))
    spacing, samples = creek_samples(creek)
    layout = {
        "version": 1,
        "units": "metres; three.js world coordinates (x right, y up, z toward the downstream end)",
        "creek": {
            "spacing": spacing,
            "columns": ["x", "z", "s", "water", "halfWidth", "depth"],
            "samples": samples,
            "length": round(creek.length, 3),
            "culvertS": round(culvert_s, 3),
            "cascades": [[round(s, 3), drop] for s, drop in creek.cascade_s],
        },
        "field": {
            "file": "field.bin",
            "nx": len(terrain.xs),
            "nz": len(terrain.zs),
            "x0": creek_layout.TERRAIN_X[0],
            "z0": creek_layout.TERRAIN_Z[0],
            "spacing": creek_layout.TERRAIN_SPACING,
            "planes": field_planes,
        },
        "instances": placements.instances,
        "objects": {
            "culvert": {"position": [0.0, round(culvert_floor, 3), creek_layout.CULVERT_Z], "yaw": 0.0},
            "cabin": {
                "position": [cabin_x, round(cabin_ground, 3), cabin_z],
                "yaw": round(math.radians(creek_layout.CABIN_YAW_DEGREES), 4),
                "footprintHeights": [round(value, 3) for value in footprint],
            },
        },
    }
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(layout, handle, separators=(",", ":"))


def main():
    started = time.time()
    os.makedirs(ASSET_DIR, exist_ok=True)
    os.makedirs(BUILD_DIR, exist_ok=True)
    meshkit.reset_scene()

    creek = creek_layout.Creek()
    log(f"creek length {creek.length:.1f} m, culvert at s={creek.culvert_s:.1f}", started)
    terrain = creek_layout.Terrain(creek)
    log(f"terrain grid {terrain.height.shape}, height range {terrain.height.min():.2f}..{terrain.height.max():.2f}", started)
    placements = creek_layout.Placements(creek, terrain)
    counts = {name: len(rows) for name, rows in sorted(placements.instances.items())}
    log(f"instances {counts}", started)

    meshkit.reset_scene()
    terrain_objects, grass_mask = asset_terrain.build_terrain(terrain, creek, placements)
    meshkit.export_glb(os.path.join(ASSET_DIR, "terrain.glb"), terrain_objects)
    field_planes = asset_terrain.write_field(os.path.join(ASSET_DIR, "field.bin"), terrain, grass_mask)
    log("terrain.glb + field.bin", started)

    meshkit.reset_scene()
    meshkit.export_glb(os.path.join(ASSET_DIR, "rocks.glb"), build_rocks())
    log("rocks.glb", started)

    meshkit.reset_scene()
    meshkit.export_glb(os.path.join(ASSET_DIR, "culvert.glb"), [asset_culvert.build_culvert()])
    log("culvert.glb", started)

    meshkit.reset_scene()
    meshkit.export_glb(os.path.join(ASSET_DIR, "cabin.glb"), asset_cabin.build_cabin())
    log("cabin.glb", started)

    meshkit.reset_scene()
    tree_objects = asset_trees.build_trees(os.path.join(BUILD_DIR, "leaf_atlas.png"))
    meshkit.export_glb(os.path.join(ASSET_DIR, "trees.glb"), tree_objects)
    log("trees.glb", started)

    write_layout(os.path.join(ASSET_DIR, "layout.json"), creek, terrain, placements, field_planes)
    log("layout.json", started)

    for name in sorted(os.listdir(ASSET_DIR)):
        size = os.path.getsize(os.path.join(ASSET_DIR, name))
        print(f"  {name:16s} {size / 1024:9.1f} KB")


main()
