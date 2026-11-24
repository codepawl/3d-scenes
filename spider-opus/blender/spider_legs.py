"""Leg segments and the pivot chain the three.js scene drives.

Each segment is authored in its pivot's local frame: the joint is at the
origin, the segment runs along +Z to the next joint, the pin axis is X and +Y
is the outer face of the leg. Every part is symmetric in X, so all six legs
share the four segment meshes and the right legs are exact mirror images.
"""

import math

from mathutils import Matrix, Vector

from mesh_builder import (
    MeshBuilder,
    blade_rings,
    chamfered_rectangle_ring,
    create_node,
    orientation_from_axes,
    smooth_path,
    transform_rings,
)
from spider_spec import SEGMENT_LENGTHS, SEGMENT_NAMES

CHEEK_THICKNESS = 0.02
CHEEK_CLEARANCE = 0.003
# Radius and width of the knuckle at the start of each segment; its pin runs along local X.
JOINT_HOUSINGS = {"Femur": (0.094, 0.11), "Tibia": (0.086, 0.10), "Tarsus": (0.066, 0.08)}


def fork_half_span(next_segment):
    _, width = JOINT_HOUSINGS[next_segment]
    return width / 2.0 + CHEEK_CLEARANCE + CHEEK_THICKNESS


def spar_end_station(length, next_segment, half_height):
    """Last spar cross-section, widened to meet the fork cheeks clear of the next knuckle."""
    radius, _ = JOINT_HOUSINGS[next_segment]
    return (length - radius - 0.012, fork_half_span(next_segment), half_height)


def add_joint_housing(builder, segment_name):
    radius, width = JOINT_HOUSINGS[segment_name]
    half_width = width / 2.0
    pin_reach = half_width + CHEEK_CLEARANCE + CHEEK_THICKNESS + 0.018
    builder.cylinder("SteelDark", (-half_width, 0.0, 0.0), (half_width, 0.0, 0.0), radius, sides=20)
    builder.cylinder("Brass", (-pin_reach, 0.0, 0.0), (pin_reach, 0.0, 0.0), radius * 0.30, sides=6)
    builder.cylinder("Brass", (-pin_reach - 0.008, 0.0, 0.0), (pin_reach + 0.008, 0.0, 0.0), radius * 0.18, sides=8)


def add_fork(builder, joint_z, next_segment):
    """Clevis cheeks at the far end of a segment that grip the next segment's knuckle."""
    radius, width = JOINT_HOUSINGS[next_segment]
    cheek_radius = radius * 0.92
    for side in (-1.0, 1.0):
        inner_x = side * (width / 2.0 + CHEEK_CLEARANCE)
        outer_x = side * fork_half_span(next_segment)
        middle_x = (inner_x + outer_x) / 2.0
        builder.cylinder("SteelDark", (inner_x, 0.0, joint_z), (outer_x, 0.0, joint_z), cheek_radius, sides=20)
        builder.box("SteelDark", (middle_x, 0.0, joint_z - cheek_radius * 0.9), (CHEEK_THICKNESS, cheek_radius * 1.5, cheek_radius * 1.8))
        builder.bolt_circle("SteelWorn", (outer_x, 0.0, joint_z), (side, 0.0, 0.0), cheek_radius * 0.68, 6, 0.009, 0.008)


def add_spar(builder, stations, material_name="SteelWorn"):
    """Bone-shaped beam through (z, half width, half height) stations."""
    rings = [chamfered_rectangle_ring(half_width, half_height, z) for z, half_width, half_height in stations]
    builder.loft(material_name, rings)


def add_reinforcing_bands(builder, bands):
    for z, half_width, half_height in bands:
        builder.box("SteelDark", (0.0, 0.0, z), (2.0 * half_width + 0.014, 2.0 * half_height + 0.014, 0.026))


def add_piston(builder, base, rod_end, spar_surface_y):
    """Hydraulic ram on the outer face: barrel, brass glands, polished rod and two mounts."""
    base = Vector(base)
    rod_end = Vector(rod_end)
    barrel_end = base.lerp(rod_end, 0.58)
    direction = (rod_end - base).normalized()
    builder.cylinder("SteelDark", base, barrel_end, 0.030, sides=12)
    builder.cylinder("Brass", base - direction * 0.012, base + direction * 0.022, 0.035, sides=12)
    builder.cylinder("Brass", barrel_end - direction * 0.024, barrel_end + direction * 0.008, 0.035, sides=12)
    builder.cylinder("SteelWorn", barrel_end, rod_end, 0.012, sides=8)
    for mount_point in (base, rod_end):
        mount_height = mount_point.y - spar_surface_y + 0.02
        builder.box("SteelWorn", (0.0, spar_surface_y + mount_height / 2.0 - 0.01, mount_point.z), (0.03, mount_height, 0.04))
        builder.cylinder("Brass", (-0.026, mount_point.y, mount_point.z), (0.026, mount_point.y, mount_point.z), 0.011, sides=6)


def add_service_pipe(builder, start_z, end_z, offset_y):
    """Copper line on the inner face that dips into the spar at both ends."""
    span = end_z - start_z
    control_points = (
        (0.0, -0.015, start_z),
        (0.0, offset_y, start_z + 0.10 * span),
        (0.0, offset_y - 0.004, start_z + 0.5 * span),
        (0.0, offset_y, start_z + 0.90 * span),
        (0.0, -0.012, end_z),
    )
    builder.tube("Copper", smooth_path(control_points, 5), 0.008, sides=6)
    for clamp_fraction in (0.3, 0.7):
        builder.box("SteelDark", (0.0, offset_y * 0.7, start_z + clamp_fraction * span), (0.024, abs(offset_y) * 0.9, 0.018))


def add_spur(builder, origin, direction, y_hint, length, half_width, material_name="SteelDark"):
    placement = Matrix.Translation(origin) @ orientation_from_axes(direction, y_hint=y_hint)
    builder.loft(material_name, transform_rings(blade_rings(length, half_width, half_width * 0.32, half_width * 0.4), placement))


def add_serrations(builder, length, base_half_width, bulge):
    """Saw teeth along the inner (-Y) cutting edge of a blade made by blade_rings."""
    for progress in (0.20, 0.30, 0.40, 0.50, 0.60):
        edge_y = bulge * math.sin(math.pi * progress) - base_half_width * (1.0 - progress) ** 0.8
        edge_point = Vector((0.0, edge_y + 0.006, length * progress))
        add_spur(builder, edge_point, Vector((0.0, -0.8, 0.6)), Vector((0.0, 0.6, 0.8)), 0.05, 0.013, "SteelWorn")


def build_coxa_mesh():
    length = SEGMENT_LENGTHS["Coxa"]
    builder = MeshBuilder()
    builder.cylinder("SteelDark", (0.0, -0.058, 0.0), (0.0, 0.058, 0.0), 0.07, sides=20)
    add_spar(builder, [(0.03, 0.042, 0.046), spar_end_station(length, "Femur", 0.050)], "SteelDark")
    add_fork(builder, length, "Femur")
    builder.cylinder("Brass", (0.0, 0.05, 0.05), (0.0, 0.085, 0.10), 0.02, sides=8)
    return builder.to_mesh("LegCoxa")


def build_femur_mesh():
    length = SEGMENT_LENGTHS["Femur"]
    builder = MeshBuilder()
    add_joint_housing(builder, "Femur")
    stations = [
        (0.0, 0.038, 0.056),
        (0.15 * length, 0.030, 0.040),
        (0.50 * length, 0.026, 0.033),
        (0.82 * length, 0.030, 0.040),
        spar_end_station(length, "Tibia", 0.050),
    ]
    add_spar(builder, stations)
    add_fork(builder, length, "Tibia")
    add_reinforcing_bands(builder, [(0.30 * length, 0.028, 0.036), (0.66 * length, 0.028, 0.036)])
    add_piston(builder, (0.0, 0.125, 0.10 * length), (0.0, 0.076, 0.62 * length), spar_surface_y=0.035)
    add_service_pipe(builder, 0.10, 0.66 * length, -0.066)
    return builder.to_mesh("LegFemur")


def build_tibia_mesh():
    length = SEGMENT_LENGTHS["Tibia"]
    builder = MeshBuilder()
    add_joint_housing(builder, "Tibia")
    stations = [
        (0.0, 0.035, 0.048),
        (0.12 * length, 0.028, 0.037),
        (0.50 * length, 0.022, 0.029),
        (0.85 * length, 0.023, 0.030),
        spar_end_station(length, "Tarsus", 0.040),
    ]
    add_spar(builder, stations)
    add_fork(builder, length, "Tarsus")
    add_reinforcing_bands(builder, [(0.28 * length, 0.025, 0.033), (0.55 * length, 0.022, 0.029)])
    add_piston(builder, (0.0, 0.112, 0.07 * length), (0.0, 0.062, 0.46 * length), spar_surface_y=0.031)
    add_service_pipe(builder, 0.32, 0.82 * length, -0.058)
    # Knee spike: rises above the knee in the standing pose.
    add_spur(builder, Vector((0.0, 0.02, 0.0)), Vector((0.0, 0.45, -0.894)), Vector((0.0, 0.894, 0.45)), 0.27, 0.05)
    return builder.to_mesh("LegTibia")


def build_tarsus_mesh():
    length = SEGMENT_LENGTHS["Tarsus"]
    builder = MeshBuilder()
    add_joint_housing(builder, "Tarsus")
    builder.loft("SteelWorn", blade_rings(length, 0.062, 0.022, 0.065))
    add_serrations(builder, length, 0.062, 0.065)
    builder.box("SteelDark", (0.0, 0.02, 0.10), (0.05, 0.13, 0.03))
    # Heel barb: hooks outward and up from the ankle.
    add_spur(builder, Vector((0.0, 0.02, 0.0)), Vector((0.0, 0.5, -0.85)), Vector((0.0, 0.85, 0.5)), 0.15, 0.035)
    return builder.to_mesh("LegTarsus")


def build_segment_meshes():
    return {
        "Coxa": build_coxa_mesh(),
        "Femur": build_femur_mesh(),
        "Tibia": build_tibia_mesh(),
        "Tarsus": build_tarsus_mesh(),
    }


def segment_rest_matrices(leg, rest_pose):
    """Local rest transform of each pivot, keyed by segment name."""
    yaw = Matrix.Rotation(math.radians(leg.yaw_degrees), 4, "Y")
    return {
        "Coxa": Matrix.Translation(leg.hip_position) @ yaw,
        "Femur": Matrix.Translation((0.0, 0.0, SEGMENT_LENGTHS["Coxa"])) @ Matrix.Rotation(rest_pose.femur_bend, 4, "X"),
        "Tibia": Matrix.Translation((0.0, 0.0, SEGMENT_LENGTHS["Femur"])) @ Matrix.Rotation(rest_pose.tibia_bend, 4, "X"),
        "Tarsus": Matrix.Translation((0.0, 0.0, SEGMENT_LENGTHS["Tibia"])) @ Matrix.Rotation(rest_pose.tarsus_bend, 4, "X"),
    }


def build_leg(body, leg, rest_pose, segment_meshes):
    """Chain Coxa > Femur > Tibia > Tarsus > Tip under Body; returns the pivots by segment."""
    rest_matrices = segment_rest_matrices(leg, rest_pose)
    pivots = {}
    parent = body
    for segment_name in SEGMENT_NAMES:
        pivot = create_node(f"{leg.name}_{segment_name}", parent, rest_matrices[segment_name])
        create_node(f"{leg.name}_{segment_name}Mesh", pivot, Matrix.Identity(4), segment_meshes[segment_name])
        pivots[segment_name] = pivot
        parent = pivot
    pivots["Tip"] = create_node(f"{leg.name}_Tip", parent, Matrix.Translation((0.0, 0.0, SEGMENT_LENGTHS["Tarsus"])))
    return pivots
