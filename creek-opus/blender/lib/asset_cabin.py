"""Small two-storey timber cabin with a stone plinth, porch, balcony and warm windows.

Local Blender coordinates: X across the front, the front faces -Y (three.js +Z), Z up,
origin on the ground under the middle of the main body.
"""

import math

import numpy as np
from mathutils import Matrix

from .meshkit import build_mesh_object, make_material
from .shapes import MeshBuilder, box_arrays, rounded_block_arrays

BODY = 0
GLASS = 1
LAMP = 2

HALF_WIDTH = 2.5
HALF_DEPTH = 2.0
FLOOR = 0.55
STOREY = 3.05
RIDGE = 5.9
PITCH = 0.717  # roof rise per metre
EAVE_X = 3.05
PORCH_FRONT = -3.8

WOOD = np.array([0.30, 0.155, 0.068])
WOOD_DARK = np.array([0.11, 0.055, 0.025])
TRIM = np.array([0.72, 0.66, 0.5])
SHUTTER = np.array([0.13, 0.21, 0.15])
ROOF = np.array([0.036, 0.06, 0.115])
METAL = np.array([0.025, 0.024, 0.022])


def gable_half_width(z):
    return min(HALF_WIDTH, (RIDGE - z) / PITCH)


class Cabin:
    def __init__(self, seed=3):
        self.rng = np.random.default_rng(seed)
        self.body = MeshBuilder()
        self.stone = MeshBuilder()

    # ----- primitives ----------------------------------------------------
    def box(self, center, size, color, rotation=None, material=BODY, jitter=0.0):
        vertices, faces = box_arrays(center, size, rotation)
        shade = 1.0 + (self.rng.uniform(-jitter, jitter) if jitter else 0.0)
        self.body.add(vertices, faces, np.clip(np.asarray(color) * shade, 0, 1), material)

    def wall_box(self, wall, u, z, along, height, thickness, offset, color, material=BODY, tilt=0.0, jitter=0.0):
        """Box aligned to a wall. wall = 'front', 'back', 'left', 'right'; offset is outward from the wall plane."""
        if wall in ("front", "back"):
            normal_sign = -1.0 if wall == "front" else 1.0
            center = (u, normal_sign * (HALF_DEPTH + offset), z)
            size = (along, thickness, height)
            rotation = Matrix.Rotation(normal_sign * tilt, 3, "X")
        else:
            normal_sign = -1.0 if wall == "left" else 1.0
            center = (normal_sign * (HALF_WIDTH + offset), u, z)
            size = (thickness, along, height)
            rotation = Matrix.Rotation(-normal_sign * tilt, 3, "Y")
        self.box(center, size, color, rotation if tilt else None, material, jitter)

    # ----- parts ---------------------------------------------------------
    def plinth(self):
        rng = self.rng
        faces = [
            ("front", -HALF_WIDTH - 0.15, HALF_WIDTH + 0.15, PORCH_FRONT, "y"),
            ("back", -HALF_WIDTH - 0.15, HALF_WIDTH + 0.15, HALF_DEPTH + 0.15, "y"),
            ("left", PORCH_FRONT, HALF_DEPTH + 0.15, -HALF_WIDTH - 0.15, "x"),
            ("right", PORCH_FRONT, HALF_DEPTH + 0.15, HALF_WIDTH + 0.15, "x"),
        ]
        courses = [(-0.7, -0.28), (-0.28, 0.12), (0.12, FLOOR - 0.02)]
        for name, start, end, plane, axis in faces:
            for course_index, (z0, z1) in enumerate(courses):
                position = start + (0.2 if course_index % 2 else 0.0)
                if course_index % 2:
                    self._stone_block(name, plane, axis, start, position, z0, z1)
                while position < end - 0.05:
                    length = min(rng.uniform(0.42, 0.75), end - position)
                    if end - position - length < 0.2:
                        length = end - position
                    self._stone_block(name, plane, axis, position, position + length, z0, z1)
                    position += length

    def _stone_block(self, name, plane, axis, start, end, z0, z1):
        rng = self.rng
        points, faces, _ = rounded_block_arrays(int(rng.integers(0, 1_000_000)), exponent=5.0, segments=3, lumpiness=0.05)
        length = end - start - 0.03
        height = z1 - z0 - 0.03
        depth = 0.32
        middle = 0.5 * (start + end)
        inward = 1.0 if name in ("front", "left") else -1.0
        if axis == "y":
            center = (middle, plane + inward * depth * 0.5, 0.5 * (z0 + z1))
            size = (length, depth, height)
        else:
            center = (plane + inward * depth * 0.5, middle, 0.5 * (z0 + z1))
            size = (depth, length, height)
        grey = rng.uniform(0.17, 0.3)
        color = np.array([grey * 1.03, grey, grey * 0.94])
        self.stone.add(points * np.asarray(size) + np.asarray(center), faces, color)

    def siding(self, wall, openings):
        rng = self.rng
        z = FLOOR
        top_limit = RIDGE - 0.05 if wall in ("front", "back") else 4.1
        half_length = HALF_WIDTH if wall in ("front", "back") else HALF_DEPTH
        while z < top_limit - 0.05:
            plank_top = z + 0.2
            extent = gable_half_width(plank_top) - 0.02 if wall in ("front", "back") else half_length
            if extent <= 0.1:
                break
            pieces = [(-extent, extent)]
            for u0, u1, z0, z1 in openings:
                if plank_top > z0 - 0.01 and z < z1 + 0.01:
                    next_pieces = []
                    for a, b in pieces:
                        if u1 <= a or u0 >= b:
                            next_pieces.append((a, b))
                            continue
                        if u0 > a:
                            next_pieces.append((a, u0))
                        if u1 < b:
                            next_pieces.append((u1, b))
                    pieces = next_pieces
            weathered = rng.uniform(0.0, 1.0)
            color = WOOD * rng.uniform(0.82, 1.16)
            if weathered < 0.15:
                color = color * 0.7 + np.array([0.2, 0.17, 0.13]) * 0.3
            for a, b in pieces:
                if b - a < 0.06:
                    continue
                self.wall_box(wall, 0.5 * (a + b), z + 0.1, b - a, 0.205, 0.035, 0.02, color, tilt=0.06)
            z += 0.18

    def window(self, wall, u0, u1, z0, z1, shutters=False, flower_box=False):
        rng = self.rng
        width = u1 - u0
        height = z1 - z0
        middle_u = 0.5 * (u0 + u1)
        middle_z = 0.5 * (z0 + z1)
        self.wall_box(wall, middle_u, middle_z, width, height, 0.02, -0.03, (0.02, 0.022, 0.025), GLASS)
        frame = 0.075
        self.wall_box(wall, u0 - frame * 0.5, middle_z, frame, height + frame * 2, 0.09, 0.03, TRIM)
        self.wall_box(wall, u1 + frame * 0.5, middle_z, frame, height + frame * 2, 0.09, 0.03, TRIM)
        self.wall_box(wall, middle_u, z1 + frame * 0.5, width + frame * 2, frame, 0.09, 0.03, TRIM)
        self.wall_box(wall, middle_u, z0 - 0.045, width + 0.26, 0.06, 0.18, 0.07, TRIM)
        self.wall_box(wall, middle_u, middle_z, 0.04, height, 0.04, -0.01, TRIM)
        self.wall_box(wall, middle_u, z0 + height * 0.56, width, 0.04, 0.04, -0.01, TRIM)
        if shutters:
            for side in (-1.0, 1.0):
                shutter_u = (u0 - frame - 0.24) if side < 0 else (u1 + frame + 0.24)
                self.wall_box(wall, shutter_u, middle_z, 0.44, height + 0.1, 0.04, 0.05, SHUTTER, jitter=0.05)
                for slat in range(6):
                    slat_z = z0 + 0.1 + slat * (height - 0.1) / 6.0
                    self.wall_box(wall, shutter_u, slat_z, 0.4, 0.035, 0.02, 0.08, SHUTTER * 0.8)
        if flower_box:
            self.wall_box(wall, middle_u, z0 - 0.2, width + 0.1, 0.2, 0.22, 0.13, WOOD_DARK * 1.4)
            palette = [np.array([0.8, 0.16, 0.3]), np.array([0.85, 0.55, 0.08]), np.array([0.85, 0.82, 0.78]), np.array([0.62, 0.2, 0.55])]
            for _ in range(16):
                flower_u = middle_u + rng.uniform(-width * 0.5, width * 0.5)
                leaf_color = np.array([0.06, 0.16, 0.03]) * rng.uniform(0.8, 1.3)
                self.wall_box(wall, flower_u, z0 - 0.06 + rng.uniform(0, 0.05), 0.09, 0.08, 0.09, 0.13 + rng.uniform(-0.05, 0.05), leaf_color)
                color = palette[rng.integers(0, len(palette))]
                self.wall_box(wall, flower_u + rng.uniform(-0.03, 0.03), z0 + 0.02 + rng.uniform(0, 0.06), 0.06, 0.05, 0.06, 0.14 + rng.uniform(-0.06, 0.06), color)

    def door(self, wall, u0, u1, z0, z1, glazed=False):
        width = u1 - u0
        middle_u = 0.5 * (u0 + u1)
        boards = 5
        for board in range(boards):
            board_u = u0 + (board + 0.5) * width / boards
            self.wall_box(wall, board_u, 0.5 * (z0 + z1), width / boards - 0.01, z1 - z0, 0.05, -0.03, WOOD_DARK * self.rng.uniform(0.85, 1.2))
        if glazed:
            glass_bottom = z0 + (z1 - z0) * 0.45
            self.wall_box(wall, middle_u, 0.5 * (glass_bottom + z1 - 0.12), width - 0.22, z1 - 0.12 - glass_bottom, 0.02, 0.003, (0.02, 0.022, 0.025), GLASS)
        frame = 0.08
        self.wall_box(wall, u0 - frame * 0.5, 0.5 * (z0 + z1), frame, z1 - z0 + frame, 0.1, 0.03, TRIM)
        self.wall_box(wall, u1 + frame * 0.5, 0.5 * (z0 + z1), frame, z1 - z0 + frame, 0.1, 0.03, TRIM)
        self.wall_box(wall, middle_u, z1 + frame * 0.5, width + frame * 2, frame, 0.1, 0.03, TRIM)
        self.wall_box(wall, u1 - 0.12, z0 + 1.0, 0.05, 0.05, 0.05, 0.02, (0.6, 0.42, 0.12))

    def lantern(self, center):
        x, y, z = center
        self.box((x, y, z + 0.13), (0.17, 0.17, 0.03), METAL)
        self.box((x, y, z), (0.13, 0.13, 0.2), (0.6, 0.45, 0.25), material=LAMP)
        self.box((x, y, z - 0.12), (0.15, 0.15, 0.03), METAL)
        for dx in (-0.065, 0.065):
            for dy in (-0.065, 0.065):
                self.box((x + dx, y + dy, z), (0.02, 0.02, 0.22), METAL)

    def porch(self):
        rng = self.rng
        plank = 0.14
        y = HALF_DEPTH * -1.0
        while y > PORCH_FRONT + 0.02:
            self.box((0.0, y - plank * 0.5, FLOOR - 0.02), (2 * HALF_WIDTH + 0.2, plank - 0.012, 0.04), WOOD * rng.uniform(0.75, 1.05))
            y -= plank
        for step in range(3):
            top = FLOOR - (step + 1) * 0.18
            self.box((0.0, PORCH_FRONT - 0.16 - step * 0.28, top + 0.02), (1.3, 0.3, 0.06), WOOD * rng.uniform(0.75, 1.0))
            self.box((0.0, PORCH_FRONT - 0.16 - step * 0.28, top - 0.1), (1.3, 0.28, 0.2), WOOD_DARK)
        post_x = [-HALF_WIDTH + 0.08, -0.82, 0.82, HALF_WIDTH - 0.08]
        post_y = PORCH_FRONT + 0.1
        for x in post_x:
            self.box((x, post_y, 0.5 * (FLOOR + STOREY)), (0.15, 0.15, STOREY - FLOOR), WOOD_DARK * 1.6)
        for x in (-HALF_WIDTH + 0.08, HALF_WIDTH - 0.08):
            self.box((x, -HALF_DEPTH - 0.08, 0.5 * (FLOOR + STOREY)), (0.13, 0.13, STOREY - FLOOR), WOOD_DARK * 1.6)
        self.box((0.0, post_y, STOREY - 0.08), (2 * HALF_WIDTH + 0.1, 0.18, 0.16), WOOD_DARK * 1.5)
        spans = [((-HALF_WIDTH + 0.08, post_y), (-0.82, post_y)), ((0.82, post_y), (HALF_WIDTH - 0.08, post_y)),
                 ((-HALF_WIDTH + 0.08, post_y), (-HALF_WIDTH + 0.08, -HALF_DEPTH - 0.08)),
                 ((HALF_WIDTH - 0.08, post_y), (HALF_WIDTH - 0.08, -HALF_DEPTH - 0.08))]
        for start, end in spans:
            self.railing(start, end, FLOOR, 0.92)
        # Balcony floor above the porch.
        self.box((0.0, 0.5 * (PORCH_FRONT - 0.05 - HALF_DEPTH), STOREY + 0.06), (2 * HALF_WIDTH + 0.24, -HALF_DEPTH - PORCH_FRONT + 0.1, 0.12), WOOD_DARK * 1.3)
        self.box((0.0, PORCH_FRONT - 0.06, STOREY + 0.06), (2 * HALF_WIDTH + 0.28, 0.06, 0.2), TRIM)
        balcony_y = PORCH_FRONT + 0.02
        corners = [(-HALF_WIDTH - 0.06, -HALF_DEPTH - 0.02), (-HALF_WIDTH - 0.06, balcony_y), (HALF_WIDTH + 0.06, balcony_y), (HALF_WIDTH + 0.06, -HALF_DEPTH - 0.02)]
        for start, end in zip(corners[:-1], corners[1:]):
            self.railing(start, end, STOREY + 0.12, 0.9)
        for x, y in corners[1:3]:
            self.box((x, y, STOREY + 0.6), (0.12, 0.12, 1.0), WOOD_DARK * 1.6)
        self.lantern((0.0, -2.9, STOREY - 0.35))

    def railing(self, start, end, base, height):
        rng = self.rng
        start = np.array(start, dtype=np.float64)
        end = np.array(end, dtype=np.float64)
        direction = end - start
        length = float(np.linalg.norm(direction))
        unit = direction / length
        rotation = Matrix.Rotation(math.atan2(unit[1], unit[0]), 3, "Z")
        middle = 0.5 * (start + end)
        self.box((middle[0], middle[1], base + height), (length, 0.08, 0.06), TRIM, rotation)
        self.box((middle[0], middle[1], base + 0.12), (length, 0.06, 0.05), TRIM, rotation)
        count = max(int(length / 0.16), 1)
        for index in range(1, count):
            point = start + unit * (index * length / count)
            self.box((point[0], point[1], base + 0.12 + height * 0.5 - 0.03), (0.035, 0.035, height - 0.14), TRIM * rng.uniform(0.92, 1.0), rotation)

    def roof(self):
        rng = self.rng
        angle = math.atan(PITCH)
        slope_length = EAVE_X / math.cos(angle)
        y_front = -HALF_DEPTH - 0.55
        y_back = HALF_DEPTH + 0.5
        roof_depth = y_back - y_front
        for side in (-1.0, 1.0):
            rotation = Matrix.Rotation(side * angle, 3, "Y")
            down = np.array([side * math.cos(angle), 0.0, -math.sin(angle)])
            normal = np.array([side * math.sin(angle), 0.0, math.cos(angle)])
            ridge = np.array([0.0, 0.5 * (y_front + y_back), RIDGE + 0.05])
            slab_center = ridge + down * slope_length * 0.5
            self.box(slab_center, (slope_length, roof_depth, 0.1), WOOD_DARK * 1.2, rotation)
            rows = 14
            for row in range(rows):
                distance_from_ridge = slope_length - (row + 0.5) * slope_length / rows
                y = y_front
                while y < y_back - 0.05:
                    width = min(rng.uniform(0.3, 0.42), y_back - y)
                    lift = Matrix.Rotation(side * (angle - 0.05), 3, "Y")
                    center = ridge + down * distance_from_ridge + normal * (0.07 + rng.uniform(0, 0.012))
                    center[1] = y + width * 0.5
                    tone = rng.uniform(0.75, 1.25)
                    color = ROOF * tone
                    if rng.random() < 0.08:
                        color = color * 0.6 + np.array([0.06, 0.08, 0.04]) * 0.4
                    self.box(center, (slope_length / rows + 0.08, width - 0.015, 0.03), color, lift)
                    y += width
            for y_edge in (y_front, y_back):
                board_center = ridge + down * slope_length * 0.5 + normal * 0.02
                board_center[1] = y_edge
                self.box(board_center, (slope_length + 0.1, 0.06, 0.24), TRIM * 0.95, rotation)
        self.box((0.0, 0.5 * (y_front + y_back), RIDGE + 0.17), (0.24, roof_depth + 0.06, 0.12), ROOF * 0.7)

    def chimney(self):
        rng = self.rng
        z = 3.6
        while z < 6.9:
            height = rng.uniform(0.24, 0.32)
            points, faces, _ = rounded_block_arrays(int(rng.integers(0, 1_000_000)), exponent=5.0, segments=3, lumpiness=0.04)
            grey = rng.uniform(0.2, 0.3)
            size = np.array([0.66 + rng.uniform(-0.03, 0.03), 0.66 + rng.uniform(-0.03, 0.03), height])
            self.stone.add(points * size + np.array([1.45, 1.05, z + height * 0.5]), faces, np.array([grey * 1.02, grey, grey * 0.95]))
            z += height
        self.box((1.45, 1.05, z + 0.04), (0.8, 0.8, 0.08), np.array([0.2, 0.2, 0.19]))

    def walls(self):
        front_openings = [(-0.48, 0.48, FLOOR, 2.6), (-1.95, -1.05, 1.45, 2.55), (1.05, 1.95, 1.45, 2.55),
                          (-0.42, 0.42, STOREY + 0.12, 5.05), (-1.75, -1.05, 3.6, 4.3), (1.05, 1.75, 3.6, 4.3)]
        side_openings = [(-0.5, 0.5, 1.45, 2.55)]
        back_openings = [(-0.5, 0.5, 1.45, 2.55), (-0.4, 0.4, 3.7, 4.5)]
        expanded = lambda openings: [(u0 - 0.08, u1 + 0.08, z0 - 0.08, z1 + 0.08) for u0, u1, z0, z1 in openings]
        self.siding("front", expanded(front_openings))
        self.siding("back", expanded(back_openings))
        self.siding("left", expanded(side_openings))
        self.siding("right", expanded(side_openings))

        self.door("front", -0.48, 0.48, FLOOR, 2.6)
        self.window("front", -1.95, -1.05, 1.45, 2.55, shutters=True, flower_box=True)
        self.window("front", 1.05, 1.95, 1.45, 2.55, shutters=True, flower_box=True)
        self.door("front", -0.42, 0.42, STOREY + 0.12, 5.05, glazed=True)
        self.window("front", -1.75, -1.05, 3.6, 4.3)
        self.window("front", 1.05, 1.75, 3.6, 4.3)
        for wall in ("left", "right"):
            self.window(wall, -0.5, 0.5, 1.45, 2.55, shutters=True)
        self.window("back", -0.5, 0.5, 1.45, 2.55)
        self.window("back", -0.4, 0.4, 3.7, 4.5)

        for x in (-HALF_WIDTH, HALF_WIDTH):
            for y in (-HALF_DEPTH, HALF_DEPTH):
                self.box((x + np.sign(x) * 0.03, y + np.sign(y) * 0.03, 0.5 * (FLOOR + 4.1)), (0.13, 0.13, 4.1 - FLOOR), TRIM)
        for wall in ("front", "back"):
            self.wall_box(wall, 0.0, STOREY + 0.01, 2 * HALF_WIDTH + 0.1, 0.12, 0.05, 0.05, TRIM)
        for wall in ("left", "right"):
            self.wall_box(wall, 0.0, STOREY + 0.01, 2 * HALF_DEPTH + 0.1, 0.12, 0.05, 0.05, TRIM)
        self.lantern((-0.82, -HALF_DEPTH - 0.12, 2.05))
        self.lantern((0.82, -HALF_DEPTH - 0.12, 2.05))
        # Solid core so gaps between planks never show daylight.
        self.box((0.0, 0.0, 0.5 * (FLOOR + 4.1)), (2 * HALF_WIDTH - 0.12, 2 * HALF_DEPTH - 0.12, 4.1 - FLOOR), WOOD_DARK * 0.6)

    def gable_core(self):
        for y in (-HALF_DEPTH + 0.08, HALF_DEPTH - 0.08):
            vertices = np.array([(-HALF_WIDTH + 0.02, y, 4.1), (HALF_WIDTH - 0.02, y, 4.1), (0.0, y, RIDGE - 0.02)])
            self.body.add(vertices, [[0, 1, 2]], WOOD_DARK * 0.6)
            self.body.add(vertices, [[0, 2, 1]], WOOD_DARK * 0.6)

    def build(self):
        self.plinth()
        self.walls()
        self.gable_core()
        self.porch()
        self.roof()
        self.chimney()
        materials = [
            make_material("cabin_body", roughness=0.78),
            make_material("window_glow", base_color=(0.02, 0.022, 0.025, 1.0), roughness=0.06, vertex_color=False,
                          emission_color=(1.0, 0.62, 0.3, 1.0), emission_strength=0.0),
            make_material("lamp_glow", base_color=(0.6, 0.45, 0.25, 1.0), roughness=0.4, vertex_color=False,
                          emission_color=(1.0, 0.6, 0.28, 1.0), emission_strength=0.0),
        ]
        vertices, faces, colors, _, _, material_indices = self.body.arrays()
        body = build_mesh_object("cabin_body", vertices, faces, colors=colors, materials=materials,
                                 material_indices=material_indices, smooth=False)
        stone_vertices, stone_faces, stone_colors, _, _, _ = self.stone.arrays()
        stone = build_mesh_object("cabin_stone", stone_vertices, stone_faces, colors=stone_colors,
                                  materials=[make_material("cabin_stone", roughness=0.85)], smooth=True)
        return [body, stone]


def build_cabin():
    return Cabin().build()
