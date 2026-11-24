"""Worn-metal textures painted with numpy, and the glTF-safe materials that use them.

All metals share one set of wear masks, so rust, roughness and relief line up
wherever two metals meet. The textures tile, which suits the box-projected UVs.
"""

from dataclasses import dataclass

import bpy
import numpy

FULL_TEXTURE_SIZE = 1024


@dataclass(frozen=True)
class SurfaceLayers:
    mottle: numpy.ndarray
    grime: numpy.ndarray
    scratches: numpy.ndarray
    pits: numpy.ndarray


@dataclass(frozen=True)
class MetalPalette:
    material_name: str
    base: tuple
    highlight: tuple
    grime: tuple
    scratch: tuple
    polished: bool
    half_size: bool
    normal_strength: float


@dataclass(frozen=True)
class PlainMaterial:
    material_name: str
    color: tuple
    metallic: float
    roughness: float


# Colours are sRGB, as painted into the textures.
METAL_PALETTES = (
    MetalPalette("SteelDark", (0.075, 0.105, 0.155), (0.17, 0.235, 0.32), (0.32, 0.15, 0.065), (0.40, 0.45, 0.50), False, False, 1.0),
    MetalPalette("SteelWorn", (0.23, 0.225, 0.22), (0.40, 0.39, 0.38), (0.36, 0.17, 0.06), (0.66, 0.65, 0.62), False, True, 0.9),
    MetalPalette("Brass", (0.64, 0.45, 0.16), (0.85, 0.67, 0.29), (0.25, 0.18, 0.07), (0.93, 0.82, 0.48), True, True, 0.6),
    MetalPalette("Copper", (0.60, 0.29, 0.16), (0.82, 0.47, 0.28), (0.15, 0.29, 0.24), (0.93, 0.62, 0.42), True, True, 0.6),
)

PLAIN_MATERIALS = (
    PlainMaterial("CableRed", (0.58, 0.085, 0.065), 0.0, 0.6),
    PlainMaterial("Rubber", (0.035, 0.035, 0.04), 0.0, 0.55),
    PlainMaterial("Soot", (0.012, 0.012, 0.012), 0.0, 1.0),
)

EYE_COLOR = (0.85, 0.36, 0.04)
EYE_EMISSION_COLOR = (1.0, 0.50, 0.05)
EYE_EMISSION_STRENGTH = 3.0


def srgb_to_linear(color):
    linear = []
    for channel in color:
        if channel <= 0.04045:
            linear.append(channel / 12.92)
        else:
            linear.append(((channel + 0.055) / 1.055) ** 2.4)
    return tuple(linear)


def smoothstep(edge_low, edge_high, values):
    scaled = numpy.clip((values - edge_low) / (edge_high - edge_low), 0.0, 1.0)
    return scaled * scaled * (3.0 - 2.0 * scaled)


def tileable_noise(size, falloff, seed):
    """Fractal noise made in the frequency domain, so it wraps seamlessly."""
    generator = numpy.random.default_rng(seed)
    white_noise = generator.standard_normal((size, size))
    frequency_x = numpy.fft.fftfreq(size)[None, :]
    frequency_y = numpy.fft.fftfreq(size)[:, None]
    frequency = numpy.sqrt(frequency_x**2 + frequency_y**2)
    frequency[0, 0] = 1.0
    spectrum = numpy.fft.fft2(white_noise) / frequency**falloff
    spectrum[0, 0] = 0.0
    noise = numpy.real(numpy.fft.ifft2(spectrum))
    low, high = numpy.percentile(noise, (1.0, 99.0))
    return numpy.clip((noise - low) / (high - low), 0.0, 1.0)


def scratch_layer(size, scratch_count, seed):
    """Thin straight scratches that wrap around the texture edges."""
    generator = numpy.random.default_rng(seed)
    starts = generator.uniform(0.0, size, (scratch_count, 2))
    angles = generator.uniform(0.0, 2.0 * numpy.pi, scratch_count)
    lengths = generator.uniform(0.02, 0.18, scratch_count) * size
    strengths = generator.uniform(0.25, 1.0, scratch_count)
    steps = numpy.arange(int(0.18 * size))[None, :]
    active = steps < lengths[:, None]
    columns = (starts[:, 0, None] + numpy.cos(angles)[:, None] * steps) % size
    rows = (starts[:, 1, None] + numpy.sin(angles)[:, None] * steps) % size
    values = numpy.broadcast_to(strengths[:, None], active.shape)
    layer = numpy.zeros((size, size))
    numpy.maximum.at(layer, (rows.astype(int)[active], columns.astype(int)[active]), values[active])
    softened = (layer + numpy.roll(layer, 1, axis=0) * 0.5 + numpy.roll(layer, 1, axis=1) * 0.5) / 2.0
    return numpy.clip(softened, 0.0, 1.0)


def build_surface_layers(size):
    mottle = tileable_noise(size, 1.5, seed=11)
    blotches = tileable_noise(size, 2.1, seed=23)
    breakup = tileable_noise(size, 1.1, seed=37)
    grime = smoothstep(0.50, 0.74, blotches * 0.72 + breakup * 0.28)
    scratches = scratch_layer(size, 380, seed=51)
    pits = smoothstep(0.82, 0.96, tileable_noise(size, 0.8, seed=67))
    return SurfaceLayers(mottle=mottle, grime=grime, scratches=scratches, pits=pits)


def lerp_colors(first, second, amount):
    return first + (second - first) * amount[..., None]


def metal_color_pixels(layers, palette):
    base = numpy.array(palette.base)
    color = lerp_colors(base, numpy.array(palette.highlight), layers.mottle * 0.8)
    color = lerp_colors(color, numpy.array(palette.grime), layers.grime * 0.85)
    color = lerp_colors(color, base * 0.45, layers.pits * 0.45)
    return lerp_colors(color, numpy.array(palette.scratch), layers.scratches * 0.35)


def surface_response_pixels(layers, polished):
    """Packed glTF metallic-roughness texture: green is roughness, blue is metallic."""
    base_roughness = 0.30 if polished else 0.50
    base_metallic = 0.95 if polished else 0.80
    roughness = base_roughness + (layers.mottle - 0.5) * 0.22 + layers.grime * 0.34 - layers.scratches * 0.18
    metallic = base_metallic * (1.0 - layers.grime * 0.6)
    occlusion = numpy.ones_like(roughness)
    return numpy.dstack((occlusion, numpy.clip(roughness, 0.05, 1.0), numpy.clip(metallic, 0.0, 1.0)))


def relief_normal_pixels(layers, strength):
    height = layers.mottle * 0.3 + layers.grime * 0.25 - layers.scratches * 0.45 - layers.pits * 0.7
    slope_x = (numpy.roll(height, -1, axis=1) - numpy.roll(height, 1, axis=1)) * strength
    slope_y = (numpy.roll(height, -1, axis=0) - numpy.roll(height, 1, axis=0)) * strength
    normal = numpy.dstack((-slope_x, -slope_y, numpy.ones_like(height)))
    normal /= numpy.linalg.norm(normal, axis=2, keepdims=True)
    return normal * 0.5 + 0.5


def halve(pixels):
    height, width, channels = pixels.shape
    return pixels.reshape(height // 2, 2, width // 2, 2, channels).mean(axis=(1, 3))


def save_texture(texture_directory, name, pixels, is_color):
    height, width, _ = pixels.shape
    image = bpy.data.images.new(name, width=width, height=height, alpha=False)
    # Set the colour space first: changing it later regenerates the blank image.
    if not is_color:
        image.colorspace_settings.name = "Non-Color"
    rgba = numpy.ones((height, width, 4), dtype=numpy.float32)
    rgba[..., :3] = numpy.clip(pixels, 0.0, 1.0)
    image.pixels.foreach_set(rgba.ravel())
    image.filepath_raw = str(texture_directory / f"{name}.png")
    image.file_format = "PNG"
    image.save()
    return image


def new_principled_material(material_name):
    material = bpy.data.materials.new(material_name)
    material.use_nodes = True
    material.use_backface_culling = True
    nodes = material.node_tree.nodes
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    principled = nodes.new("ShaderNodeBsdfPrincipled")
    material.node_tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
    return material, principled


def image_node(material, image):
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = image
    return node


def create_metal_material(palette, color_image, response_image, relief_image):
    material, principled = new_principled_material(palette.material_name)
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    color_node = image_node(material, color_image)
    links.new(color_node.outputs["Color"], principled.inputs["Base Color"])
    response_node = image_node(material, response_image)
    separate = nodes.new("ShaderNodeSeparateColor")
    links.new(response_node.outputs["Color"], separate.inputs["Color"])
    links.new(separate.outputs["Green"], principled.inputs["Roughness"])
    links.new(separate.outputs["Blue"], principled.inputs["Metallic"])
    relief_node = image_node(material, relief_image)
    normal_map = nodes.new("ShaderNodeNormalMap")
    normal_map.inputs["Strength"].default_value = palette.normal_strength
    links.new(relief_node.outputs["Color"], normal_map.inputs["Color"])
    links.new(normal_map.outputs["Normal"], principled.inputs["Normal"])


def create_plain_material(plain):
    material, principled = new_principled_material(plain.material_name)
    principled.inputs["Base Color"].default_value = (*srgb_to_linear(plain.color), 1.0)
    principled.inputs["Metallic"].default_value = plain.metallic
    principled.inputs["Roughness"].default_value = plain.roughness


def create_eye_material():
    material, principled = new_principled_material("EyeGlow")
    principled.inputs["Base Color"].default_value = (*srgb_to_linear(EYE_COLOR), 1.0)
    principled.inputs["Roughness"].default_value = 0.25
    principled.inputs["Emission Color"].default_value = (*srgb_to_linear(EYE_EMISSION_COLOR), 1.0)
    principled.inputs["Emission Strength"].default_value = EYE_EMISSION_STRENGTH


def create_spider_materials(texture_directory):
    texture_directory.mkdir(parents=True, exist_ok=True)
    layers = build_surface_layers(FULL_TEXTURE_SIZE)
    rough_response = save_texture(texture_directory, "metal_rough_response", surface_response_pixels(layers, polished=False), is_color=False)
    polished_response = save_texture(texture_directory, "metal_polished_response", halve(surface_response_pixels(layers, polished=True)), is_color=False)
    relief = save_texture(texture_directory, "metal_relief_normal", relief_normal_pixels(layers, strength=4.0), is_color=False)
    for palette in METAL_PALETTES:
        color_pixels = metal_color_pixels(layers, palette)
        if palette.half_size:
            color_pixels = halve(color_pixels)
        color_image = save_texture(texture_directory, f"{palette.material_name.lower()}_color", color_pixels, is_color=True)
        response_image = polished_response if palette.polished else rough_response
        create_metal_material(palette, color_image, response_image, relief)
    for plain in PLAIN_MATERIALS:
        create_plain_material(plain)
    create_eye_material()
