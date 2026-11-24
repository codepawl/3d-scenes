"""EEVEE review renders: five standing views, a one-leg pose test and a contact sheet.

The lights, cameras and floor are added after the GLB export, so none of them
end up in the exported file.
"""

import math

import bpy
import numpy
from mathutils import Vector

from mesh_builder import AUTHORING_TO_BLENDER, rotate_node_locally
from spider_materials import new_principled_material

# View name: camera position, look-at target (glTF frame) and lens in mm.
STANDING_VIEWS = (
    ("front", (0.0, 1.05, 7.2), (0.0, 1.0, 0.0), 50.0),
    ("side", (7.2, 1.05, 0.0), (0.0, 1.0, 0.0), 50.0),
    ("three-quarter", (4.9, 3.0, 5.8), (0.0, 1.05, 0.0), 50.0),
    ("top", (0.0, 8.5, 0.0), (0.0, 0.0, 0.0), 50.0),
    ("low-dramatic", (1.1, 0.16, 2.9), (0.0, 1.45, 0.0), 20.0),
)
POSE_TEST_VIEW = ("pose-test", (4.6, 2.2, 5.6), (0.6, 1.25, 0.5), 40.0)
POSE_TEST_LEG = "LegL1"
# Lift and reach: swing the coxa forward, raise the femur, open the knee and ankle.
POSE_TEST_ROTATIONS = (("Coxa", "Y", -22.0), ("Femur", "X", -24.0), ("Tibia", "X", -38.0), ("Tarsus", "X", -18.0))


def to_blender(position):
    return AUTHORING_TO_BLENDER @ Vector(position)


def aim(node, position, target):
    """Place a camera or light at position looking at target (both in the glTF frame)."""
    position_in_blender = to_blender(position)
    direction = to_blender(target) - position_in_blender
    node.location = position_in_blender
    node.rotation_mode = "QUATERNION"
    node.rotation_quaternion = direction.to_track_quat("-Z", "Y")


def add_light(name, light_type, energy, color, position, target, size=1.0):
    light_data = bpy.data.lights.new(name, type=light_type)
    light_data.energy = energy
    light_data.color = color
    if light_type == "AREA":
        light_data.size = size
    if light_type == "SUN":
        light_data.angle = math.radians(4.0)
    light = bpy.data.objects.new(name, light_data)
    bpy.context.scene.collection.objects.link(light)
    aim(light, position, target)
    return light


def build_world():
    """Dark ground, warm hazy horizon and a dusky sky, so the metals have something to reflect."""
    world = bpy.data.worlds.new("RenderWorld")
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    nodes.clear()
    coordinates = nodes.new("ShaderNodeTexCoord")
    separate = nodes.new("ShaderNodeSeparateXYZ")
    remap = nodes.new("ShaderNodeMapRange")
    ramp = nodes.new("ShaderNodeValToRGB")
    background = nodes.new("ShaderNodeBackground")
    output = nodes.new("ShaderNodeOutputWorld")
    remap.inputs["From Min"].default_value = -1.0
    elements = ramp.color_ramp.elements
    elements[0].color = (0.008, 0.008, 0.01, 1.0)
    elements[1].color = (0.02, 0.028, 0.045, 1.0)
    horizon_low = elements.new(0.49)
    horizon_low.color = (0.025, 0.022, 0.022, 1.0)
    horizon = elements.new(0.52)
    horizon.color = (0.16, 0.12, 0.09, 1.0)
    links.new(coordinates.outputs["Generated"], separate.inputs[0])
    links.new(separate.outputs[2], remap.inputs[0])
    links.new(remap.outputs[0], ramp.inputs[0])
    links.new(ramp.outputs[0], background.inputs[0])
    links.new(background.outputs[0], output.inputs[0])
    bpy.context.scene.world = world


def build_floor():
    mesh = bpy.data.meshes.new("RenderFloor")
    half_size = 30.0
    corners = [(-half_size, -half_size, 0.0), (half_size, -half_size, 0.0), (half_size, half_size, 0.0), (-half_size, half_size, 0.0)]
    mesh.from_pydata(corners, [], [(0, 1, 2, 3)])
    material, principled = new_principled_material("RenderFloor")
    # One-unit prototype grid, to judge scale and foot contact.
    checker = material.node_tree.nodes.new("ShaderNodeTexChecker")
    checker.inputs["Scale"].default_value = 2.0 * half_size
    checker.inputs["Color1"].default_value = (0.055, 0.057, 0.062, 1.0)
    checker.inputs["Color2"].default_value = (0.075, 0.078, 0.085, 1.0)
    material.node_tree.links.new(checker.outputs["Color"], principled.inputs["Base Color"])
    principled.inputs["Roughness"].default_value = 0.75
    mesh.materials.append(material)
    floor = bpy.data.objects.new("RenderFloor", mesh)
    bpy.context.scene.collection.objects.link(floor)


def configure_renderer():
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.exposure = -0.8
    scene.eevee.taa_render_samples = 48
    if hasattr(scene.eevee, "use_raytracing"):
        scene.eevee.use_raytracing = True


def build_stage():
    configure_renderer()
    build_world()
    build_floor()
    add_light("KeySun", "SUN", 2.6, (1.0, 0.9, 0.78), (2.5, 6.0, 2.0), (0.0, 0.0, 0.0))
    add_light("CoolFill", "AREA", 220.0, (0.55, 0.7, 1.0), (-5.0, 2.0, 3.5), (0.0, 1.0, 0.0), size=5.0)
    add_light("FurnaceRim", "AREA", 900.0, (1.0, 0.55, 0.25), (0.5, 3.2, -5.0), (0.0, 1.3, 0.0), size=4.0)
    add_light("EyeSpill", "POINT", 18.0, (1.0, 0.48, 0.1), (0.0, 0.95, 1.25), (0.0, 0.95, 2.0))
    camera_data = bpy.data.cameras.new("ReviewCamera")
    camera_data.sensor_width = 36.0
    camera_data.clip_start = 0.05
    camera = bpy.data.objects.new("ReviewCamera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    return camera


def render_view(camera, view, artifact_directory):
    view_name, position, target, lens = view
    camera.data.lens = lens
    aim(camera, position, target)
    output_path = artifact_directory / f"model-{view_name}.png"
    bpy.context.scene.render.filepath = str(output_path)
    bpy.ops.render.render(write_still=True)
    return output_path


def render_pose_test(camera, artifact_directory):
    """Rotate one leg's joints about their documented axes, render, then restore the rest pose."""
    pivots = [bpy.data.objects[f"{POSE_TEST_LEG}_{segment}"] for segment, _, _ in POSE_TEST_ROTATIONS]
    rest_matrices = [pivot.matrix_basis.copy() for pivot in pivots]
    tip = bpy.data.objects[f"{POSE_TEST_LEG}_Tip"]
    for pivot, (_, axis_name, degrees) in zip(pivots, POSE_TEST_ROTATIONS):
        rotate_node_locally(pivot, axis_name, math.radians(degrees))
    bpy.context.view_layer.update()
    lifted_tip = tip.matrix_world.translation.copy()
    output_path = render_view(camera, POSE_TEST_VIEW, artifact_directory)
    for pivot, rest_matrix in zip(pivots, rest_matrices):
        pivot.matrix_basis = rest_matrix
    bpy.context.view_layer.update()
    print(f"[spider] pose test: {POSE_TEST_LEG} tip lifted to height {lifted_tip.z:.3f}")
    return output_path


def load_half_size_pixels(path):
    image = bpy.data.images.load(str(path))
    width, height = image.size
    pixels = numpy.empty(width * height * 4, dtype=numpy.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(height, width, 4)[::2, ::2]


def write_contact_sheet(image_paths, output_path, columns=3):
    tiles = [load_half_size_pixels(path) for path in image_paths]
    rows = [numpy.concatenate(tiles[start : start + columns], axis=1) for start in range(0, len(tiles), columns)]
    # Blender stores pixel rows bottom-up, so the first row of tiles goes last.
    sheet = numpy.concatenate(rows[::-1], axis=0)
    height, width, _ = sheet.shape
    image = bpy.data.images.new("ContactSheet", width=width, height=height, alpha=False)
    image.pixels.foreach_set(sheet.ravel())
    image.filepath_raw = str(output_path)
    image.file_format = "PNG"
    image.save()
    bpy.data.images.remove(image)


def render_review_set(artifact_directory):
    artifact_directory.mkdir(parents=True, exist_ok=True)
    camera = build_stage()
    image_paths = [render_view(camera, view, artifact_directory) for view in STANDING_VIEWS]
    image_paths.append(render_pose_test(camera, artifact_directory))
    write_contact_sheet(image_paths, artifact_directory / "model-contact-sheet.png")
    return image_paths
