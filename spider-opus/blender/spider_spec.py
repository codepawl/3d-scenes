"""Dimensions and standing pose of the steampunk spider.

Every coordinate here is in the frame the three.js scene receives: Y up, the
spider faces +Z and its left side is +X. Units are scene units.
"""

import math
from dataclasses import dataclass

BODY_REST_HEIGHT = 1.2
# Middle feet land 1.5 either side of the centre: a 3.0 tip-to-tip leg span.
FOOT_REACH_FROM_HIP = 0.78
FEMUR_ELEVATION_DEGREES = 56.0

SEGMENT_NAMES = ("Coxa", "Femur", "Tibia", "Tarsus")
SEGMENT_LENGTHS = {"Coxa": 0.22, "Femur": 1.10, "Tibia": 1.40, "Tarsus": 0.80}

# Left legs from front to back: hip position on the hull rim relative to Body,
# and the yaw about +Y that turns the coxa's local +Z away from the body. Hips
# sit level with the Body origin, so every hip is BODY_REST_HEIGHT above ground.
LEFT_HIPS = (
    ((0.536, 0.0, 0.579), 40.0),
    ((0.72, 0.0, 0.0), 90.0),
    ((0.536, 0.0, -0.579), 140.0),
)


@dataclass(frozen=True)
class LegSpec:
    name: str
    hip_position: tuple
    yaw_degrees: float


@dataclass(frozen=True)
class LegRestPose:
    """Joint bends in radians about each pivot's local +X; positive bends the segment down."""

    femur_bend: float
    tibia_bend: float
    tarsus_bend: float


def build_leg_specs():
    left_legs = []
    right_legs = []
    for index, (hip_position, yaw_degrees) in enumerate(LEFT_HIPS, start=1):
        mirrored_hip = (-hip_position[0], hip_position[1], hip_position[2])
        left_legs.append(LegSpec(f"LegL{index}", hip_position, yaw_degrees))
        right_legs.append(LegSpec(f"LegR{index}", mirrored_hip, -yaw_degrees))
    return tuple(left_legs + right_legs)


LEG_SPECS = build_leg_specs()


def solve_leg_rest_pose():
    """Raise the knee high, then solve tibia and tarsus so the blade tip lands on the ground.

    Works in the leg's vertical plane with the hip at the origin: `outward`
    points away from the body and `up` is world Y. The ankle takes the outward
    bowing solution, so the tarsus blade rakes back in toward the body.
    """
    femur_elevation = math.radians(FEMUR_ELEVATION_DEGREES)
    tibia_length = SEGMENT_LENGTHS["Tibia"]
    tarsus_length = SEGMENT_LENGTHS["Tarsus"]
    knee_outward = SEGMENT_LENGTHS["Coxa"] + SEGMENT_LENGTHS["Femur"] * math.cos(femur_elevation)
    knee_up = SEGMENT_LENGTHS["Femur"] * math.sin(femur_elevation)
    foot_outward = FOOT_REACH_FROM_HIP
    foot_up = -BODY_REST_HEIGHT
    knee_to_foot = math.hypot(foot_outward - knee_outward, foot_up - knee_up)
    knee_corner_cosine = (tibia_length**2 + knee_to_foot**2 - tarsus_length**2) / (2.0 * tibia_length * knee_to_foot)
    knee_corner = math.acos(knee_corner_cosine)
    tibia_elevation = math.atan2(foot_up - knee_up, foot_outward - knee_outward) + knee_corner
    ankle_outward = knee_outward + tibia_length * math.cos(tibia_elevation)
    ankle_up = knee_up + tibia_length * math.sin(tibia_elevation)
    tarsus_elevation = math.atan2(foot_up - ankle_up, foot_outward - ankle_outward)
    # A segment raised by elevation `e` is pitched by -e about its local +X.
    femur_pitch = -femur_elevation
    tibia_pitch = -tibia_elevation
    tarsus_pitch = -tarsus_elevation
    return LegRestPose(
        femur_bend=femur_pitch,
        tibia_bend=tibia_pitch - femur_pitch,
        tarsus_bend=tarsus_pitch - tibia_pitch,
    )
