"""Small helpers for building Blender meshes from numpy arrays and exporting GLB files.

Geometry inside these helpers is in Blender coordinates (Z up). Scene-level code works in
three.js coordinates (Y up, Z toward the viewer) and converts with to_blender().
"""

import bmesh
import bpy
import numpy as np


def to_blender(points):
    """Convert (N, 3) three.js coordinates to Blender coordinates."""
    points = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    return np.stack([points[:, 0], -points[:, 2], points[:, 1]], axis=1)


def smoothstep(edge0, edge1, value):
    t = np.clip((np.asarray(value, dtype=np.float64) - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def icosphere_arrays(subdivisions):
    """Unit icosphere as (vertices, triangle faces) numpy arrays."""
    sphere = bmesh.new()
    bmesh.ops.create_icosphere(sphere, subdivisions=subdivisions, radius=1.0)
    vertices = np.array([vertex.co[:] for vertex in sphere.verts], dtype=np.float64)
    faces = np.array([[vertex.index for vertex in face.verts] for face in sphere.faces], dtype=np.int64)
    sphere.free()
    return vertices, faces


def cube_sphere_arrays(segments):
    """Subdivided cube surface with merged seams: (vertices on the cube [-1, 1]^3, quad faces)."""
    grid = np.linspace(-1.0, 1.0, segments + 1)
    all_points = []
    all_faces = []
    # Each face: (fixed axis, sign); the two free axes are ordered so the winding faces outward.
    face_axes = [(0, 1.0, 1, 2), (0, -1.0, 2, 1), (1, 1.0, 2, 0), (1, -1.0, 0, 2), (2, 1.0, 0, 1), (2, -1.0, 1, 0)]
    for fixed_axis, sign, axis_u, axis_v in face_axes:
        base = len(all_points)
        for row in range(segments + 1):
            for column in range(segments + 1):
                point = [0.0, 0.0, 0.0]
                point[fixed_axis] = sign
                point[axis_u] = grid[column]
                point[axis_v] = grid[row]
                all_points.append(point)
        for row in range(segments):
            for column in range(segments):
                corner = base + row * (segments + 1) + column
                all_faces.append([corner, corner + 1, corner + segments + 2, corner + segments + 1])
    points = np.array(all_points)
    rounded = np.round(points * 1000.0).astype(np.int64)
    _, unique_index, inverse = np.unique(rounded, axis=0, return_index=True, return_inverse=True)
    vertices = points[unique_index]
    faces = inverse.reshape(-1)[np.array(all_faces)]
    return vertices, faces


def vertex_neighbors(faces, vertex_count):
    """Edge list (both directions) for Laplacian smoothing and curvature."""
    faces = np.asarray(faces)
    corners = faces.shape[1]
    starts = []
    ends = []
    for corner in range(corners):
        starts.append(faces[:, corner])
        ends.append(faces[:, (corner + 1) % corners])
    start = np.concatenate(starts + ends)
    end = np.concatenate(ends + starts)
    pairs = np.unique(np.stack([start, end], axis=1), axis=0)
    counts = np.bincount(pairs[:, 0], minlength=vertex_count).astype(np.float64)
    return pairs, np.maximum(counts, 1.0)


def neighbor_average(positions, pairs, counts):
    total = np.zeros_like(positions)
    np.add.at(total, pairs[:, 0], positions[pairs[:, 1]])
    return total / counts[:, None]


def laplacian_smooth(positions, faces, iterations, strength):
    pairs, counts = vertex_neighbors(faces, len(positions))
    smoothed = positions.copy()
    for _ in range(iterations):
        smoothed += (neighbor_average(smoothed, pairs, counts) - smoothed) * strength
    return smoothed


def vertex_normals(positions, faces):
    """Area-weighted vertex normals for triangle or quad faces."""
    normals = np.zeros_like(positions)
    faces = np.asarray(faces)
    for first, second, third in [(0, 1, 2), (0, 2, 3)] if faces.shape[1] == 4 else [(0, 1, 2)]:
        a = positions[faces[:, first]]
        b = positions[faces[:, second]]
        c = positions[faces[:, third]]
        face_normal = np.cross(b - a, c - a)
        for corner in (first, second, third):
            np.add.at(normals, faces[:, corner], face_normal)
    length = np.linalg.norm(normals, axis=1, keepdims=True)
    return normals / np.maximum(length, 1e-12)


def build_mesh_object(
    name,
    vertices,
    faces,
    *,
    colors=None,
    vertex_uvs=None,
    attributes=None,
    material_indices=None,
    materials=(),
    smooth=True,
    custom_normals=None,
):
    """Create a mesh object from numpy data. colors are linear RGBA per vertex."""
    vertices = np.asarray(vertices, dtype=np.float64)
    mesh = bpy.data.meshes.new(name)
    face_list = [list(face) for face in np.asarray(faces).tolist()] if not isinstance(faces, list) else faces
    mesh.from_pydata(vertices.tolist(), [], face_list)
    mesh.update()

    if colors is not None:
        colors = np.asarray(colors, dtype=np.float32)
        if colors.shape[1] == 3:
            colors = np.concatenate([colors, np.ones((len(colors), 1), np.float32)], axis=1)
        color_attribute = mesh.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
        color_attribute.data.foreach_set("color", colors.ravel())
        mesh.color_attributes.active_color = color_attribute
        mesh.color_attributes.render_color_index = 0

    if vertex_uvs is not None:
        loop_vertex_index = np.empty(len(mesh.loops), dtype=np.int64)
        mesh.loops.foreach_get("vertex_index", loop_vertex_index)
        uv_layer = mesh.uv_layers.new(name="UVMap")
        uv_layer.data.foreach_set("uv", np.asarray(vertex_uvs, dtype=np.float32)[loop_vertex_index].ravel())

    for attribute_name, values in (attributes or {}).items():
        values = np.asarray(values, dtype=np.float32)
        attribute = mesh.attributes.new(attribute_name, "FLOAT_VECTOR", "POINT")
        attribute.data.foreach_set("vector", values.ravel())

    for material in materials:
        mesh.materials.append(material)
    if material_indices is not None:
        mesh.polygons.foreach_set("material_index", np.asarray(material_indices, dtype=np.int32))

    if smooth:
        mesh.shade_smooth()
    else:
        mesh.shade_flat()

    if custom_normals is not None:
        mesh.normals_split_custom_set_from_vertices([tuple(normal) for normal in np.asarray(custom_normals)])

    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_material(
    name,
    *,
    base_color=(1.0, 1.0, 1.0, 1.0),
    roughness=0.8,
    metallic=0.0,
    vertex_color=True,
    image=None,
    emission_color=None,
    emission_strength=0.0,
    alpha_clip=False,
):
    material = bpy.data.materials.new(name)
    try:
        material.use_nodes = True
    except AttributeError:
        pass
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes.get("Principled BSDF")
    if shader is None:
        shader = nodes.new("ShaderNodeBsdfPrincipled")
        output = nodes.get("Material Output") or nodes.new("ShaderNodeOutputMaterial")
        links.new(shader.outputs["BSDF"], output.inputs["Surface"])
    shader.inputs["Base Color"].default_value = base_color
    shader.inputs["Roughness"].default_value = roughness
    shader.inputs["Metallic"].default_value = metallic
    if image is not None:
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        links.new(texture.outputs["Color"], shader.inputs["Base Color"])
        if alpha_clip:
            links.new(texture.outputs["Alpha"], shader.inputs["Alpha"])
    elif vertex_color:
        color_node = nodes.new("ShaderNodeVertexColor")
        color_node.layer_name = "Col"
        links.new(color_node.outputs["Color"], shader.inputs["Base Color"])
    if emission_color is not None:
        shader.inputs["Emission Color"].default_value = emission_color
        shader.inputs["Emission Strength"].default_value = emission_strength
    if alpha_clip:
        for attribute_name, value in (("surface_render_method", "DITHERED"), ("blend_method", "CLIP")):
            try:
                setattr(material, attribute_name, value)
            except (AttributeError, TypeError):
                pass
    return material


def export_glb(path, objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_vertex_color="ACTIVE",
        export_all_vertex_colors=False,
        export_attributes=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
    )
