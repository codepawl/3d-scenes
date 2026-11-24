"""Scene layout shared by every asset and by the web app.

All coordinates here are three.js world coordinates: x to the right, y up, z toward the
viewer. The creek flows out of a stone culvert at z = -36 and runs toward +z. The path
parameter s is arc length measured from the downstream end, so s grows upstream.
"""

import math
import random

import numpy as np
from mathutils import Quaternion, Vector, kdtree, noise

from .meshkit import smoothstep

CULVERT_Z = -36.0
CREEK_CONTROL_POINTS = [
    (24.0, 79.0), (15.5, 74.5), (7.8, 67.5), (2.6, 58.5), (-0.2, 48.5), (0.5, 38.0),
    (1.7, 28.0), (0.9, 18.0), (-0.7, 8.0), (-1.6, -2.0), (-0.9, -12.0), (0.5, -21.0),
    (0.35, -29.0), (0.0, -36.0), (0.0, -44.0), (0.0, -54.0),
]
PATH_SPACING = 0.05
WATER_GRADE = 1.0 / 95.0
# Small cascades: (z position, drop in metres). Water below a step sits lower by the drop.
CASCADES = [(-31.0, 0.15), (19.0, 0.07)]

TERRAIN_SPACING = 0.4
TERRAIN_X = (-34.0, 34.0)
TERRAIN_Z = (-84.0, 84.0)

CABIN_POSITION = (3.9, -50.8)
CABIN_YAW_DEGREES = -20.0
CABIN_FLOOR_HEIGHT = 4.05


def _noise1(value, seed):
    return noise.noise(Vector((value, seed * 13.7, seed * 3.1)))


def _fbm2(x, z, octaves=3, seed=0.0):
    total = 0.0
    amplitude = 1.0
    frequency = 1.0
    norm = 0.0
    for _ in range(octaves):
        total += amplitude * noise.noise(Vector((x * frequency + seed, z * frequency - seed, seed * 0.37)))
        norm += amplitude
        amplitude *= 0.5
        frequency *= 2.03
    return total / norm


def _catmull_rom(points, steps_per_segment=24):
    points = np.asarray(points, dtype=np.float64)
    padded = np.vstack([2 * points[0] - points[1], points, 2 * points[-1] - points[-2]])
    result = []
    for index in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[index - 1], padded[index], padded[index + 1], padded[index + 2]
        for step in range(steps_per_segment):
            t = step / steps_per_segment
            t2 = t * t
            t3 = t2 * t
            result.append(
                0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            )
    result.append(points[-1])
    return np.array(result)


class Creek:
    """Dense creek centreline with water level, width, depth and wall layout along s."""

    def __init__(self):
        rough = _catmull_rom(CREEK_CONTROL_POINTS)
        segment_lengths = np.linalg.norm(np.diff(rough, axis=0), axis=1)
        rough_s = np.concatenate([[0.0], np.cumsum(segment_lengths)])
        self.length = float(rough_s[-1])
        self.s = np.arange(0.0, self.length, PATH_SPACING)
        self.x = np.interp(self.s, rough_s, rough[:, 0])
        self.z = np.interp(self.s, rough_s, rough[:, 1])
        tangent = np.gradient(np.stack([self.x, self.z], axis=1), axis=0)
        tangent /= np.linalg.norm(tangent, axis=1, keepdims=True)
        self.tangent = tangent
        self.normal = np.stack([-tangent[:, 1], tangent[:, 0]], axis=1)
        self.tree = kdtree.KDTree(len(self.s))
        for index in range(len(self.s)):
            self.tree.insert((self.x[index], self.z[index], 0.0), index)
        self.tree.balance()
        self.culvert_s = self.s_at_z(CULVERT_Z)
        self.cascade_s = [(self.s_at_z(z), drop) for z, drop in CASCADES]

        # Per-sample profiles, evaluated once and interpolated for every query.
        s = self.s
        upstream_gap = self.culvert_s - s
        pool = np.exp(-(((self.z - 41.0) / 5.5) ** 2))
        half_width = 1.95 + 0.32 * np.sin(s * 0.13 + 1.0) + 0.18 * np.sin(s * 0.31 + 0.4) + 0.65 * pool
        culvert_taper = smoothstep(9.0, 0.5, upstream_gap)
        half_width = half_width * (1 - culvert_taper) + 1.22 * culvert_taper
        half_width = np.where(s > self.culvert_s, 1.15, half_width)
        self.half_width_samples = half_width

        depth = 0.29 + 0.06 * np.sin(s * 0.21) + 0.04 * np.sin(s * 0.57 + 2.0) + 0.16 * pool
        for cascade_s, _ in self.cascade_s:
            plunge = np.exp(-(((s - (cascade_s - 1.6)) / 1.4) ** 2))
            depth += 0.08 * plunge
        depth = depth * (1 - culvert_taper) + 0.26 * culvert_taper
        self.depth_samples = depth

        self.water_samples = self.water_level(s)

    # ----- queries along s -------------------------------------------------
    def s_at_z(self, z_value):
        # z decreases monotonically along the path, so interpolate on the reversed arrays.
        return float(np.interp(z_value, self.z[::-1], self.s[::-1]))

    def water_level(self, s):
        s = np.asarray(s, dtype=np.float64)
        level = -WATER_GRADE * (self.culvert_s - s)
        for cascade_s, drop in self.cascade_s:
            level = level - drop * (1.0 - smoothstep(cascade_s - 0.35, cascade_s + 0.35, s))
        return level

    def sample(self, values, s):
        return np.interp(s, self.s, values)

    def half_width(self, s):
        return self.sample(self.half_width_samples, s)

    def depth(self, s):
        return self.sample(self.depth_samples, s)

    def point(self, s, lateral):
        x = self.sample(self.x, s)
        z = self.sample(self.z, s)
        nx = self.sample(self.normal[:, 0], s)
        nz = self.sample(self.normal[:, 1], s)
        return x + nx * lateral, z + nz * lateral

    def tangent_at(self, s):
        tx = self.sample(self.tangent[:, 0], s)
        tz = self.sample(self.tangent[:, 1], s)
        length = math.hypot(tx, tz)
        return tx / length, tz / length

    def nearest(self, xs, zs):
        """Path parameter and signed lateral distance for arrays of points."""
        xs = np.asarray(xs, dtype=np.float64).ravel()
        zs = np.asarray(zs, dtype=np.float64).ravel()
        s_out = np.empty(len(xs))
        lateral = np.empty(len(xs))
        for index in range(len(xs)):
            _, sample_index, _ = self.tree.find((xs[index], zs[index], 0.0))
            dx = xs[index] - self.x[sample_index]
            dz = zs[index] - self.z[sample_index]
            s_out[index] = self.s[sample_index] + dx * self.tangent[sample_index, 0] + dz * self.tangent[sample_index, 1]
            lateral[index] = dx * self.normal[sample_index, 0] + dz * self.normal[sample_index, 1]
        return s_out, lateral

    # ----- walls and banks -------------------------------------------------
    def wall_presence(self, s, lateral):
        """1 where a dry-stone retaining wall lines the bank on that side."""
        s = np.asarray(s, dtype=np.float64)
        z = self.sample(self.z, s)
        side_positive = np.asarray(lateral) > 0
        right_ranges = [(-37.0, -12.0), (-4.0, 21.0), (27.0, 31.0)]
        left_ranges = [(-37.0, -19.0), (-9.0, -1.0), (9.0, 30.0)]
        presence = np.zeros_like(s)
        for ranges, mask in ((right_ranges, side_positive), (left_ranges, ~side_positive)):
            side_presence = np.zeros_like(s)
            for z0, z1 in ranges:
                side_presence = np.maximum(side_presence, smoothstep(z0 - 0.8, z0 + 0.4, z) * smoothstep(z1 + 0.8, z1 - 0.4, z))
            presence = np.where(mask, side_presence, presence)
        return presence

    def bank_width(self, s, lateral):
        side = np.sign(lateral)
        return 3.1 + 0.6 * np.sin(s * 0.11 + side * 1.7) + 0.3 * np.sin(s * 0.37 + side)


def plateau(x, z, center, radii, height, falloff):
    distance = np.sqrt(((x - center[0]) / radii[0]) ** 2 + ((z - center[1]) / radii[1]) ** 2)
    return height * (1.0 - smoothstep(1.0, 1.0 + falloff, distance))


def smooth_max(a, b, k=0.6):
    h = np.clip(0.5 + 0.5 * (a - b) / k, 0.0, 1.0)
    return b * (1 - h) + a * h + k * h * (1 - h)


class Terrain:
    """Carved heightfield on a regular grid plus masks used by shaders and scattering."""

    def __init__(self, creek):
        self.creek = creek
        self.xs = np.arange(TERRAIN_X[0], TERRAIN_X[1] + 1e-6, TERRAIN_SPACING)
        self.zs = np.arange(TERRAIN_Z[0], TERRAIN_Z[1] + 1e-6, TERRAIN_SPACING)
        grid_x, grid_z = np.meshgrid(self.xs, self.zs)
        self.grid_x = grid_x
        self.grid_z = grid_z
        s, lateral = creek.nearest(grid_x, grid_z)
        self.s = s.reshape(grid_x.shape)
        self.lateral = lateral.reshape(grid_x.shape)
        self.height, self.masks = self._evaluate(grid_x, grid_z, self.s, self.lateral)
        self.water = creek.water_level(np.minimum(self.s, creek.length))

    def meadow(self, x, z):
        x = np.asarray(x, dtype=np.float64)
        z = np.asarray(z, dtype=np.float64)
        flat_x = x.ravel()
        flat_z = z.ravel()
        values = np.array([
            0.36 * _fbm2(px * 0.045, pz * 0.045, 3, 3.0) + 0.12 * _fbm2(px * 0.16, pz * 0.16, 2, 9.0)
            for px, pz in zip(flat_x, flat_z)
        ]).reshape(x.shape)
        height = 2.1 + values
        embankment = plateau(x, z, (0.4, -42.5), (10.5, 6.2), 2.78, 0.45)
        cabin_hill = plateau(x, z, CABIN_POSITION, (7.2, 6.4), CABIN_FLOOR_HEIGHT, 0.75)
        height = smooth_max(height, embankment, 0.5)
        height = smooth_max(height, cabin_hill, 0.5)
        return height

    def _evaluate(self, x, z, s, lateral):
        creek = self.creek
        s_clamped = np.clip(s, 0.0, creek.length)
        water = creek.water_level(s_clamped)
        half_width = creek.half_width(s_clamped)
        depth = creek.depth(s_clamped)
        meadow = self.meadow(x, z)
        valley = 0.006 * np.maximum(np.abs(lateral) - 11.0, 0.0) ** 1.5
        meadow = meadow + valley
        meadow = np.maximum(meadow, water + 1.35)

        outside = np.abs(lateral) - half_width
        bank_width = creek.bank_width(s_clamped, lateral)
        wall = creek.wall_presence(s_clamped, lateral)
        wall_top = water + 0.44

        t = np.clip(np.abs(lateral) / half_width, 0.0, 1.0)
        bed = water - 0.05 - (depth - 0.05) * (1.0 - t ** 2.2) ** 0.9
        bed_texture = 0.025 * np.sin(x * 2.1 + z * 1.3) * np.sin(z * 1.7 - x * 0.9)
        bed = bed + bed_texture * (1 - t)

        # Behind a wall the bank rises sharply; the rise sits 0.3 m back so the coarse grid
        # smears it behind the wall stones instead of in front of them.
        walled = np.where(
            outside < 0.42,
            (water - 0.09) + (wall_top - water + 0.09) * smoothstep(0.3, 0.42, outside),
            np.where(
                outside < 1.1,
                wall_top + 0.03 * (outside - 0.42),
                wall_top + (meadow - wall_top) * smoothstep(0.0, 1.0, (outside - 1.1) / bank_width),
            ),
        )
        beach_top = water + 0.16
        natural = np.where(
            outside < 0.7,
            (water - 0.05) + 0.21 * smoothstep(0.0, 0.7, outside),
            beach_top + (meadow - beach_top) * smoothstep(0.0, 1.0, (outside - 0.7) / bank_width),
        )
        bank = natural * (1 - wall) + walled * wall
        channel_height = np.where(outside < 0.0, bed, bank)

        carve = smoothstep(CULVERT_Z - 0.35, CULVERT_Z + 0.25, z)
        height = meadow * (1 - carve) + channel_height * carve

        bed_mask = (1.0 - smoothstep(-0.06, 0.06, outside)) * carve
        grass_natural = smoothstep(0.75, 1.25, outside)
        grass_walled = smoothstep(0.38, 0.55, outside)
        grass = (grass_natural * (1 - wall) + grass_walled * wall) * carve + (1 - carve)
        dirt = (1.0 - grass_natural) * (1 - wall) * (1 - bed_mask) * carve
        masks = np.stack([grass, bed_mask, dirt], axis=-1)
        return height, masks

    def height_at(self, x, z):
        """Bilinear sample of the grid height (matches the exported field)."""
        fx = (np.asarray(x) - TERRAIN_X[0]) / TERRAIN_SPACING
        fz = (np.asarray(z) - TERRAIN_Z[0]) / TERRAIN_SPACING
        ix = np.clip(np.floor(fx).astype(int), 0, len(self.xs) - 2)
        iz = np.clip(np.floor(fz).astype(int), 0, len(self.zs) - 2)
        tx = np.clip(fx - ix, 0, 1)
        tz = np.clip(fz - iz, 0, 1)
        h = self.height
        top = h[iz, ix] * (1 - tx) + h[iz, ix + 1] * tx
        bottom = h[iz + 1, ix] * (1 - tx) + h[iz + 1, ix + 1] * tx
        return top * (1 - tz) + bottom * tz

    def normal_at(self, x, z):
        step = 0.3
        dx = self.height_at(x + step, z) - self.height_at(x - step, z)
        dz = self.height_at(x, z + step) - self.height_at(x, z - step)
        normal = np.array([-dx, 2 * step, -dz], dtype=np.float64)
        return normal / np.linalg.norm(normal)

    def min_height_under(self, x, z, radius):
        heights = [self.height_at(x, z)]
        for angle in np.linspace(0, 2 * math.pi, 9)[:-1]:
            heights.append(self.height_at(x + math.cos(angle) * radius, z + math.sin(angle) * radius))
        return float(min(heights))

    def ambient_occlusion(self):
        """Horizon-based occlusion of the heightfield, 1 = open sky."""
        height = self.height
        rows, columns = height.shape
        padded = np.pad(height, 24, mode="edge")
        occlusion = np.zeros_like(height)
        directions = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)]
        for dx, dz in directions:
            max_slope = np.full_like(height, -1.0)
            for steps in (1, 2, 4, 7, 11, 16, 23):
                shifted = padded[24 + dz * steps: 24 + dz * steps + rows, 24 + dx * steps: 24 + dx * steps + columns]
                distance = steps * TERRAIN_SPACING * math.hypot(dx, dz)
                max_slope = np.maximum(max_slope, (shifted - height) / distance)
            occlusion += np.clip(np.sin(np.arctan(max_slope)), 0.0, 1.0)
        return 1.0 - occlusion / len(directions)


def _quaternion_from(yaw, tilt_axis=None, tilt_angle=0.0):
    rotation = Quaternion((0.0, 1.0, 0.0), yaw)
    if tilt_axis is not None and tilt_angle > 1e-5:
        rotation = Quaternion(tilt_axis, tilt_angle) @ rotation
    return rotation


def _instance_row(position, rotation, scale, color):
    return [
        round(float(position[0]), 3), round(float(position[1]), 3), round(float(position[2]), 3),
        round(rotation.x, 4), round(rotation.y, 4), round(rotation.z, 4), round(rotation.w, 4),
        round(float(scale[0]), 3), round(float(scale[1]), 3), round(float(scale[2]), 3),
        round(float(color[0]), 3), round(float(color[1]), 3), round(float(color[2]), 3),
    ]


class Placements:
    """Scatter stones, walls, pebbles, trees and bushes; keep footprints for contact shading."""

    STONE_VARIANTS = 8
    WALL_VARIANTS = 6
    PEBBLE_VARIANTS = 4

    def __init__(self, creek, terrain, seed=11):
        self.creek = creek
        self.terrain = terrain
        self.rng = random.Random(seed)
        self.instances = {}
        self.footprints = []  # (x, z, radius, strength) for terrain contact darkening
        self.blockers = []  # (x, z, radius) used to keep other props apart
        self._channel_stones()
        self._grey_boulders()
        self._bank_stones()
        self._walls()
        self._pebbles()
        self._trees()
        self._bushes()

    def _add(self, name, position, rotation, scale, color):
        self.instances.setdefault(name, []).append(_instance_row(position, rotation, scale, color))

    def _free(self, x, z, radius, padding=0.0):
        for bx, bz, br in self.blockers:
            if (x - bx) ** 2 + (z - bz) ** 2 < (radius + br + padding) ** 2:
                return False
        return True

    def _stone_color(self, grey=False):
        rng = self.rng
        if grey:
            value = rng.uniform(0.17, 0.27)
            return (value * rng.uniform(0.95, 1.02), value, value * rng.uniform(1.0, 1.1))
        warmth = rng.uniform(0.0, 1.0)
        base = rng.uniform(0.62, 0.78)
        return (base, base * (0.9 - 0.04 * warmth), base * (0.72 - 0.08 * warmth))

    def _channel_stones(self):
        creek = self.creek
        rng = self.rng
        s_start = creek.s_at_z(45.5)
        s_end = creek.s_at_z(-33.6)
        placed = 0
        attempts = 0
        while placed < 150 and attempts < 12000:
            attempts += 1
            s = rng.uniform(s_start, s_end)
            half_width = float(creek.half_width(s))
            radius = 0.2 + 0.52 * rng.random() ** 1.5
            lateral = rng.uniform(-half_width + radius * 0.5, half_width - radius * 0.5)
            x, z = creek.point(s, lateral)
            if not self._free(x, z, radius * 0.8, 0.0):
                continue
            water = float(creek.water_level(s))
            bed = self.terrain.min_height_under(x, z, radius * 0.75)
            bottom = bed - 0.05
            height = radius * rng.uniform(0.58, 0.92)
            protrusion = bottom + height - water
            if protrusion > 0.34:
                height -= protrusion - 0.34
            self._place_stone(x, bottom, z, radius, height, tilt=rng.uniform(0, 0.08))
            self.blockers.append((x, z, radius * 0.86))
            placed += 1

    def _grey_boulders(self):
        creek = self.creek
        rng = self.rng
        spots = [(43.6, -1.9, 1.05), (41.2, 2.3, 0.95), (39.0, -2.6, 0.8), (36.2, 2.1, 0.72), (46.4, 1.0, 0.9), (30.5, -2.3, 0.7)]
        for z_target, lateral, radius in spots:
            s = creek.s_at_z(z_target)
            x, z = creek.point(s, lateral)
            bottom = self.terrain.min_height_under(x, z, radius * 0.8) - 0.12
            height = radius * rng.uniform(0.75, 0.95)
            self._place_stone(x, bottom, z, radius, height, tilt=rng.uniform(0.02, 0.1), grey=True)
            self.blockers.append((x, z, radius * 0.9))

    def _bank_stones(self):
        creek = self.creek
        rng = self.rng
        s_start = creek.s_at_z(47.0)
        s_end = creek.s_at_z(-34.5)
        placed = 0
        attempts = 0
        while placed < 140 and attempts < 12000:
            attempts += 1
            s = rng.uniform(s_start, s_end)
            side = rng.choice((-1.0, 1.0))
            half_width = float(creek.half_width(s))
            bank_width = float(creek.bank_width(s, side))
            outside = rng.uniform(0.15, bank_width + 1.6) ** 1.0
            radius = 0.3 + 0.5 * rng.random() ** 1.5
            lateral = side * (half_width + outside + radius * 0.3)
            x, z = creek.point(s, lateral)
            if not self._free(x, z, radius * 0.85, 0.0):
                continue
            count = 1 + (rng.random() < 0.45) + (rng.random() < 0.2)
            for member in range(count):
                if member > 0:
                    angle = rng.uniform(0, 2 * math.pi)
                    radius = radius * rng.uniform(0.55, 0.85)
                    x += math.cos(angle) * radius * 1.25
                    z += math.sin(angle) * radius * 1.25
                    if not self._free(x, z, radius * 0.7, -0.05):
                        continue
                bottom = self.terrain.min_height_under(x, z, radius * 0.85) - 0.07
                height = radius * rng.uniform(0.55, 0.85)
                self._place_stone(x, bottom, z, radius, height, tilt=0.0, slope_follow=0.45, grey=rng.random() < 0.08)
                self.blockers.append((x, z, radius * 0.85))
                placed += 1

    def _place_stone(self, x, bottom, z, radius, height, tilt=0.0, slope_follow=0.0, grey=False):
        rng = self.rng
        variant = rng.randrange(self.STONE_VARIANTS)
        yaw = rng.uniform(0, 2 * math.pi)
        tilt_axis = None
        tilt_angle = 0.0
        if slope_follow > 0:
            normal = self.terrain.normal_at(x, z)
            axis = Vector((0.0, 1.0, 0.0)).cross(Vector(normal))
            if axis.length > 1e-4:
                tilt_axis = axis.normalized()
                tilt_angle = math.acos(max(-1.0, min(1.0, normal[1]))) * slope_follow
        elif tilt > 0:
            angle = rng.uniform(0, 2 * math.pi)
            tilt_axis = Vector((math.cos(angle), 0.0, math.sin(angle)))
            tilt_angle = tilt
        rotation = _quaternion_from(yaw, tilt_axis, tilt_angle)
        depth_ratio = rng.uniform(0.78, 1.0)
        self._add(
            f"stone_{variant}",
            (x, bottom, z),
            rotation,
            (radius, height, radius * depth_ratio),
            self._stone_color(grey),
        )
        self.footprints.append((x, z, radius * 1.05, 0.55))

    def _walls(self):
        creek = self.creek
        rng = self.rng
        s_start = creek.s_at_z(47.0)
        s_end = creek.culvert_s - 0.45
        for side in (-1.0, 1.0):
            for course in range(4):
                s = s_start + (0.12 if course % 2 else 0.0)
                while s < s_end:
                    length = rng.uniform(0.19, 0.36)
                    center_s = s + length * 0.5
                    s += length + rng.uniform(0.0, 0.025)
                    presence = float(creek.wall_presence(np.array([center_s]), np.array([side]))[0])
                    if presence < 0.5:
                        continue
                    half_width = float(creek.half_width(center_s))
                    water = float(creek.water_level(center_s))
                    depth = rng.uniform(0.24, 0.36)
                    course_height = rng.uniform(0.115, 0.165)
                    base = water - 0.2
                    center_y = base + course * 0.155 + course_height * 0.5 + rng.uniform(-0.015, 0.015)
                    lateral = side * (half_width + depth * 0.5 - 0.05 + rng.uniform(-0.035, 0.035) + course * 0.015)
                    x, z = creek.point(center_s, lateral)
                    tx, tz = creek.tangent_at(center_s)
                    yaw = math.atan2(-tz, tx) + rng.uniform(-0.25, 0.25)
                    tilt_axis = Vector((tx, 0.0, tz))
                    rotation = _quaternion_from(yaw, tilt_axis, rng.uniform(-0.12, 0.12))
                    grey = rng.uniform(0.2, 0.34)
                    color = (grey * rng.uniform(0.95, 1.08), grey * rng.uniform(0.95, 1.03), grey * rng.uniform(0.9, 1.05))
                    variant = rng.randrange(self.WALL_VARIANTS)
                    self._add(f"wallstone_{variant}", (x, center_y, z), rotation, (length, course_height, depth), color)
                    if course == 0:
                        self.footprints.append((x, z, 0.32, 0.15))
                        self._toe_stone(center_s, side, half_width, water)

    def _toe_stone(self, s, side, half_width, water):
        """Low submerged stone in front of the wall base, hiding the bank ramp under water."""
        rng = self.rng
        length = rng.uniform(0.26, 0.48)
        depth = rng.uniform(0.3, 0.44)
        height = rng.uniform(0.11, 0.17)
        lateral = side * (half_width - depth * 0.32 + rng.uniform(-0.04, 0.04))
        x, z = self.creek.point(s, lateral)
        ground = float(self.terrain.height_at(x, z))
        center_y = min(ground + height * 0.18, water - height * 0.45)
        tx, tz = self.creek.tangent_at(s)
        yaw = math.atan2(-tz, tx) + rng.uniform(-0.35, 0.35)
        rotation = _quaternion_from(yaw, Vector((tx, 0.0, tz)), rng.uniform(-0.1, 0.1))
        grey = rng.uniform(0.17, 0.27)
        color = (grey * 0.92, grey * 1.02, grey * 0.88)
        self._add(f"wallstone_{rng.randrange(self.WALL_VARIANTS)}", (x, center_y, z), rotation, (length, height, depth), color)

    def _pebbles(self):
        creek = self.creek
        rng = self.rng
        s_start = creek.s_at_z(47.0)
        s_end = creek.culvert_s - 0.5
        for _ in range(2300):
            s = rng.uniform(s_start, s_end)
            half_width = float(creek.half_width(s))
            beach = rng.random() < 0.18
            if beach:
                side = rng.choice((-1.0, 1.0))
                if float(creek.wall_presence(np.array([s]), np.array([side]))[0]) > 0.3:
                    continue
                lateral = side * (half_width + rng.uniform(-0.25, 0.65))
                radius = rng.uniform(0.07, 0.17)
            else:
                lateral = rng.uniform(-half_width, half_width)
                radius = rng.uniform(0.045, 0.13)
            x, z = creek.point(s, lateral)
            if not self._free(x, z, radius * 0.5, -0.05):
                continue
            ground = float(self.terrain.height_at(x, z))
            yaw = rng.uniform(0, 2 * math.pi)
            rotation = _quaternion_from(yaw, Vector((1.0, 0.0, 0.0)), rng.uniform(-0.15, 0.15))
            flat = rng.uniform(0.45, 0.75)
            tone = rng.uniform(0.3, 0.62)
            hue = rng.random()
            if hue < 0.5:
                color = (tone * 0.95, tone, tone * 0.86)
            elif hue < 0.8:
                color = (tone, tone * 0.93, tone * 0.8)
            else:
                color = (tone * 0.8, tone * 0.86, tone * 0.84)
            position = (x, ground - radius * flat * 0.35, z)
            self._add(f"pebble_{rng.randrange(self.PEBBLE_VARIANTS)}", position, rotation, (radius, radius * flat, radius * rng.uniform(0.7, 1.0)), color)

    def _trees(self):
        creek = self.creek
        rng = self.rng
        trees = []
        attempts = 0
        while len(trees) < 130 and attempts < 24000:
            attempts += 1
            x = rng.uniform(TERRAIN_X[0] + 1.0, TERRAIN_X[1] - 1.0)
            z = rng.uniform(-80.0, 70.0)
            s_values, lateral_values = creek.nearest([x], [z])
            s = float(np.clip(s_values[0], 0, creek.length))
            lateral = float(lateral_values[0])
            outside = abs(lateral) - float(creek.half_width(s)) - float(creek.bank_width(s, lateral))
            if z > CULVERT_Z - 1.0 and outside < -0.8:
                continue
            if (x - CABIN_POSITION[0]) ** 2 + (z - CABIN_POSITION[1]) ** 2 < 8.0 ** 2:
                continue
            if abs(x - 0.4) < 7.5 and CULVERT_Z - 8.5 < z < CULVERT_Z + 1.0:
                continue
            distance_from_creek = max(outside, 0.0)
            keep = 0.95 * math.exp(-distance_from_creek / 9.0) + 0.12
            if rng.random() > keep:
                continue
            if any((x - tx) ** 2 + (z - tz) ** 2 < 3.4 ** 2 for tx, tz, _ in trees):
                continue
            trees.append((x, z, rng.random()))
        for x, z, roll in trees:
            variant = 0 if roll < 0.42 else (1 if roll < 0.74 else 2)
            ground = self.terrain.min_height_under(x, z, 0.35) - 0.05
            scale = self.rng.uniform(0.85, 1.18)
            rotation = _quaternion_from(self.rng.uniform(0, 2 * math.pi))
            tint = self.rng.uniform(0.88, 1.08)
            self._add(f"tree_{variant}", (x, ground, z), rotation, (scale, scale * self.rng.uniform(0.92, 1.1), scale), (tint, tint, tint))
            self.blockers.append((x, z, 0.6))
            self.footprints.append((x, z, 1.4, 0.25))

        # Hero trees lean a long branch over the water; one frames the default view at z = -6.
        for hero_z_target, swing, scale in ((31.5, -0.3, 1.0), (-16.5, -0.35, 1.08)):
            hero_s = creek.s_at_z(hero_z_target)
            hero_x, hero_z = creek.point(hero_s, -(float(creek.half_width(hero_s)) + 1.7))
            ground = self.terrain.min_height_under(hero_x, hero_z, 0.5) - 0.1
            tx, tz = creek.tangent_at(hero_s)
            # The tree sits on the negative-lateral bank, so the creek lies along +normal.
            # Its long branch grows along local +x; point that across the water.
            towards_creek = (-tz, tx)
            yaw = math.atan2(-towards_creek[1], towards_creek[0]) + swing
            self._add("tree_3", (hero_x, ground, hero_z), _quaternion_from(yaw), (scale, scale, scale), (1.0, 1.0, 1.0))
            self.footprints.append((hero_x, hero_z, 1.8, 0.35))
            self.blockers.append((hero_x, hero_z, 1.0))

    def _bushes(self):
        creek = self.creek
        rng = self.rng
        s_start = creek.s_at_z(48.0)
        s_end = creek.s_at_z(-34.0)
        placed = 0
        attempts = 0
        while placed < 85 and attempts < 8000:
            attempts += 1
            s = rng.uniform(s_start, s_end)
            side = rng.choice((-1.0, 1.0))
            half_width = float(creek.half_width(s))
            bank_width = float(creek.bank_width(s, side))
            outside = rng.uniform(0.5, bank_width + 2.5)
            lateral = side * (half_width + outside)
            x, z = creek.point(s, lateral)
            scale = rng.uniform(0.7, 1.35)
            if not self._free(x, z, 0.5 * scale, 0.1):
                continue
            ground = self.terrain.min_height_under(x, z, 0.3 * scale) - 0.05
            rotation = _quaternion_from(rng.uniform(0, 2 * math.pi))
            tint = rng.uniform(0.85, 1.1)
            self._add(f"bush_{rng.randrange(2)}", (x, ground, z), rotation, (scale, scale * rng.uniform(0.85, 1.15), scale), (tint, tint, tint))
            self.blockers.append((x, z, 0.45 * scale))
            self.footprints.append((x, z, 0.8 * scale, 0.3))
            placed += 1
