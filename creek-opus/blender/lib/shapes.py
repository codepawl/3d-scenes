"""Procedural shapes in Blender local coordinates (Z up)."""

import math

import numpy as np
from mathutils import Matrix, Vector, noise

from .meshkit import cube_sphere_arrays, icosphere_arrays, laplacian_smooth, neighbor_average, smoothstep, vertex_neighbors, vertex_normals


class MeshBuilder:
    """Accumulates many small parts into one mesh."""

    def __init__(self):
        self.vertices = []
        self.faces = []
        self.colors = []
        self.uvs = []
        self.normals = []
        self.material_indices = []
        self.vertex_count = 0

    def add(self, vertices, faces, colors, material_index=0, uvs=None, normals=None):
        """faces may mix triangles and quads, so they are kept as plain lists."""
        vertices = np.asarray(vertices, dtype=np.float64)
        colors = np.asarray(colors, dtype=np.float32)
        if colors.ndim == 1:
            colors = np.tile(colors, (len(vertices), 1))
        if colors.shape[1] == 3:
            colors = np.concatenate([colors, np.ones((len(colors), 1), np.float32)], axis=1)
        face_list = faces.tolist() if isinstance(faces, np.ndarray) else faces
        offset_faces = [[int(index) + self.vertex_count for index in face] for face in face_list]
        self.vertices.append(vertices)
        self.faces.extend(offset_faces)
        self.colors.append(colors)
        self.uvs.append(np.zeros((len(vertices), 2)) if uvs is None else np.asarray(uvs, dtype=np.float64))
        self.normals.append(np.zeros((len(vertices), 3)) if normals is None else np.asarray(normals, dtype=np.float64))
        self.material_indices.extend([material_index] * len(offset_faces))
        self.vertex_count += len(vertices)

    def arrays(self):
        return (
            np.concatenate(self.vertices),
            self.faces,
            np.concatenate(self.colors),
            np.concatenate(self.uvs),
            np.concatenate(self.normals),
            np.array(self.material_indices, dtype=np.int32),
        )


def _noise_field(points, frequency, offset):
    return np.array([noise.noise(Vector(point * frequency + offset)) for point in points])


def pancake_stone(seed):
    """Flat-topped river boulder, normalised to x, y in [-1, 1] and z in [0, 1]."""
    rng = np.random.default_rng(seed)
    vertices, faces = icosphere_arrays(5)
    directions = vertices / np.linalg.norm(vertices, axis=1, keepdims=True)
    depth_ratio = rng.uniform(0.8, 1.0)
    height_ratio = rng.uniform(0.46, 0.62)
    horizontal_exponent = rng.uniform(2.0, 2.5)
    vertical_exponent = rng.uniform(2.5, 3.4)
    dx, dy, dz = np.abs(directions.T)
    horizontal = dx ** horizontal_exponent + (dy / depth_ratio) ** horizontal_exponent
    radius = (horizontal ** (vertical_exponent / horizontal_exponent) + (dz / height_ratio) ** vertical_exponent) ** (-1.0 / vertical_exponent)
    points = directions * radius[:, None]
    offset = Vector(rng.uniform(-60, 60, 3))
    displacement = (
        0.11 * _noise_field(points, 1.2, offset)
        + 0.03 * _noise_field(points, 3.3, offset * 1.7)
        + 0.004 * _noise_field(points, 9.5, -offset)
    )
    points = points + directions * displacement[:, None]
    points[:, 2] += 0.06 * points[:, 0] * rng.uniform(-1, 1) * (points[:, 2] > 0)
    bottom = points[:, 2].min()
    flat_level = bottom * 0.55
    points[:, 2] = np.where(points[:, 2] < flat_level, flat_level + (points[:, 2] - flat_level) * 0.2, points[:, 2])
    points = laplacian_smooth(points, faces, 2, 0.3)
    span = np.abs(points[:, :2]).max()
    points[:, :2] /= span
    points[:, 2] -= points[:, 2].min()
    points[:, 2] /= points[:, 2].max()
    colors = _stone_colors(points, faces, offset, rng)
    return points, faces, colors


def _stone_colors(points, faces, offset, rng, moss=0.0):
    normals = vertex_normals(points, faces)
    pairs, counts = vertex_neighbors(faces, len(points))
    curvature = np.einsum("ij,ij->i", neighbor_average(points, pairs, counts) - points, normals)
    scale = np.percentile(np.abs(curvature), 95) + 1e-6
    cavity = np.clip(1.0 - 0.32 * curvature / scale, 0.6, 1.12)
    height = (points[:, 2] - points[:, 2].min()) / (np.ptp(points[:, 2]) + 1e-6)
    occlusion = 0.42 + 0.58 * smoothstep(0.0, 0.32, height)
    speckle = _noise_field(points, 16.0, offset * 0.3)
    speckle_shade = np.where(speckle > 0.42, 0.8, 1.0) * np.where(speckle < -0.5, 1.06, 1.0)
    blotch = _noise_field(points, 2.4, offset * 2.1)
    tone = 0.93 + 0.08 * blotch
    shade = (occlusion * cavity * speckle_shade * tone)[:, None]
    tint = np.ones((len(points), 3))
    lichen = smoothstep(0.25, 0.55, _noise_field(points, 1.7, -offset * 0.6)) * smoothstep(0.35, 0.9, normals[:, 2])
    tint = tint * (1 - lichen[:, None] * 0.18) + np.array([0.96, 0.98, 0.78]) * lichen[:, None] * 0.18
    if moss > 0:
        moss_amount = moss * smoothstep(0.1, 0.6, _noise_field(points, 2.2, offset)) * smoothstep(-0.2, 0.8, normals[:, 2])
        tint = tint * (1 - moss_amount[:, None]) + np.array([0.55, 0.72, 0.35]) * moss_amount[:, None]
    return np.clip(tint * shade, 0.0, 1.2)


def rounded_block_arrays(seed, exponent=4.5, segments=4, lumpiness=0.05):
    """Rounded, slightly irregular block filling the unit cube [-0.5, 0.5]^3."""
    rng = np.random.default_rng(seed)
    vertices, faces = cube_sphere_arrays(segments)
    directions = vertices / np.linalg.norm(vertices, axis=1, keepdims=True)
    radius = (np.abs(directions) ** exponent).sum(axis=1) ** (-1.0 / exponent)
    points = directions * radius[:, None]
    offset = Vector(rng.uniform(-60, 60, 3))
    displacement = lumpiness * _noise_field(points, 1.4, offset) + lumpiness * 0.35 * _noise_field(points, 3.6, offset * 1.3)
    points = points + directions * displacement[:, None]
    points -= (points.max(axis=0) + points.min(axis=0)) * 0.5
    points /= np.maximum(np.ptp(points, axis=0), 1e-6)
    return points, faces, offset


def wall_stone(seed):
    points, faces, offset = rounded_block_arrays(seed, exponent=np.random.default_rng(seed).uniform(2.7, 3.8), segments=4, lumpiness=0.11)
    rng = np.random.default_rng(seed + 99)
    colors = _stone_colors(points, faces, offset, rng, moss=0.55)
    return points, faces, colors


def pebble(seed):
    rng = np.random.default_rng(seed)
    vertices, faces = icosphere_arrays(3)
    directions = vertices / np.linalg.norm(vertices, axis=1, keepdims=True)
    offset = Vector(rng.uniform(-60, 60, 3))
    radius = 1.0 + 0.12 * _noise_field(directions, 1.3, offset)
    points = directions * radius[:, None]
    points = laplacian_smooth(points, faces, 1, 0.3)
    colors = _stone_colors(points, faces, offset, rng)
    return points, faces, colors


def box_arrays(center, size, rotation=None):
    """Flat-shaded box: 24 vertices, 6 quads. rotation is a 3x3 mathutils Matrix or None."""
    half = np.asarray(size, dtype=np.float64) * 0.5
    corners = np.array([[sx, sy, sz] for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)], dtype=np.float64) * half
    quads = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
    vertices = []
    faces = []
    for quad in quads:
        start = len(vertices)
        vertices.extend(corners[quad])
        faces.append([start, start + 1, start + 2, start + 3])
    vertices = np.array(vertices)
    if rotation is not None:
        vertices = vertices @ np.array(rotation).T
    return vertices + np.asarray(center, dtype=np.float64), np.array(faces)


def transform_points(points, matrix):
    points = np.asarray(points, dtype=np.float64)
    homogeneous = np.concatenate([points, np.ones((len(points), 1))], axis=1)
    return (homogeneous @ np.array(matrix).T)[:, :3]


def tube_arrays(path_points, radii, sides):
    """Tube along a polyline with parallel-transport frames. Returns vertices, faces, uvs, ring_index."""
    path_points = [Vector(point) for point in path_points]
    tangents = []
    for index in range(len(path_points)):
        previous_point = path_points[max(index - 1, 0)]
        next_point = path_points[min(index + 1, len(path_points) - 1)]
        tangents.append((next_point - previous_point).normalized())
    reference = Vector((0.0, 0.0, 1.0)) if abs(tangents[0].z) < 0.9 else Vector((1.0, 0.0, 0.0))
    normal = tangents[0].cross(reference).normalized()
    vertices = []
    uvs = []
    ring_index = []
    length_along = 0.0
    for index, point in enumerate(path_points):
        if index > 0:
            rotation = tangents[index - 1].rotation_difference(tangents[index])
            normal = (rotation @ normal).normalized()
            length_along += (point - path_points[index - 1]).length
        binormal = tangents[index].cross(normal).normalized()
        for side in range(sides + 1):
            angle = 2.0 * math.pi * side / sides
            offset = normal * math.cos(angle) + binormal * math.sin(angle)
            vertices.append(point + offset * radii[index])
            uvs.append((side / sides, length_along))
            ring_index.append(index)
    faces = []
    stride = sides + 1
    for ring in range(len(path_points) - 1):
        for side in range(sides):
            a = ring * stride + side
            faces.append([a, a + 1, a + 1 + stride, a + stride])
    return np.array([vertex[:] for vertex in vertices]), np.array(faces), np.array(uvs), np.array(ring_index)
