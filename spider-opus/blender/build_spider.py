"""Build the steampunk spider, export assets/spider.glb, save assets/spider.blend and render review views.

Run from anywhere:
    blender --background --factory-startup --python-exit-code 1 --python blender/build_spider.py [-- --skip-render]
"""

import sys
import tempfile
import time
from pathlib import Path

SCRIPT_DIRECTORY = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPT_DIRECTORY))

import bpy  # noqa: E402

from glb_extras import write_node_extras  # noqa: E402
from mesh_builder import authoring_world_position, create_node  # noqa: E402
from mathutils import Matrix  # noqa: E402
from spider_body import build_body  # noqa: E402
from spider_legs import build_leg, build_segment_meshes  # noqa: E402
from spider_materials import create_spider_materials  # noqa: E402
from spider_render import render_review_set  # noqa: E402
from spider_spec import BODY_REST_HEIGHT, LEG_SPECS, SEGMENT_LENGTHS, SEGMENT_NAMES, solve_leg_rest_pose  # noqa: E402

PROJECT_DIRECTORY = SCRIPT_DIRECTORY.parent
ASSET_DIRECTORY = PROJECT_DIRECTORY / "assets"
TEXTURE_DIRECTORY = ASSET_DIRECTORY / "textures"
ARTIFACT_DIRECTORY = PROJECT_DIRECTORY / "artifacts"
GLB_PATH = ASSET_DIRECTORY / "spider.glb"
BLEND_PATH = ASSET_DIRECTORY / "spider.blend"
FOOT_HEIGHT_TOLERANCE = 1e-5

EXPORT_OPTIONS = {
    "export_format": "GLB",
    "export_yup": True,
    "export_apply": False,
    "export_animations": False,
    "export_skins": False,
    "export_morph": False,
    "export_cameras": False,
    "export_lights": False,
    "export_extras": False,
    "export_image_format": "JPEG",
    # The quality option changed name between Blender versions; unknown ones are skipped.
    "export_jpeg_quality": 88,
    "export_image_quality": 88,
}


def build_spider():
    spider = create_node("Spider", None, Matrix.Identity(4))
    body = build_body(spider)
    rest_pose = solve_leg_rest_pose()
    segment_meshes = build_segment_meshes()
    legs = {leg.name: build_leg(body, leg, rest_pose, segment_meshes) for leg in LEG_SPECS}
    bpy.context.view_layer.update()
    return spider, legs


def rounded_position(node):
    position = authoring_world_position(node)
    return [round(coordinate, 6) + 0.0 for coordinate in position]


def collect_extras(legs):
    """Extras for the scene: segment lengths on pivots, rest layout on Spider."""
    hip_positions = []
    foot_positions = []
    extras = {}
    for leg in LEG_SPECS:
        pivots = legs[leg.name]
        foot_position = rounded_position(pivots["Tip"])
        if abs(foot_position[1]) > FOOT_HEIGHT_TOLERANCE:
            raise ValueError(f"{leg.name} tip is at height {foot_position[1]}, not on the ground")
        hip_positions.append(rounded_position(pivots["Coxa"]))
        foot_positions.append(foot_position)
        for segment_name in SEGMENT_NAMES:
            extras[f"{leg.name}_{segment_name}"] = {"segmentLength": SEGMENT_LENGTHS[segment_name]}
    extras["Spider"] = {
        "legOrder": [leg.name for leg in LEG_SPECS],
        "hipPositions": hip_positions,
        "restFootPositions": foot_positions,
        "bodyRestHeight": BODY_REST_HEIGHT,
    }
    return extras


def export_glb(glb_path):
    supported_options = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    options = {name: value for name, value in EXPORT_OPTIONS.items() if name in supported_options}
    skipped = sorted(set(EXPORT_OPTIONS) - set(options))
    if skipped:
        print(f"[spider] exporter options not in this Blender: {skipped}")
    # The exporter encodes each texture through a temporary folder. Creating one in
    # the system temp folder took 40+ seconds per texture on this machine, so the
    # export gets a short-lived folder next to the build scripts instead.
    previous_temp_directory = tempfile.tempdir
    with tempfile.TemporaryDirectory(dir=SCRIPT_DIRECTORY) as export_temp_directory:
        tempfile.tempdir = export_temp_directory
        try:
            bpy.ops.export_scene.gltf(filepath=str(glb_path), **options)
        finally:
            tempfile.tempdir = previous_temp_directory


def count_triangles():
    triangle_count = 0
    for node in bpy.data.objects:
        if node.type != "MESH":
            continue
        triangle_count += sum(len(polygon.vertices) - 2 for polygon in node.data.polygons)
    return triangle_count


def main():
    started = time.perf_counter()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    create_spider_materials(TEXTURE_DIRECTORY)
    _spider, legs = build_spider()
    extras = collect_extras(legs)
    export_glb(GLB_PATH)
    write_node_extras(GLB_PATH, extras)
    print(f"[spider] triangles in scene: {count_triangles()}")
    print(f"[spider] rest pose: {solve_leg_rest_pose()}")
    print(f"[spider] exported {GLB_PATH} ({GLB_PATH.stat().st_size / 1e6:.2f} MB)")
    if "--skip-render" not in sys.argv:
        render_review_set(ARTIFACT_DIRECTORY)
    # No spider.blend1 backup beside the assets.
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    print(f"[spider] done in {time.perf_counter() - started:.1f} s")


main()
