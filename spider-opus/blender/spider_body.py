"""Body of the spider: armoured hull, head with eye lamps, winch boiler and exhaust stacks.

Coordinates are relative to the Body node in the glTF frame (Y up, +Z forward,
+X is the spider's left). Hull angles are measured from straight ahead (+Z)
toward the left (+X).
"""

import math

from mathutils import Matrix, Vector

from mesh_builder import MeshBuilder, blade_rings, create_node, orientation_from_axes, smooth_path, transform_rings
from spider_spec import BODY_REST_HEIGHT, LEG_SPECS

HULL_RADIUS_X = 0.70
HULL_RADIUS_Z = 0.84
HULL_SIDES = 64

# (radius fraction, height, material of the surface up to the next point),
# from the bottom centre round the rim to the top centre.
HULL_PROFILE = (
    (0.00, -0.300, "SteelDark"),
    (0.34, -0.300, "SteelDark"),
    (0.62, -0.245, "SteelDark"),
    (0.84, -0.150, "SteelDark"),
    (0.97, -0.060, "SteelWorn"),
    (1.03, -0.055, "SteelWorn"),
    (1.03, 0.065, "SteelWorn"),
    (0.97, 0.070, "SteelDark"),
    (0.93, 0.115, "SteelDark"),
    (0.80, 0.215, "SteelDark"),
    (0.62, 0.300, "SteelDark"),
    (0.40, 0.365, "SteelDark"),
    (0.20, 0.400, "SteelDark"),
    (0.00, 0.410, "SteelDark"),
)
DOME_PROFILE = tuple((radius, height) for radius, height, _ in HULL_PROFILE[7:])

BOILER_CENTER = Vector((0.0, 0.56, -0.30))
BOILER_RADIUS = 0.27
BOILER_HALF_LENGTH = 0.58
# Drum lathe as fractions of BOILER_RADIUS and BOILER_HALF_LENGTH:
# (radius, position along the drum axis, material up to the next point).
BOILER_PROFILE = (
    (0.00, -1.00, "SteelDark"),
    (0.65, -1.00, "SteelDark"),
    (0.91, -0.95, "SteelDark"),
    (1.00, -0.86, "SteelDark"),
    (1.00, -0.43, "Brass"),
    (1.15, -0.43, "Brass"),
    (1.15, -0.37, "Brass"),
    (0.74, -0.37, "SteelWorn"),
    (0.74, 0.37, "Brass"),
    (1.15, 0.37, "Brass"),
    (1.15, 0.43, "Brass"),
    (1.00, 0.43, "SteelDark"),
    (1.00, 0.86, "SteelDark"),
    (0.91, 0.95, "SteelDark"),
    (0.65, 1.00, "SteelDark"),
    (0.00, 1.00, "SteelDark"),
)
CABLE_RADIUS = 0.026

STACK_LENGTH = 0.40
STACK_PROFILE = (
    (0.000, 0.00, "Brass"),
    (0.105, 0.00, "Brass"),
    (0.105, 0.04, "Brass"),
    (0.074, 0.06, "SteelDark"),
    (0.070, 0.31, "Brass"),
    (0.091, 0.35, "Brass"),
    (0.096, 0.40, "SteelWorn"),
    (0.070, 0.40, "Soot"),
    (0.062, 0.26, "Soot"),
    (0.000, 0.26, "Soot"),
)
# Stack name, steam vent name, side (+1 is the spider's left).
STACKS = (("Stack1", "SteamVent1", 1.0), ("Stack2", "SteamVent2", -1.0))

HEAD_PIVOT = Vector((0.0, -0.13, 0.62))
SKULL_CENTER = Vector((0.0, -0.07, 0.12))
SKULL_RADII = (0.36, 0.15, 0.30)
# Eye lamps: (angle from straight ahead in degrees, height in head space, lens radius, hooded).
# The main row is hooded; the small lower lamps are bare.
EYE_LAMPS = (
    (55.0, -0.060, 0.034, True),
    (34.0, -0.060, 0.045, True),
    (12.0, -0.060, 0.054, True),
    (-12.0, -0.060, 0.054, True),
    (-34.0, -0.060, 0.045, True),
    (-55.0, -0.060, 0.034, True),
    (42.0, -0.150, 0.022, False),
    (20.0, -0.150, 0.026, False),
    (-20.0, -0.150, 0.026, False),
    (-42.0, -0.150, 0.022, False),
)
HOOD_SLANT_DEGREES = 20.0


def split_profile(profile):
    points = [(radius, height) for radius, height, _ in profile]
    span_materials = [material for _, _, material in profile[:-1]]
    return points, span_materials


def dome_height(radius_fraction):
    """Height of the upper hull at a radius fraction, interpolated along DOME_PROFILE."""
    for (outer_radius, outer_height), (inner_radius, inner_height) in zip(DOME_PROFILE, DOME_PROFILE[1:]):
        if inner_radius <= radius_fraction <= outer_radius:
            blend = (radius_fraction - inner_radius) / (outer_radius - inner_radius)
            return inner_height + (outer_height - inner_height) * blend
    return DOME_PROFILE[0][1]


def hull_point(angle_degrees, radius_fraction, height):
    angle = math.radians(angle_degrees)
    return Vector((HULL_RADIUS_X * radius_fraction * math.sin(angle), height, HULL_RADIUS_Z * radius_fraction * math.cos(angle)))


def outward_direction(angle_degrees):
    angle = math.radians(angle_degrees)
    return Vector((math.sin(angle), 0.0, math.cos(angle)))


def boiler_point(axial_fraction, radius, angle_degrees):
    """Point on a circle round the drum axis; angle 0 faces forward, 90 faces up."""
    angle = math.radians(angle_degrees)
    offset = Vector((axial_fraction * BOILER_HALF_LENGTH, radius * math.sin(angle), radius * math.cos(angle)))
    return BOILER_CENTER + offset


def arc_extrusion(builder, material_name, cross_section, start_degrees, end_degrees, steps):
    """Sweep a (radius fraction, height) polygon around the hull between two angles."""
    rings = []
    for step in range(steps + 1):
        angle = start_degrees + (end_degrees - start_degrees) * step / steps
        rings.append([hull_point(angle, radius_fraction, height) for radius_fraction, height in cross_section])
    builder.loft(material_name, rings)


def add_flange(builder, end_point, inner_point, pipe_radius):
    direction = (inner_point - end_point).normalized()
    builder.cylinder("Brass", end_point, end_point + direction * 0.03, pipe_radius * 1.7, sides=10)


def add_pipe(builder, material_name, control_points, radius, with_flanges=True):
    path = smooth_path(control_points)
    builder.tube(material_name, path, radius, sides=10)
    if with_flanges:
        add_flange(builder, path[0], path[1], radius)
        add_flange(builder, path[-1], path[-2], radius)


def add_hull_shell(builder):
    points, span_materials = split_profile(HULL_PROFILE)
    builder.lathe(span_materials, points, HULL_SIDES, radial_scale=(HULL_RADIUS_X, HULL_RADIUS_Z))


def add_dome_ribs(builder):
    """Plate seams along the dome meridians, with rivet pairs beside them."""
    rib_fractions = (0.30, 0.45, 0.62, 0.80, 0.93, 1.0)
    for rib_index in range(12):
        angle = 15.0 + 30.0 * rib_index
        path = [hull_point(angle, fraction, dome_height(fraction) + 0.004) for fraction in rib_fractions]
        builder.tube("SteelWorn", smooth_path(path, 3), 0.013, sides=6)
        for fraction in (0.52, 0.70, 0.86):
            for offset in (-4.0, 4.0):
                builder.rivet("Brass", hull_point(angle + offset, fraction, dome_height(fraction) + 0.007), 0.013)


def armour_plate_cross_section(inner_fraction, outer_fraction, thickness):
    fractions = [inner_fraction + (outer_fraction - inner_fraction) * step / 4 for step in range(5)]
    underside = [(fraction, dome_height(fraction) - 0.01) for fraction in fractions]
    topside = [(fraction, dome_height(fraction) + thickness) for fraction in reversed(fractions)]
    return underside + topside


def add_armour_plates(builder):
    cross_section = armour_plate_cross_section(0.50, 0.955, 0.028)
    for center in (30.0, 90.0, 150.0, 210.0, 270.0, 330.0):
        arc_extrusion(builder, "SteelDark", cross_section, center - 12.5, center + 12.5, 6)
        for offset in (-9.0, 9.0):
            for fraction in (0.58, 0.88):
                builder.rivet("Brass", hull_point(center + offset, fraction, dome_height(fraction) + 0.031), 0.014)


def add_rim_rivets(builder):
    for step in range(56):
        builder.rivet("Brass", hull_point(360.0 * step / 56, 1.035, 0.005), 0.015)


def add_brow_visor(builder):
    """Heavy armoured brow over the eyes, with two horns rising from it."""
    cross_section = ((0.92, 0.08), (1.16, -0.04), (1.19, -0.005), (1.16, 0.04), (0.92, 0.16))
    arc_extrusion(builder, "SteelDark", cross_section, -62.0, 62.0, 24)
    for angle in range(-50, 51, 10):
        builder.rivet("Brass", hull_point(angle, 1.10, 0.04), 0.014)
    for side in (-1.0, 1.0):
        base = hull_point(side * 24.0, 1.02, 0.09)
        direction = Vector((side * 0.25, 0.60, 0.75)).normalized()
        builder.cone("SteelWorn", base, base + direction * 0.26, 0.042, sides=7)


def add_back_spikes(builder):
    for angle in (105.0, 130.0, 155.0, 180.0, 205.0, 230.0, 255.0):
        base = hull_point(angle, 0.88, dome_height(0.88) - 0.01)
        direction = (outward_direction(angle) * 0.8 + Vector((0.0, 0.6, 0.0))).normalized()
        length = 0.32 if angle == 180.0 else 0.24
        builder.cone("SteelWorn", base, base + direction * length, 0.04, sides=7)


def add_hip_sockets(builder):
    """Fixed clamp plates the coxa turrets turn between."""
    for leg in LEG_SPECS:
        hip = Vector(leg.hip_position)
        yaw = Matrix.Rotation(math.radians(leg.yaw_degrees), 4, "Y")
        outward = yaw @ Vector((0.0, 0.0, 1.0))
        builder.cylinder("SteelWorn", hip + Vector((0.0, 0.060, 0.0)), hip + Vector((0.0, 0.090, 0.0)), 0.095, sides=20)
        builder.cylinder("SteelWorn", hip - Vector((0.0, 0.090, 0.0)), hip - Vector((0.0, 0.060, 0.0)), 0.095, sides=20)
        builder.cylinder("Brass", hip - Vector((0.0, 0.11, 0.0)), hip + Vector((0.0, 0.11, 0.0)), 0.032, sides=8)
        builder.box("SteelDark", hip - outward * 0.08, (0.22, 0.20, 0.14), yaw)
        builder.bolt_circle("SteelDark", hip + Vector((0.0, 0.090, 0.0)), (0.0, 1.0, 0.0), 0.07, 6, 0.011, 0.011)


def add_belly_machinery(builder):
    builder.cylinder("SteelDark", (0.0, -0.29, 0.0), (0.0, -0.39, 0.0), 0.30, sides=32)
    builder.cylinder("Brass", (0.0, -0.295, 0.0), (0.0, -0.318, 0.0), 0.32, sides=32)
    builder.cylinder("SteelWorn", (0.0, -0.39, 0.0), (0.0, -0.44, 0.0), 0.13, sides=20)
    builder.bolt_circle("Brass", (0.0, -0.39, 0.0), (0.0, -1.0, 0.0), 0.23, 12, 0.018, 0.015)
    for side in (-1.0, 1.0):
        for depth in (-0.14, 0.14):
            control_points = (
                (side * 0.27, -0.36, depth),
                (side * 0.45, -0.37, depth * 1.3),
                (side * 0.58, -0.24, depth * 1.6),
                (side * 0.62, -0.11, depth * 1.8),
            )
            add_pipe(builder, "Copper", control_points, 0.024)


def add_boiler_cradle(builder):
    for side in (-1.0, 1.0):
        saddle_x = side * 0.66 * BOILER_HALF_LENGTH
        builder.box("SteelWorn", BOILER_CENTER + Vector((saddle_x, -0.17, 0.0)), (0.06, 0.26, 0.48))
        builder.box("SteelDark", BOILER_CENTER + Vector((saddle_x, -0.30, 0.0)), (0.10, 0.035, 0.54))


def add_vent_grille(builder):
    """Recessed vent with brass slats on the front of the dome."""
    tilt = Matrix.Rotation(math.radians(19.0), 4, "X")
    frame = Matrix.Translation(hull_point(0.0, 0.50, dome_height(0.50) + 0.006)) @ tilt
    builder.box("SteelWorn", frame @ Vector((0.0, 0.0, 0.0)), (0.22, 0.03, 0.17), tilt)
    builder.box("Soot", frame @ Vector((0.0, 0.004, 0.0)), (0.18, 0.03, 0.13), tilt)
    for slat_index in range(4):
        slat_x = -0.06 + 0.04 * slat_index
        builder.box("Brass", frame @ Vector((slat_x, 0.012, 0.0)), (0.016, 0.03, 0.12), tilt)


def add_steam_pipes(builder):
    for side in (-1.0, 1.0):
        control_points = (
            boiler_point(side * 0.72, BOILER_RADIUS, -35.0),
            (side * 0.45, 0.36, 0.03),
            (side * 0.52, 0.27, 0.13),
            (side * 0.53, 0.215, 0.18),
        )
        add_pipe(builder, "Copper", control_points, 0.028)


def add_red_cables(builder):
    """Cables paid out from the winch drum over the dome to eyelets on the brow."""
    for side in (-1.0, 1.0):
        control_points = (
            (side * 0.09, 0.66, -0.10),
            (side * 0.13, 0.50, 0.12),
            (side * 0.19, 0.40, 0.40),
            (side * 0.20, 0.27, 0.66),
            (side * 0.20, 0.17, 0.79),
        )
        builder.tube("CableRed", smooth_path(control_points), 0.024, sides=8)
        eyelet = Vector(control_points[-1])
        builder.cylinder("Brass", eyelet - Vector((0.0, 0.035, 0.0)), eyelet + Vector((0.0, 0.035, 0.0)), 0.038, sides=10)


def add_hip_hoses(builder):
    for leg in LEG_SPECS:
        hip = Vector(leg.hip_position)
        start = hip * 0.70
        start.y = dome_height(0.72)
        control_points = (start, hip * 0.88 + Vector((0.0, 0.27, 0.0)), hip + Vector((0.0, 0.12, 0.0)))
        builder.tube("Rubber", smooth_path(control_points), 0.019, sides=8)


def add_antennae(builder):
    for side, length in ((1.0, 0.65), (-1.0, 0.50)):
        fraction = 0.70
        base = hull_point(side * 35.0, fraction, dome_height(fraction))
        direction = Vector((side * 0.3, 1.0, -0.35)).normalized()
        builder.cylinder("Brass", base - direction * 0.01, base + direction * 0.05, 0.025, sides=8)
        builder.cone("SteelWorn", base + direction * 0.05, base + direction * length, 0.009, sides=5)


def build_hull_mesh():
    builder = MeshBuilder()
    add_hull_shell(builder)
    add_dome_ribs(builder)
    add_armour_plates(builder)
    add_rim_rivets(builder)
    add_brow_visor(builder)
    add_back_spikes(builder)
    add_hip_sockets(builder)
    add_belly_machinery(builder)
    add_boiler_cradle(builder)
    add_vent_grille(builder)
    add_steam_pipes(builder)
    add_red_cables(builder)
    add_hip_hoses(builder)
    add_antennae(builder)
    return builder.to_mesh("Hull")


def add_cable_winding(builder):
    """Red cable wound round the winch core, with a partial second layer."""
    core_radius = 0.74 * BOILER_RADIUS
    core_half_length = 0.37 * BOILER_HALF_LENGTH - CABLE_RADIUS
    layers = (
        (core_radius + CABLE_RADIUS, -core_half_length, core_half_length, 7.0),
        (core_radius + 2.8 * CABLE_RADIUS, -0.6 * core_half_length, 0.4 * core_half_length, 3.6),
    )
    for radius, start_x, end_x, turns in layers:
        sample_count = int(turns * 16)
        path = []
        for index in range(sample_count + 1):
            progress = index / sample_count
            angle = 2.0 * math.pi * turns * progress
            path.append(Vector((start_x + (end_x - start_x) * progress, radius * math.cos(angle), radius * math.sin(angle))))
        builder.tube("CableRed", path, CABLE_RADIUS, sides=6)


def add_boiler_end_details(builder):
    for side in (-1.0, 1.0):
        end_center = Vector((side * BOILER_HALF_LENGTH, 0.0, 0.0))
        builder.bolt_circle("Brass", end_center, (side, 0.0, 0.0), 0.13, 8, 0.016, 0.014)
        builder.cylinder("SteelWorn", end_center, end_center + Vector((side * 0.035, 0.0, 0.0)), 0.07, sides=16)
        for band_fraction in (0.55, 0.80):
            band_x = side * band_fraction * BOILER_HALF_LENGTH
            builder.cylinder("Brass", (band_x - 0.014, 0.0, 0.0), (band_x + 0.014, 0.0, 0.0), 1.035 * BOILER_RADIUS, sides=40)
        valve_base = boiler_point(side * 0.66, BOILER_RADIUS * 0.99, 55.0) - BOILER_CENTER
        builder.cylinder("Brass", valve_base, valve_base + Vector((0.0, 0.08, 0.03)), 0.025, sides=8)
        builder.sphere("Brass", valve_base + Vector((0.0, 0.10, 0.04)), 0.035, segments=10, rings=6)
    add_valve_wheel(builder)
    add_pressure_gauge(builder)


def add_valve_wheel(builder):
    hub = Vector((BOILER_HALF_LENGTH + 0.10, 0.0, 0.0))
    builder.cylinder("Brass", (BOILER_HALF_LENGTH + 0.03, 0.0, 0.0), hub, 0.02, sides=8)
    rim_path = []
    for index in range(25):
        angle = 2.0 * math.pi * index / 24
        rim_path.append(hub + Vector((0.0, 0.10 * math.cos(angle), 0.10 * math.sin(angle))))
    builder.tube("Brass", rim_path, 0.013, sides=6)
    for spoke_index in range(4):
        angle = math.pi * spoke_index / 2 + math.pi / 4
        builder.cylinder("Brass", hub, hub + Vector((0.0, 0.095 * math.cos(angle), 0.095 * math.sin(angle))), 0.009, sides=5)


def add_pressure_gauge(builder):
    end_x = -BOILER_HALF_LENGTH
    builder.cylinder("Brass", (end_x - 0.03, 0.07, 0.07), (end_x - 0.07, 0.09, 0.09), 0.016, sides=6)
    builder.cylinder("Brass", (end_x - 0.07, 0.09, 0.09), (end_x - 0.10, 0.09, 0.09), 0.065, sides=18)
    builder.cylinder("SteelWorn", (end_x - 0.10, 0.09, 0.09), (end_x - 0.106, 0.09, 0.09), 0.054, sides=18)


def build_boiler_mesh():
    """Winch drum around the local X axis, centred on the Boiler node."""
    builder = MeshBuilder()
    points = [(radius * BOILER_RADIUS, axial * BOILER_HALF_LENGTH) for radius, axial, _ in BOILER_PROFILE]
    span_materials = [material for _, _, material in BOILER_PROFILE[:-1]]
    drum_axis_along_x = Matrix.Rotation(math.radians(-90.0), 4, "Z")
    builder.lathe(span_materials, points, 44, placement=drum_axis_along_x)
    add_cable_winding(builder)
    add_boiler_end_details(builder)
    return builder.to_mesh("Boiler")


def build_stack_mesh():
    """Exhaust stack along local +Y with a sooty bore; the vent sits at its mouth."""
    builder = MeshBuilder()
    points, span_materials = split_profile(STACK_PROFILE)
    builder.lathe(span_materials, points, 20)
    builder.bolt_circle("SteelDark", (0.0, 0.04, 0.0), (0.0, 1.0, 0.0), 0.09, 6, 0.01, 0.011)
    return builder.to_mesh("Stack")


def build_stacks(body):
    stack_mesh = build_stack_mesh()
    for stack_name, vent_name, side in STACKS:
        base = boiler_point(side * 0.66, BOILER_RADIUS * 0.95, 130.0)
        axis = Vector((side * 0.10, 0.80, -0.59)).normalized()
        tilt = Vector((0.0, 1.0, 0.0)).rotation_difference(axis).to_matrix().to_4x4()
        stack = create_node(stack_name, body, Matrix.Translation(base) @ tilt, stack_mesh)
        create_node(vent_name, stack, Matrix.Translation((0.0, STACK_LENGTH, 0.0)))


def skull_surface(angle_degrees, height):
    """Point and outward normal on the skull ellipsoid; angle 0 looks straight ahead."""
    vertical = (height - SKULL_CENTER.y) / SKULL_RADII[1]
    ring = math.sqrt(1.0 - vertical * vertical)
    angle = math.radians(angle_degrees)
    offset = Vector((SKULL_RADII[0] * ring * math.sin(angle), height - SKULL_CENTER.y, SKULL_RADII[2] * ring * math.cos(angle)))
    normal = Vector((ring * math.sin(angle) / SKULL_RADII[0], vertical / SKULL_RADII[1], ring * math.cos(angle) / SKULL_RADII[2]))
    return SKULL_CENTER + offset, normal.normalized()


def eye_frame(angle_degrees, height):
    """Placement at an eye socket: local +Z looks out of the skull, +Y leans up."""
    point, normal = skull_surface(angle_degrees, height)
    return Matrix.Translation(point) @ orientation_from_axes(normal, y_hint=(0.0, 1.0, 0.0))


def add_skull(builder):
    builder.cylinder("Brass", (0.0, 0.0, 0.0), (0.0, -0.04, 0.0), 0.20, sides=24)
    builder.cylinder("SteelDark", (0.0, -0.04, 0.0), (0.0, -0.11, 0.0), 0.18, sides=24)
    builder.sphere("SteelDark", SKULL_CENTER, 1.0, segments=32, rings=16, scale=SKULL_RADII)
    for angle in (-78.0, 78.0):
        point, normal = skull_surface(angle, -0.08)
        builder.cylinder("SteelWorn", point - normal * 0.02, point + normal * 0.035, 0.06, sides=12)


def add_eye_sockets(builder):
    """Brass bezels, and slanted hoods over the main row that give the face its scowl."""
    for angle, height, lens_radius, hooded in EYE_LAMPS:
        frame = eye_frame(angle, height)
        builder.cylinder("Brass", frame @ Vector((0.0, 0.0, -0.02)), frame @ Vector((0.0, 0.0, 0.035)), lens_radius * 1.28, sides=14)
        if not hooded:
            continue
        slant = math.copysign(math.radians(HOOD_SLANT_DEGREES), angle)
        hood_frame = frame @ Matrix.Rotation(slant, 4, "Z") @ Matrix.Rotation(math.radians(25.0), 4, "X")
        hood_center = hood_frame @ Vector((0.0, lens_radius * 1.35, 0.03))
        hood_orientation = hood_frame.to_3x3().to_4x4()
        builder.box("SteelDark", hood_center, (lens_radius * 3.0, 0.016, lens_radius * 2.0), hood_orientation)


def add_fangs(builder):
    """Chelicerae: two heavy blades hanging under the face, hooking back toward the mouth."""
    for side in (-1.0, 1.0):
        base = Vector((side * 0.12, -0.18, 0.30))
        direction = Vector((-side * 0.16, -0.92, 0.36))
        placement = Matrix.Translation(base) @ orientation_from_axes(direction, y_hint=(0.0, 0.3, 1.0))
        builder.loft("SteelWorn", transform_rings(blade_rings(0.44, 0.065, 0.024, 0.07), placement))
        builder.cylinder("Brass", base - Vector((0.05, 0.0, 0.0)), base + Vector((0.05, 0.0, 0.0)), 0.032, sides=10)
        builder.sphere("SteelDark", base + Vector((0.0, 0.01, -0.01)), 0.05, segments=10, rings=6)


def add_dangling_hoses(builder):
    hoses = (
        ("Rubber", 0.015, ((-0.23, -0.16, 0.06), (-0.18, -0.39, 0.14), (-0.05, -0.46, 0.18), (0.03, -0.20, 0.14))),
        ("Rubber", 0.015, ((0.23, -0.16, 0.06), (0.20, -0.35, 0.12), (0.09, -0.41, 0.16), (0.0, -0.21, 0.12))),
        ("Rubber", 0.014, ((0.15, -0.19, -0.04), (0.14, -0.44, 0.0), (0.02, -0.50, 0.02), (-0.07, -0.22, -0.02))),
        ("Copper", 0.009, ((-0.14, -0.19, -0.02), (-0.12, -0.52, 0.02), (-0.07, -0.58, 0.03))),
        ("CableRed", 0.010, ((0.06, -0.21, 0.0), (0.07, -0.48, 0.01), (0.08, -0.64, 0.0))),
    )
    for material_name, radius, control_points in hoses:
        builder.tube(material_name, smooth_path(control_points), radius, sides=6)


def build_head_mesh():
    builder = MeshBuilder()
    add_skull(builder)
    add_eye_sockets(builder)
    add_fangs(builder)
    add_dangling_hoses(builder)
    return builder.to_mesh("Head")


def build_eye_lens_mesh():
    """Unit-radius lamp lens bulging along local +Z; each Eye node scales it."""
    builder = MeshBuilder()
    profile = ((0.0, 0.0), (1.0, 0.0), (0.92, 0.20), (0.70, 0.40), (0.38, 0.52), (0.0, 0.56))
    lens_axis_along_z = Matrix.Rotation(math.radians(90.0), 4, "X")
    builder.lathe("EyeGlow", profile, 16, placement=lens_axis_along_z)
    return builder.to_mesh("EyeLens")


def build_head(body):
    head = create_node("Head", body, Matrix.Translation(HEAD_PIVOT), build_head_mesh())
    lens_mesh = build_eye_lens_mesh()
    for eye_number, (angle, height, lens_radius, _hooded) in enumerate(EYE_LAMPS, start=1):
        placement = eye_frame(angle, height) @ Matrix.Translation((0.0, 0.0, 0.03)) @ Matrix.Scale(lens_radius, 4)
        create_node(f"Eye{eye_number}", head, placement, lens_mesh)
    return head


def build_body(spider_node):
    body = create_node("Body", spider_node, Matrix.Translation((0.0, BODY_REST_HEIGHT, 0.0)))
    create_node("Hull", body, Matrix.Identity(4), build_hull_mesh())
    build_head(body)
    create_node("Boiler", body, Matrix.Translation(BOILER_CENTER), build_boiler_mesh())
    build_stacks(body)
    return body
