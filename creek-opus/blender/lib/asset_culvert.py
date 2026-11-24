"""Stone culvert: coursed headwall, voussoir arch, dark barrel and floor.

Local Blender coordinates: X across the creek, +Y into the embankment (upstream),
Z up with Z = 0 at the culvert floor. The front face looks toward -Y (downstream).
"""

import math

import numpy as np
from mathutils import Vector, geometry

from .meshkit import build_mesh_object, make_material, smoothstep
from .shapes import MeshBuilder, rounded_block_arrays

ARCH_RADIUS = 1.2
SPRINGLINE = 0.75
RING_THICKNESS = 0.42
WALL_HALF_WIDTH = 4.8
WALL_BOTTOM = -0.4
WALL_TOP = 3.1
FRONT_Y = -0.35
BARREL_LENGTH = 7.0


def _stone_color(rng, moss_bias):
    grey = rng.uniform(0.15, 0.27)
    warm = rng.uniform(-0.015, 0.02)
    color = np.array([grey + warm, grey + warm * 0.5, grey - warm * 0.4])
    if rng.random() < moss_bias:
        moss = rng.uniform(0.15, 0.45)
        color = color * (1 - moss) + np.array([0.11, 0.16, 0.06]) * moss
    return color


def _block(builder, rng, center, size, color, exponent=5.5):
    points, faces, offset = rounded_block_arrays(int(rng.integers(0, 1_000_000)), exponent=exponent, segments=3, lumpiness=0.045)
    vertices = points * np.asarray(size) + np.asarray(center)
    shade = 0.85 + 0.15 * smoothstep(-0.5, 0.5, points[:, 2])
    front = smoothstep(0.1, -0.45, points[:, 1])
    colors = color[None, :] * (shade * (0.9 + 0.1 * front))[:, None]
    builder.add(vertices, faces, colors)


def _course_heights(bottom, top, count):
    heights = np.full(count, (top - bottom) / count)
    return np.concatenate([[bottom], bottom + np.cumsum(heights)])


def _headwall(builder, rng):
    ring_outer = ARCH_RADIUS + RING_THICKNESS
    boundaries = np.concatenate([_course_heights(WALL_BOTTOM, SPRINGLINE, 3), _course_heights(SPRINGLINE, WALL_TOP - 0.27, 6)[1:]])
    for course_index in range(len(boundaries) - 1):
        z0 = boundaries[course_index]
        z1 = boundaries[course_index + 1]
        middle = 0.5 * (z0 + z1)
        if z1 <= SPRINGLINE + 1e-6:
            exclusion = ARCH_RADIUS
        elif middle - SPRINGLINE < ring_outer:
            exclusion = math.sqrt(ring_outer ** 2 - (middle - SPRINGLINE) ** 2) - 0.03
        else:
            exclusion = 0.0
        moss_bias = 0.55 if course_index < 3 else 0.18
        if exclusion > 0:
            runs = [(exclusion, WALL_HALF_WIDTH, 1.0), (exclusion, WALL_HALF_WIDTH, -1.0)]
        else:
            runs = [(-WALL_HALF_WIDTH, WALL_HALF_WIDTH, 1.0)]
        for start, end, side in runs:
            position = start
            while position < end - 0.05:
                length = min(rng.uniform(0.36, 0.7), end - position)
                if end - position - length < 0.2:
                    length = end - position
                center_x = side * (position + length * 0.5)
                depth = 0.62
                protrude = rng.uniform(-0.02, 0.03)
                center = (center_x, FRONT_Y + depth * 0.5 - protrude, 0.5 * (z0 + z1) + rng.uniform(-0.01, 0.01))
                size = (length - 0.035, depth, (z1 - z0) - 0.035)
                _block(builder, rng, center, size, _stone_color(rng, moss_bias))
                position += length

    # Capstones along the top.
    position = -WALL_HALF_WIDTH - 0.05
    while position < WALL_HALF_WIDTH + 0.05:
        length = min(rng.uniform(0.6, 0.95), WALL_HALF_WIDTH + 0.05 - position)
        if length < 0.2:
            break
        center = (position + length * 0.5, FRONT_Y + 0.42 - 0.07, WALL_TOP - 0.135)
        _block(builder, rng, center, (length - 0.03, 0.84, 0.25), _stone_color(rng, 0.25) * 1.12, exponent=6.0)
        position += length


def _voussoirs(builder, rng):
    count = 15
    span = math.pi / count
    for index in range(count):
        points, faces, _ = rounded_block_arrays(int(rng.integers(0, 1_000_000)), exponent=6.0, segments=3, lumpiness=0.03)
        keystone = index == count // 2
        thickness = RING_THICKNESS + (0.08 if keystone else rng.uniform(-0.02, 0.03))
        depth = 0.66
        angle_center = (index + 0.5) * span
        angle = angle_center + points[:, 0] * (span - 0.035)
        radius = ARCH_RADIUS + (points[:, 2] + 0.5) * thickness
        y = FRONT_Y + depth * 0.5 + points[:, 1] * depth - (0.03 if keystone else 0.0)
        vertices = np.stack([radius * np.cos(angle), y, SPRINGLINE + radius * np.sin(angle)], axis=1)
        color = _stone_color(rng, 0.2) * (1.12 if keystone else 1.0)
        colors = np.tile(color, (len(vertices), 1))
        builder.add(vertices, faces, colors)


def _arch_profile(segments=18):
    """Inner opening outline from the right floor corner, up, over, and down the left side."""
    profile = [(ARCH_RADIUS, -0.05), (ARCH_RADIUS, SPRINGLINE)]
    for step in range(1, segments):
        angle = math.pi * step / segments
        profile.append((ARCH_RADIUS * math.cos(angle), SPRINGLINE + ARCH_RADIUS * math.sin(angle)))
    profile.extend([(-ARCH_RADIUS, SPRINGLINE), (-ARCH_RADIUS, -0.05)])
    return profile


def _barrel(builder):
    profile = _arch_profile()
    rings = 15
    vertices = []
    colors = []
    for ring in range(rings):
        y = FRONT_Y + 0.02 + BARREL_LENGTH * ring / (rings - 1)
        fade = 0.06 + 0.94 * math.exp(-(y - FRONT_Y) * 1.15)
        for index, (x, z) in enumerate(profile):
            vertices.append((x, y, z))
            stripe = 0.85 + 0.15 * math.sin(index * 1.7 + ring * 2.3)
            colors.append(np.array([0.085, 0.09, 0.08]) * fade * stripe)
    faces = []
    stride = len(profile)
    for ring in range(rings - 1):
        for index in range(stride - 1):
            a = ring * stride + index
            faces.append([a, a + 1, a + stride + 1, a + stride])
    builder.add(np.array(vertices), np.array(faces), np.array(colors))

    floor = np.array([
        (-ARCH_RADIUS, FRONT_Y - 0.1, 0.0), (ARCH_RADIUS, FRONT_Y - 0.1, 0.0),
        (ARCH_RADIUS, FRONT_Y + BARREL_LENGTH, 0.0), (-ARCH_RADIUS, FRONT_Y + BARREL_LENGTH, 0.0),
    ])
    floor_colors = np.array([[0.09, 0.1, 0.08], [0.09, 0.1, 0.08], [0.01, 0.01, 0.01], [0.01, 0.01, 0.01]])
    builder.add(floor, np.array([[0, 1, 2, 3]]), floor_colors)

    cap_outline = [Vector((x, z, 0.0)) for x, z in profile]
    triangles = geometry.tessellate_polygon([cap_outline])
    cap_vertices = np.array([(x, FRONT_Y + BARREL_LENGTH, z) for x, z in profile])
    builder.add(cap_vertices, np.array([list(triangle) for triangle in triangles]), np.array([0.004, 0.004, 0.004]))


def _backing(builder):
    """Dark mortar plate behind the blocks so joints never show sky."""
    outer = [(-WALL_HALF_WIDTH, WALL_BOTTOM), (WALL_HALF_WIDTH, WALL_BOTTOM), (WALL_HALF_WIDTH, WALL_TOP - 0.1), (-WALL_HALF_WIDTH, WALL_TOP - 0.1)]
    hole = list(reversed(_arch_profile()))
    hole = [(x * 1.0, max(z, WALL_BOTTOM + 0.01)) for x, z in hole]
    loops = [[Vector((x, z, 0.0)) for x, z in outer], [Vector((x, z, 0.0)) for x, z in hole]]
    triangles = geometry.tessellate_polygon(loops)
    points = outer + hole
    vertices = np.array([(x, FRONT_Y + 0.12, z) for x, z in points])
    faces = np.array([[triangle[0], triangle[2], triangle[1]] for triangle in triangles])
    builder.add(vertices, faces, np.array([0.05, 0.05, 0.045]))


def build_culvert(seed=5):
    rng = np.random.default_rng(seed)
    builder = MeshBuilder()
    _headwall(builder, rng)
    _voussoirs(builder, rng)
    _backing(builder)
    _barrel(builder)
    vertices, faces, colors, _, _, _ = builder.arrays()
    material = make_material("culvert_stone", roughness=0.86)
    return build_mesh_object("culvert", vertices, faces, colors=colors, materials=[material], smooth=True)
