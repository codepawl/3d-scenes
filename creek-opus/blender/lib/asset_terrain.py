"""Bank terrain: the carved core heightfield plus a coarse outer meadow ring."""

import math

import numpy as np
from mathutils import Vector, noise

from .creek_layout import TERRAIN_SPACING, TERRAIN_X, TERRAIN_Z
from .meshkit import build_mesh_object, make_material, smoothstep, to_blender


def _noise_grid(x, z, frequency, seed):
    flat = [noise.noise(Vector((px * frequency + seed, pz * frequency - seed, seed))) for px, pz in zip(x.ravel(), z.ravel())]
    return np.array(flat).reshape(x.shape)


def contact_and_grass(terrain, placements):
    """Darken the ground under props and keep grass out from under stones."""
    contact = np.ones_like(terrain.height)
    grass_keep = np.ones_like(terrain.height)
    for x, z, radius, strength in placements.footprints:
        ix0 = max(int((x - radius * 1.3 - TERRAIN_X[0]) / TERRAIN_SPACING), 0)
        ix1 = min(int((x + radius * 1.3 - TERRAIN_X[0]) / TERRAIN_SPACING) + 2, len(terrain.xs))
        iz0 = max(int((z - radius * 1.3 - TERRAIN_Z[0]) / TERRAIN_SPACING), 0)
        iz1 = min(int((z + radius * 1.3 - TERRAIN_Z[0]) / TERRAIN_SPACING) + 2, len(terrain.zs))
        if ix1 <= ix0 or iz1 <= iz0:
            continue
        distance = np.hypot(terrain.grid_x[iz0:iz1, ix0:ix1] - x, terrain.grid_z[iz0:iz1, ix0:ix1] - z)
        contact[iz0:iz1, ix0:ix1] *= 1.0 - strength * (1.0 - smoothstep(0.45 * radius, 1.3 * radius, distance))
        if strength >= 0.35:
            grass_keep[iz0:iz1, ix0:ix1] *= smoothstep(0.55 * radius, 0.95 * radius, distance)
    return contact, grass_keep


def terrain_colors(terrain, contact, grass_mask, bed_mask, dirt_mask):
    x = terrain.grid_x
    z = terrain.grid_z
    variation = _noise_grid(x, z, 0.09, 1.7)
    detail = _noise_grid(x, z, 0.45, 4.2)
    dry = smoothstep(0.35, 0.75, _noise_grid(x, z, 0.035, 7.7))

    lush = np.array([0.075, 0.2, 0.028])
    bright = np.array([0.2, 0.36, 0.05])
    straw = np.array([0.3, 0.33, 0.09])
    grass_mix = smoothstep(-0.6, 0.7, variation + 0.3 * detail)[..., None]
    grass = lush * (1 - grass_mix) + bright * grass_mix
    grass = grass * (1 - dry[..., None] * 0.35) + straw * dry[..., None] * 0.35

    dirt = np.array([0.12, 0.085, 0.055]) * (0.85 + 0.25 * detail[..., None])
    bed_light = np.array([0.24, 0.235, 0.17])
    bed_dark = np.array([0.1, 0.12, 0.075])
    bed_mix = smoothstep(-0.5, 0.6, detail + 0.5 * variation)[..., None]
    bed = bed_dark * (1 - bed_mix) + bed_light * bed_mix

    bed_weight = bed_mask[..., None]
    grass_weight = (grass_mask * (1 - bed_mask))[..., None]
    dirt_weight = np.clip(1.0 - bed_weight - grass_weight, 0.0, 1.0)
    color = grass * grass_weight + bed * bed_weight + dirt * dirt_weight
    occlusion = np.clip(terrain.ambient_occlusion(), 0.0, 1.0) ** 1.5
    color = color * (occlusion * contact)[..., None]
    alpha = np.ones(color.shape[:2] + (1,))
    return np.concatenate([color, alpha], axis=-1)


def _grid_faces(rows, columns, keep=None):
    faces = []
    for row in range(rows - 1):
        for column in range(columns - 1):
            if keep is not None and not keep[row, column]:
                continue
            a = row * columns + column
            faces.append([a, a + columns, a + columns + 1, a + 1])
    return faces


def build_core(terrain, placements):
    contact, grass_keep = contact_and_grass(terrain, placements)
    grass_mask = terrain.masks[..., 0] * grass_keep
    bed_mask = terrain.masks[..., 1]
    dirt_mask = terrain.masks[..., 2]
    colors = terrain_colors(terrain, contact, grass_mask, bed_mask, dirt_mask)
    rows, columns = terrain.height.shape
    three_points = np.stack([terrain.grid_x.ravel(), terrain.height.ravel(), terrain.grid_z.ravel()], axis=1)
    mask = np.stack([grass_mask.ravel(), bed_mask.ravel(), dirt_mask.ravel()], axis=1)
    material = make_material("terrain", roughness=0.95)
    obj = build_mesh_object(
        "terrain",
        to_blender(three_points),
        _grid_faces(rows, columns),
        colors=colors.reshape(-1, 4),
        attributes={"_mask": mask},
        materials=[material],
        smooth=True,
    )
    return obj, grass_mask


def build_far_ring(terrain, creek, material):
    spacing = 8.0
    extent = 480.0
    coordinates = np.arange(-extent, extent + 1e-6, spacing)
    grid_x, grid_z = np.meshgrid(coordinates, coordinates)
    inset = 1.0
    inside = (
        (grid_x > TERRAIN_X[0] + inset) & (grid_x < TERRAIN_X[1] - inset)
        & (grid_z > TERRAIN_Z[0] + inset) & (grid_z < TERRAIN_Z[1] - inset)
    )
    distance = np.empty(grid_x.size)
    for index, (px, pz) in enumerate(zip(grid_x.ravel(), grid_z.ravel())):
        _, _, distance[index] = creek.tree.find((px, pz, 0.0))
    distance = distance.reshape(grid_x.shape)
    height = terrain.meadow(grid_x, grid_z) + 0.006 * np.maximum(distance - 11.0, 0.0) ** 1.5
    core_height = terrain.height_at(grid_x, grid_z)
    height = np.where(inside, core_height - 0.3, height - 0.02)
    keep = ~(inside[:-1, :-1] & inside[1:, :-1] & inside[:-1, 1:] & inside[1:, 1:])
    variation = _noise_grid(grid_x, grid_z, 0.02, 3.3)
    lush = np.array([0.09, 0.22, 0.03])
    bright = np.array([0.2, 0.34, 0.05])
    mix = smoothstep(-0.6, 0.6, variation)[..., None]
    color = lush * (1 - mix) + bright * mix
    colors = np.concatenate([color, np.ones(color.shape[:2] + (1,))], axis=-1)
    rows, columns = grid_x.shape
    three_points = np.stack([grid_x.ravel(), height.ravel(), grid_z.ravel()], axis=1)
    mask = np.tile(np.array([[1.0, 0.0, 0.0]]), (grid_x.size, 1))
    return build_mesh_object(
        "terrain_far",
        to_blender(three_points),
        _grid_faces(rows, columns, keep),
        colors=colors.reshape(-1, 4),
        attributes={"_mask": mask},
        materials=[material],
        smooth=True,
    )


def build_terrain(terrain, creek, placements):
    core, grass_mask = build_core(terrain, placements)
    far = build_far_ring(terrain, creek, core.data.materials[0])
    return [core, far], grass_mask


def write_field(path, terrain, grass_mask):
    """Binary grid for the web app: height, water level, lateral offset, s, grass, bed (float32 planes)."""
    planes = [
        terrain.height,
        terrain.water,
        terrain.lateral,
        terrain.s,
        grass_mask,
        terrain.masks[..., 1],
    ]
    with open(path, "wb") as handle:
        for plane in planes:
            handle.write(np.ascontiguousarray(plane, dtype="<f4").tobytes())
    return ["height", "water", "lateral", "s", "grass", "bed"]
