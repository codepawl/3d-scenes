"""Bmesh helpers that build rigid parts in the exported glTF frame.

Parts are authored with Y up and +Z forward, exactly as three.js will see
them. Geometry and node transforms are converted to Blender's Z-up frame only
when they are written to Blender data, so the Y-up glTF export gives back the
authored axes on every node.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

AUTHORING_TO_BLENDER = Matrix(
    (
        (1.0, 0.0, 0.0, 0.0),
        (0.0, 0.0, -1.0, 0.0),
        (0.0, 1.0, 0.0, 0.0),
        (0.0, 0.0, 0.0, 1.0),
    )
)
BLENDER_TO_AUTHORING = AUTHORING_TO_BLENDER.inverted()
SHARP_EDGE_ANGLE = math.radians(38.0)
UV_TILES_PER_UNIT = 0.8


def orientation_from_axes(z_direction, y_hint=None):
    """Rotation whose local +Z is z_direction and whose local +Y leans toward y_hint."""
    z_axis = Vector(z_direction).normalized()
    if y_hint is None:
        y_hint = z_axis.orthogonal()
    x_axis = Vector(y_hint).cross(z_axis).normalized()
    y_axis = z_axis.cross(x_axis)
    return Matrix((x_axis, y_axis, z_axis)).transposed().to_4x4()


def circle_points(center, orientation, radius, sides):
    points = []
    for index in range(sides):
        angle = 2.0 * math.pi * index / sides
        offset = Vector((radius * math.cos(angle), radius * math.sin(angle), 0.0))
        points.append(Vector(center) + orientation @ offset)
    return points


def chamfered_rectangle_ring(half_width, half_height, z):
    """Eight-point beam cross-section in the local XY plane at height z."""
    chamfer = 0.3 * min(half_width, half_height)
    corners = (
        (half_width - chamfer, half_height),
        (half_width, half_height - chamfer),
        (half_width, -half_height + chamfer),
        (half_width - chamfer, -half_height),
        (-half_width + chamfer, -half_height),
        (-half_width, -half_height + chamfer),
        (-half_width, half_height - chamfer),
        (-half_width + chamfer, half_height),
    )
    return [Vector((x, y, z)) for x, y in corners]


def blade_rings(length, base_half_width, base_half_thickness, bulge, stations=12):
    """Curved blade from the origin to a point at (0, 0, length).

    The blade bows toward local +Y, keeps its thick spine on the +Y side and its
    cutting edge on -Y, and is symmetric in X so mirrored legs can share it.
    """
    rings = []
    for station in range(stations):
        progress = station / stations
        center_y = bulge * math.sin(math.pi * progress)
        taper = (1.0 - progress) ** 0.8
        half_width = base_half_width * taper
        half_thickness = base_half_thickness * taper
        z = length * progress
        rings.append(
            [
                Vector((0.0, center_y + half_width, z)),
                Vector((half_thickness, center_y + 0.35 * half_width, z)),
                Vector((0.0, center_y - half_width, z)),
                Vector((-half_thickness, center_y + 0.35 * half_width, z)),
            ]
        )
    rings.append([Vector((0.0, 0.0, length))])
    return rings


def transform_rings(rings, placement):
    return [[placement @ Vector(point) for point in ring] for ring in rings]


def catmull_rom_point(before, start, end, after, progress):
    squared = progress * progress
    cubed = squared * progress
    return 0.5 * (
        2.0 * start
        + (end - before) * progress
        + (2.0 * before - 5.0 * start + 4.0 * end - after) * squared
        + (3.0 * start - before - 3.0 * end + after) * cubed
    )


def smooth_path(control_points, samples_per_span=6):
    """Catmull-Rom curve through the control points."""
    points = [Vector(point) for point in control_points]
    padded = [points[0]] + points + [points[-1]]
    path = []
    for span_index in range(len(points) - 1):
        before, start, end, after = padded[span_index : span_index + 4]
        for sample_index in range(samples_per_span):
            path.append(catmull_rom_point(before, start, end, after, sample_index / samples_per_span))
    path.append(points[-1])
    return path


def path_tangents(points):
    tangents = []
    last_index = len(points) - 1
    for index in range(len(points)):
        next_point = points[min(index + 1, last_index)]
        previous_point = points[max(index - 1, 0)]
        tangents.append((next_point - previous_point).normalized())
    return tangents


def sweep_rings(path, radius, sides):
    """Circles along a path, kept from twisting by parallel transport."""
    points = [Vector(point) for point in path]
    tangents = path_tangents(points)
    normal = tangents[0].orthogonal().normalized()
    previous_tangent = tangents[0]
    rings = []
    for point, tangent in zip(points, tangents):
        normal = previous_tangent.rotation_difference(tangent) @ normal
        binormal = tangent.cross(normal)
        ring = []
        for index in range(sides):
            angle = 2.0 * math.pi * index / sides
            ring.append(point + radius * (math.cos(angle) * normal + math.sin(angle) * binormal))
        rings.append(ring)
        previous_tangent = tangent
    return rings


def faces_of(vertices):
    return {face for vertex in vertices for face in vertex.link_faces}


def apply_box_uv(mesh_data):
    """Project each face onto the plane its normal faces most; the textures tile."""
    uv_layer = mesh_data.loops.layers.uv.verify()
    mesh_data.normal_update()
    for face in mesh_data.faces:
        normal = face.normal
        dominant_axis = max(range(3), key=lambda axis: abs(normal[axis]))
        first_axis, second_axis = [axis for axis in range(3) if axis != dominant_axis]
        for loop in face.loops:
            position = loop.vert.co
            loop[uv_layer].uv = (position[first_axis] * UV_TILES_PER_UNIT, position[second_axis] * UV_TILES_PER_UNIT)


def shade_smooth_with_sharp_edges(mesh):
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    mesh.set_sharp_from_angle(angle=SHARP_EDGE_ANGLE)


class MeshBuilder:
    """Collects closed primitives for one rigid part, authored in the glTF frame."""

    def __init__(self):
        self.mesh_data = bmesh.new()
        self.material_names = []

    def assign_material(self, faces, material_name):
        if material_name not in self.material_names:
            self.material_names.append(material_name)
        material_index = self.material_names.index(material_name)
        for face in faces:
            face.material_index = material_index

    def cylinder(self, material_name, start, end, radius, end_radius=None, sides=12):
        start = Vector(start)
        end = Vector(end)
        if end_radius is None:
            end_radius = radius
        placement = Matrix.Translation((start + end) / 2.0) @ orientation_from_axes(end - start)
        created = bmesh.ops.create_cone(
            self.mesh_data,
            cap_ends=True,
            segments=sides,
            radius1=radius,
            radius2=end_radius,
            depth=(end - start).length,
            matrix=placement,
        )
        self.assign_material(faces_of(created["verts"]), material_name)

    def cone(self, material_name, base, tip, radius, sides=6):
        orientation = orientation_from_axes(Vector(tip) - Vector(base))
        base_ring = circle_points(base, orientation, radius, sides)
        self.loft(material_name, [base_ring, [Vector(tip)]])

    def box(self, material_name, center, size, orientation=None):
        if orientation is None:
            orientation = Matrix.Identity(4)
        scale = Matrix.Diagonal((size[0], size[1], size[2], 1.0))
        placement = Matrix.Translation(center) @ orientation @ scale
        created = bmesh.ops.create_cube(self.mesh_data, size=1.0, matrix=placement)
        self.assign_material(faces_of(created["verts"]), material_name)

    def sphere(self, material_name, center, radius, segments=12, rings=8, scale=(1.0, 1.0, 1.0)):
        placement = Matrix.Translation(center) @ Matrix.Diagonal((scale[0], scale[1], scale[2], 1.0))
        created = bmesh.ops.create_uvsphere(
            self.mesh_data,
            u_segments=segments,
            v_segments=rings,
            radius=radius,
            matrix=placement,
        )
        self.assign_material(faces_of(created["verts"]), material_name)

    def rivet(self, material_name, center, radius):
        self.sphere(material_name, center, radius, segments=6, rings=3)

    def bolt_circle(self, material_name, center, axis, circle_radius, count, bolt_radius, bolt_height):
        axis = Vector(axis).normalized()
        orientation = orientation_from_axes(axis)
        for start in circle_points(center, orientation, circle_radius, count):
            self.cylinder(material_name, start, start + axis * bolt_height, bolt_radius, sides=6)

    def loft(self, material_names, rings):
        """Skin rings into a closed shell; a one-point ring is an apex.

        material_names is one name, or one name per span between rings.
        """
        span_count = len(rings) - 1
        if isinstance(material_names, str):
            material_names = [material_names] * span_count
        ring_vertices = [[self.mesh_data.verts.new(point) for point in ring] for ring in rings]
        for span_index in range(span_count):
            faces = self.bridge(ring_vertices[span_index], ring_vertices[span_index + 1])
            self.assign_material(faces, material_names[span_index])
        self.cap(ring_vertices[0], material_names[0])
        self.cap(ring_vertices[-1], material_names[-1])

    def bridge(self, lower_ring, upper_ring):
        faces = []
        if len(lower_ring) == 1:
            for index in range(len(upper_ring)):
                next_index = (index + 1) % len(upper_ring)
                faces.append(self.mesh_data.faces.new((lower_ring[0], upper_ring[next_index], upper_ring[index])))
            return faces
        if len(upper_ring) == 1:
            for index in range(len(lower_ring)):
                next_index = (index + 1) % len(lower_ring)
                faces.append(self.mesh_data.faces.new((lower_ring[index], lower_ring[next_index], upper_ring[0])))
            return faces
        for index in range(len(lower_ring)):
            next_index = (index + 1) % len(lower_ring)
            quad = (lower_ring[index], lower_ring[next_index], upper_ring[next_index], upper_ring[index])
            faces.append(self.mesh_data.faces.new(quad))
        return faces

    def cap(self, ring, material_name):
        if len(ring) < 3:
            return
        self.assign_material([self.mesh_data.faces.new(ring)], material_name)

    def lathe(self, material_names, profile, sides, placement=None, radial_scale=(1.0, 1.0)):
        """Revolve (radius, height) points around local +Y; radius 0 closes the shell."""
        if placement is None:
            placement = Matrix.Identity(4)
        rings = []
        for radius, height in profile:
            if radius == 0.0:
                rings.append([Vector((0.0, height, 0.0))])
                continue
            ring = []
            for index in range(sides):
                angle = 2.0 * math.pi * index / sides
                ring.append(Vector((radius * radial_scale[0] * math.cos(angle), height, radius * radial_scale[1] * math.sin(angle))))
            rings.append(ring)
        self.loft(material_names, transform_rings(rings, placement))

    def tube(self, material_name, path, radius, sides=8):
        self.loft(material_name, sweep_rings(path, radius, sides))

    def to_mesh(self, mesh_name):
        """Write the part as a Blender mesh in Blender's Z-up frame."""
        bmesh.ops.recalc_face_normals(self.mesh_data, faces=self.mesh_data.faces[:])
        apply_box_uv(self.mesh_data)
        bmesh.ops.transform(self.mesh_data, matrix=AUTHORING_TO_BLENDER, verts=self.mesh_data.verts[:])
        mesh = bpy.data.meshes.new(mesh_name)
        self.mesh_data.to_mesh(mesh)
        self.mesh_data.free()
        for material_name in self.material_names:
            mesh.materials.append(bpy.data.materials[material_name])
        shade_smooth_with_sharp_edges(mesh)
        return mesh


def create_node(name, parent, authoring_matrix, mesh=None):
    """Add an object whose local transform is given in the glTF frame."""
    node = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(node)
    node.parent = parent
    node.rotation_mode = "QUATERNION"
    node.matrix_basis = AUTHORING_TO_BLENDER @ authoring_matrix @ BLENDER_TO_AUTHORING
    if mesh is None:
        node.empty_display_size = 0.05
    return node


def authoring_local_matrix(node):
    return BLENDER_TO_AUTHORING @ node.matrix_basis @ AUTHORING_TO_BLENDER


def rotate_node_locally(node, axis_name, angle_radians):
    """Turn a node about one of its own glTF-frame axes, as three.js rotateX/rotateY would."""
    rotated = authoring_local_matrix(node) @ Matrix.Rotation(angle_radians, 4, axis_name)
    node.matrix_basis = AUTHORING_TO_BLENDER @ rotated @ BLENDER_TO_AUTHORING


def authoring_world_position(node):
    return BLENDER_TO_AUTHORING @ node.matrix_world.translation
