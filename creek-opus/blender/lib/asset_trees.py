"""Trees and bushes: tube trunks and branches with clustered leaf cards on a painted atlas.

Local Blender coordinates, Z up, trunk base at the origin.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector, noise

from .meshkit import build_mesh_object, make_material, smoothstep
from .shapes import MeshBuilder, tube_arrays

ATLAS_SIZE = 1024
TILE = ATLAS_SIZE // 2
GOLDEN_ANGLE = math.pi * (3.0 - math.sqrt(5.0))


# ----- leaf atlas ---------------------------------------------------------

def _composite(canvas, x0, y0, color_patch, alpha_patch):
    region = canvas[y0:y0 + alpha_patch.shape[0], x0:x0 + alpha_patch.shape[1]]
    alpha = alpha_patch[..., None]
    region[..., :3] = color_patch * alpha + region[..., :3] * (1.0 - alpha)
    region[..., 3] = alpha_patch + region[..., 3] * (1.0 - alpha_patch)


def _draw_leaf(canvas, center, angle, length, width, color, rng):
    half = length * 0.5
    reach = int(half + 3)
    cx, cy = center
    x0 = max(int(cx - reach), 0)
    y0 = max(int(cy - reach), 0)
    x1 = min(int(cx + reach) + 1, canvas.shape[1])
    y1 = min(int(cy + reach) + 1, canvas.shape[0])
    if x1 <= x0 or y1 <= y0:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float64) + 0.5
    dx = xs - cx
    dy = ys - cy
    cos_a = math.cos(angle)
    sin_a = math.sin(angle)
    along = (dx * cos_a + dy * sin_a) / half
    across = (-dx * sin_a + dy * cos_a) / (width * 0.5)
    profile = np.clip(1.0 - along ** 2, 0.0, 1.0) ** 0.62 * (1.0 + 0.18 * along * (along < 0))
    inside = profile - np.abs(across)
    alpha = np.clip(inside * width * 0.5 + 0.5, 0.0, 1.0)
    alpha *= (along > -1.0) & (along < 1.0)
    if not alpha.any():
        return
    centre_light = 0.8 + 0.2 * (1.0 - np.clip(np.abs(across), 0, 1))
    midrib = np.clip(1.0 - np.abs(across) * width * 0.5 / 0.9, 0.0, 1.0) * (along < 0.85)
    veins = np.sin((along * 5.5 - np.abs(across) * 2.2) * math.pi)
    vein_light = 1.0 + 0.05 * veins * (np.abs(across) < 0.85)
    side_tone = np.where(across > 0, 1.0, 0.9 + 0.05 * rng.random())
    shade = (centre_light * vein_light * side_tone)[..., None]
    patch = np.clip(np.asarray(color)[None, None, :] * shade + midrib[..., None] * 0.1, 0.0, 1.0)
    _composite(canvas, x0, y0, patch, alpha)


def _draw_line(canvas, start, end, thickness, color):
    sx, sy = start
    ex, ey = end
    x0 = max(int(min(sx, ex) - thickness - 2), 0)
    y0 = max(int(min(sy, ey) - thickness - 2), 0)
    x1 = min(int(max(sx, ex) + thickness + 2), canvas.shape[1])
    y1 = min(int(max(sy, ey) + thickness + 2), canvas.shape[0])
    if x1 <= x0 or y1 <= y0:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float64) + 0.5
    direction = np.array([ex - sx, ey - sy])
    length_squared = max(direction @ direction, 1e-6)
    t = np.clip(((xs - sx) * direction[0] + (ys - sy) * direction[1]) / length_squared, 0.0, 1.0)
    distance = np.hypot(xs - (sx + t * direction[0]), ys - (sy + t * direction[1]))
    alpha = np.clip(thickness * 0.5 - distance + 0.5, 0.0, 1.0)
    patch = np.broadcast_to(np.asarray(color), alpha.shape + (3,))
    _composite(canvas, x0, y0, patch, alpha)


def _leaf_color(rng, palette):
    base = np.array(palette[rng.integers(0, len(palette))])
    return np.clip(base * rng.uniform(0.82, 1.15) + rng.uniform(-0.03, 0.03, 3), 0, 1)


def _paint_twig(canvas, rng, palette, leaf_count, leaf_length, leaf_width, twig_color):
    """Alternate leaves along a gently curved twig from the bottom centre to the top."""
    base = np.array([TILE * 0.5, TILE * 0.04])
    tip = np.array([TILE * 0.5 + rng.uniform(-40, 40), TILE * 0.93])
    bend = rng.uniform(-60, 60)
    points = []
    for index in range(16):
        t = index / 15
        point = base + (tip - base) * t
        point[0] += bend * math.sin(math.pi * t)
        points.append(point)
    for start, end in zip(points[:-1], points[1:]):
        _draw_line(canvas, start, end, 5.0, twig_color)
    for index in range(leaf_count):
        t = 0.12 + 0.86 * index / max(leaf_count - 1, 1)
        anchor = points[min(int(t * 15), 15)]
        side = 1.0 if index % 2 == 0 else -1.0
        angle = math.pi * 0.5 + side * rng.uniform(0.6, 1.05) - (t - 0.5) * 0.2
        size = leaf_length * rng.uniform(0.75, 1.1) * (1.0 - 0.3 * abs(t - 0.55))
        stem_end = anchor + np.array([math.cos(angle), math.sin(angle)]) * size * 0.12
        _draw_line(canvas, anchor, stem_end, 2.5, twig_color)
        center = anchor + np.array([math.cos(angle), math.sin(angle)]) * size * 0.6
        _draw_leaf(canvas, center, angle, size, size * leaf_width, _leaf_color(rng, palette), rng)
    _draw_leaf(canvas, tip + np.array([0, 10]), math.pi * 0.5 + rng.uniform(-0.2, 0.2), leaf_length * 0.9,
               leaf_length * 0.9 * leaf_width, _leaf_color(rng, palette), rng)


def _paint_cluster(canvas, rng, palette, leaf_count, leaf_length, leaf_width, twig_color):
    centre = np.array([TILE * 0.5, TILE * 0.5])
    for index in range(leaf_count):
        angle = rng.uniform(0, 2 * math.pi)
        distance = TILE * 0.36 * math.sqrt(rng.random())
        position = centre + np.array([math.cos(angle), math.sin(angle)]) * distance
        _draw_line(canvas, centre + (position - centre) * 0.3, position, 3.0, twig_color)
        leaf_angle = angle + rng.uniform(-0.5, 0.5)
        size = leaf_length * rng.uniform(0.7, 1.1)
        _draw_leaf(canvas, position + np.array([math.cos(leaf_angle), math.sin(leaf_angle)]) * size * 0.35,
                   leaf_angle, size, size * leaf_width, _leaf_color(rng, palette), rng)


def _dilate(rgba, iterations=10):
    """Bleed leaf colour into transparent texels so mipmaps do not darken the edges."""
    color = rgba[..., :3] * (rgba[..., 3:] > 0.02)
    weight = (rgba[..., 3] > 0.02).astype(np.float64)
    for _ in range(iterations):
        summed = np.zeros_like(color)
        summed_weight = np.zeros_like(weight)
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            summed += np.roll(np.roll(color * weight[..., None], dx, axis=1), dy, axis=0)
            summed_weight += np.roll(np.roll(weight, dx, axis=1), dy, axis=0)
        empty = weight < 0.5
        fill = empty & (summed_weight > 0)
        color[fill] = summed[fill] / summed_weight[fill][:, None]
        weight = np.where(fill, 1.0, weight)
    result = rgba.copy()
    transparent = rgba[..., 3] <= 0.02
    result[transparent, :3] = color[transparent]
    return result


def build_leaf_atlas(path, seed=21):
    rng = np.random.default_rng(seed)
    atlas = np.zeros((ATLAS_SIZE, ATLAS_SIZE, 4), dtype=np.float64)
    tree_palette = [(0.27, 0.42, 0.11), (0.33, 0.5, 0.13), (0.2, 0.36, 0.09), (0.4, 0.55, 0.16), (0.24, 0.4, 0.14)]
    bright_palette = [(0.42, 0.58, 0.17), (0.5, 0.64, 0.2), (0.36, 0.52, 0.14), (0.55, 0.62, 0.22)]
    bush_palette = [(0.2, 0.38, 0.1), (0.27, 0.46, 0.12), (0.16, 0.31, 0.08), (0.33, 0.5, 0.15)]
    twig = (0.25, 0.19, 0.12)
    tiles = [
        lambda canvas: _paint_twig(canvas, rng, tree_palette, 15, 125, 0.48, twig),
        lambda canvas: _paint_cluster(canvas, rng, tree_palette, 30, 105, 0.5, twig),
        lambda canvas: _paint_cluster(canvas, rng, bush_palette, 46, 66, 0.62, twig),
        lambda canvas: _paint_twig(canvas, rng, bright_palette, 13, 135, 0.46, twig),
    ]
    for index, paint in enumerate(tiles):
        canvas = np.zeros((TILE, TILE, 4), dtype=np.float64)
        paint(canvas)
        row = index // 2
        column = index % 2
        atlas[row * TILE:(row + 1) * TILE, column * TILE:(column + 1) * TILE] = canvas
    atlas = _dilate(atlas)
    image = bpy.data.images.new("leaf_atlas", width=ATLAS_SIZE, height=ATLAS_SIZE, alpha=True)
    image.pixels.foreach_set(atlas.astype(np.float32).ravel())
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.filepath_raw = path
    image.file_format = "PNG"
    image.save()
    return image


def tile_rect(index):
    row = index // 2
    column = index % 2
    inset = 3.0 / ATLAS_SIZE
    return (column * 0.5 + inset, row * 0.5 + inset, column * 0.5 + 0.5 - inset, row * 0.5 + 0.5 - inset)


# ----- tree skeletons -----------------------------------------------------

def _random_unit(rng):
    vector = Vector(rng.normal(size=3))
    return vector.normalized() if vector.length > 1e-6 else Vector((0, 0, 1))


class TreeBuilder:
    def __init__(self, seed, bark_color, leaf_tiles):
        self.rng = np.random.default_rng(seed)
        self.noise_offset = Vector(self.rng.uniform(-100, 100, 3))
        self.bark = MeshBuilder()
        self.cards = []  # (center, normal, tangent, size, tile)
        self.bark_color = np.array(bark_color)
        self.leaf_tiles = leaf_tiles

    def tube(self, points, radii, sides, base_height=0.0):
        vertices, faces, uvs, ring_index = tube_arrays(points, radii, sides)
        heights = vertices[:, 2]
        moss = smoothstep(1.2, 0.0, heights) * 0.6
        streak = np.array([noise.noise(Vector(vertex) * 2.5 + self.noise_offset) for vertex in vertices])
        tone = (0.8 + 0.2 * streak)[:, None]
        base_dark = (0.6 + 0.4 * smoothstep(0.0, 1.0, heights))[:, None]
        colors = self.bark_color[None, :] * tone * base_dark
        colors = colors * (1 - moss[:, None]) + np.array([0.06, 0.09, 0.03])[None, :] * moss[:, None]
        self.bark.add(vertices, faces, colors, uvs=uvs)

    def leaf_cluster(self, center, outward, count, size):
        rng = self.rng
        for _ in range(count):
            offset = _random_unit(rng) * size * 0.55 * rng.random() ** 0.5
            card_center = Vector(center) + offset
            normal = (Vector(outward) * 0.7 + _random_unit(rng) * 0.9 + Vector((0, 0, 0.35))).normalized()
            tangent = normal.cross(_random_unit(rng)).normalized()
            if tangent.length < 1e-4:
                continue
            card_size = size * rng.uniform(0.8, 1.2)
            tile = self.leaf_tiles[rng.integers(0, len(self.leaf_tiles))]
            self.cards.append((card_center, normal, tangent, card_size, tile))

    def limb(self, origin, direction, length, radius, depth, max_depth, leaf_size, cluster_count, rise=0.12):
        rng = self.rng
        segments = 4 if depth == 1 else 3
        points = [Vector(origin)]
        heading = Vector(direction).normalized()
        step = length / segments
        for _ in range(segments):
            heading = (heading + Vector((0, 0, rise)) + _random_unit(rng) * 0.18).normalized()
            points.append(points[-1] + heading * step)
        radii = [radius * (1.0 - 0.72 * index / segments) for index in range(segments + 1)]
        self.tube(points, radii, 5 if depth == 1 else 4)
        tip = points[-1]
        self.leaf_cluster(tip, heading, cluster_count, leaf_size)
        if depth < max_depth:
            for child in range(2 + int(rng.random() < 0.5)):
                fraction = rng.uniform(0.35, 0.85)
                index = min(int(fraction * segments), segments - 1)
                start = points[index].lerp(points[index + 1], fraction * segments - index)
                side = heading.cross(_random_unit(rng)).normalized()
                child_direction = (heading * 0.7 + side * 0.7 + Vector((0, 0, 0.25))).normalized()
                self.limb(start, child_direction, length * rng.uniform(0.38, 0.58), radii[index] * 0.6,
                          depth + 1, max_depth, leaf_size * 0.95, max(cluster_count - 2, 4))
        else:
            for point in points[1:-1]:
                if rng.random() < 0.6:
                    self.leaf_cluster(point, heading, max(cluster_count // 2, 3), leaf_size * 0.85)

    def trunk(self, height, radius, lean, wobble=0.12):
        rng = self.rng
        count = max(int(height / 0.45), 4) + 1
        points = []
        radii = []
        lean_direction = Vector((math.cos(lean[1]), math.sin(lean[1]), 0.0)) * lean[0]
        for index in range(count):
            t = index / (count - 1)
            offset = Vector((
                noise.noise(Vector((t * 2.0, 0.0, 0.0)) + self.noise_offset),
                noise.noise(Vector((0.0, t * 2.0, 0.0)) + self.noise_offset),
                0.0,
            )) * wobble * t
            points.append(Vector((0, 0, t * height)) + lean_direction * t ** 1.4 + offset)
            radii.append(radius * (1.0 - 0.68 * t) * (1.0 + 0.55 * math.exp(-t * height * 3.5)))
        self.tube(points, radii, 8)
        return points, radii

    def point_on(self, points, fraction):
        position = fraction * (len(points) - 1)
        index = min(int(position), len(points) - 2)
        return points[index].lerp(points[index + 1], position - index), index

    def crown(self, points, radii, branch_count, branch_length, canopy_start, leaf_size, cluster_count):
        rng = self.rng
        for branch in range(branch_count):
            fraction = canopy_start + (1.0 - canopy_start) * (branch + rng.uniform(0.1, 0.9)) / branch_count
            origin, index = self.point_on(points, min(fraction, 0.97))
            azimuth = branch * GOLDEN_ANGLE + rng.uniform(-0.3, 0.3)
            rise = rng.uniform(0.35, 0.8) + 0.5 * (fraction - canopy_start)
            direction = Vector((math.cos(azimuth), math.sin(azimuth), rise)).normalized()
            taper = 1.15 - 0.6 * (fraction - canopy_start) / max(1.0 - canopy_start, 1e-3)
            length = branch_length * taper * rng.uniform(0.8, 1.2)
            self.limb(origin, direction, length, radii[index] * 0.55, 1, 2, leaf_size, cluster_count)
        top = points[-1]
        self.leaf_cluster(top + Vector((0, 0, 0.3)), Vector((0, 0, 1)), cluster_count + 4, leaf_size * 1.05)

    def build(self, name, leaf_material, bark_material):
        objects = []
        bark_vertices, bark_faces, bark_colors, bark_uvs, _, _ = self.bark.arrays()
        if self.cards:
            centers = np.array([card[0][:] for card in self.cards])
            canopy_center = centers.mean(axis=0)
            canopy_radius = np.percentile(np.linalg.norm(centers - canopy_center, axis=1), 90) + 1e-3
        vertices = []
        faces = []
        uvs = []
        normals = []
        colors = []
        for card_center, normal, tangent, size, tile in self.cards:
            bitangent = normal.cross(tangent).normalized()
            outward = Vector(card_center[:]) - Vector(canopy_center)
            spherical = outward.normalized() if outward.length > 1e-4 else Vector((0, 0, 1))
            if normal.dot(spherical) < 0:
                normal = -normal
            shading_normal = (normal * 0.35 + spherical * 0.65 + Vector((0, 0, 0.15))).normalized()
            depth = min(outward.length / canopy_radius, 1.0)
            occlusion = 0.5 + 0.5 * float(smoothstep(0.15, 1.0, depth))
            u0, v0, u1, v1 = tile_rect(tile)
            start = len(vertices)
            for corner_u, corner_v in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
                vertices.append((card_center + tangent * corner_u * size + bitangent * corner_v * size)[:])
                uvs.append((u0 if corner_u < 0 else u1, v0 if corner_v < 0 else v1))
                normals.append(shading_normal[:])
                colors.append((occlusion, occlusion, occlusion, 1.0))
            faces.append([start, start + 1, start + 2, start + 3])
        bark = build_mesh_object(f"{name}_bark", bark_vertices, bark_faces, colors=bark_colors,
                                 vertex_uvs=bark_uvs, materials=[bark_material], smooth=True)
        objects.append(bark)
        if vertices:
            leaves = build_mesh_object(f"{name}_leaves", np.array(vertices), faces, colors=np.array(colors),
                                       vertex_uvs=np.array(uvs), materials=[leaf_material], smooth=True,
                                       custom_normals=np.array(normals))
            objects.append(leaves)
        return objects


def build_trees(atlas_path):
    atlas = build_leaf_atlas(atlas_path)
    leaf_material = make_material("leaves", image=atlas, roughness=0.65, alpha_clip=True)
    bark_material = make_material("bark", roughness=0.9)
    objects = []

    tall = TreeBuilder(101, (0.17, 0.15, 0.13), [0, 1, 3])
    points, radii = tall.trunk(8.6, 0.16, (0.35, 0.6))
    tall.crown(points, radii, 8, 2.4, 0.42, 0.92, 11)
    objects += tall.build("tree_0", leaf_material, bark_material)

    broad = TreeBuilder(202, (0.15, 0.12, 0.1), [0, 1, 1, 3])
    points, radii = broad.trunk(6.9, 0.21, (0.25, 2.1))
    broad.crown(points, radii, 10, 2.9, 0.34, 1.0, 12)
    objects += broad.build("tree_1", leaf_material, bark_material)

    young = TreeBuilder(303, (0.2, 0.18, 0.15), [0, 3, 3])
    points, radii = young.trunk(5.3, 0.1, (0.2, 4.0))
    young.crown(points, radii, 7, 1.7, 0.4, 0.76, 9)
    objects += young.build("tree_2", leaf_material, bark_material)

    hero = TreeBuilder(404, (0.14, 0.11, 0.09), [0, 1, 3])
    points, radii = hero.trunk(7.6, 0.3, (0.9, 3.3), wobble=0.3)
    hero.crown(points, radii, 8, 2.7, 0.48, 0.96, 12)
    branch_origin, index = hero.point_on(points, 0.4)
    hero.limb(branch_origin, Vector((1.0, 0.0, 0.14)), 7.0, radii[index] * 0.62, 1, 2, 0.92, 12, rise=-0.03)
    objects += hero.build("tree_3", leaf_material, bark_material)

    for variant, (seed, stems, stem_length, card_size) in enumerate(((505, 8, 1.25, 0.56), (606, 11, 0.95, 0.5))):
        bush = TreeBuilder(seed, (0.16, 0.13, 0.1), [2, 2, 2, 1])
        rng = bush.rng
        for stem in range(stems):
            azimuth = stem * GOLDEN_ANGLE + rng.uniform(-0.3, 0.3)
            rise = rng.uniform(1.2, 3.0)
            direction = Vector((math.cos(azimuth), math.sin(azimuth), rise)).normalized()
            start = Vector((rng.uniform(-0.1, 0.1), rng.uniform(-0.1, 0.1), -0.05))
            bush.limb(start, direction, stem_length * rng.uniform(0.75, 1.15), 0.025, 2, 2, card_size, 9)
        bush.leaf_cluster(Vector((0, 0, stem_length * 0.55)), Vector((0, 0, 1)), 10, card_size * 1.1)
        objects += bush.build(f"bush_{variant}", leaf_material, bark_material)
    return objects
