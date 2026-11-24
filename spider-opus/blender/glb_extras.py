"""Write node extras straight into a GLB's JSON chunk.

Blender custom properties cannot hold nested lists such as a list of
positions, so the extras are added to the exported file instead.
"""

import json
import struct
from pathlib import Path

GLB_MAGIC = b"glTF"
JSON_CHUNK_TYPE = 0x4E4F534A
HEADER_SIZE = 12
CHUNK_HEADER_SIZE = 8


def read_glb(glb_path):
    data = Path(glb_path).read_bytes()
    magic, _version, _total_length = struct.unpack_from("<4sII", data, 0)
    if magic != GLB_MAGIC:
        raise ValueError(f"{glb_path} is not a GLB file")
    json_length, json_type = struct.unpack_from("<II", data, HEADER_SIZE)
    if json_type != JSON_CHUNK_TYPE:
        raise ValueError(f"{glb_path} does not start with a JSON chunk")
    json_start = HEADER_SIZE + CHUNK_HEADER_SIZE
    document = json.loads(data[json_start : json_start + json_length])
    remaining_chunks = data[json_start + json_length :]
    return document, remaining_chunks


def write_glb(glb_path, document, remaining_chunks):
    json_bytes = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * (-len(json_bytes) % 4)
    total_length = HEADER_SIZE + CHUNK_HEADER_SIZE + len(json_bytes) + len(remaining_chunks)
    header = struct.pack("<4sII", GLB_MAGIC, 2, total_length)
    json_header = struct.pack("<II", len(json_bytes), JSON_CHUNK_TYPE)
    Path(glb_path).write_bytes(header + json_header + json_bytes + remaining_chunks)


def write_node_extras(glb_path, extras_by_node_name):
    document, remaining_chunks = read_glb(glb_path)
    nodes_by_name = {node.get("name"): node for node in document["nodes"]}
    missing = sorted(set(extras_by_node_name) - set(nodes_by_name))
    if missing:
        raise KeyError(f"nodes missing from the export: {missing}")
    for node_name, extras in extras_by_node_name.items():
        nodes_by_name[node_name].setdefault("extras", {}).update(extras)
    write_glb(glb_path, document, remaining_chunks)
