# Rebuilds every GLB, layout.json and field.bin in assets/ with Blender (below-normal priority).
$ErrorActionPreference = "Stop"
& (Join-Path $PSScriptRoot "run-blender.ps1") -Script "blender/build_assets.py"
exit $LASTEXITCODE
