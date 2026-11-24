# Runs one Blender Python script in the background at below-normal priority and waits for it.
# Usage: powershell -ExecutionPolicy Bypass -File tools/run-blender.ps1 -Script blender/build_assets.py [-Log path] [-ScriptArgs a,b]
param(
    [Parameter(Mandatory = $true)][string]$Script,
    [string]$Log = "",
    [string[]]$ScriptArgs = @()
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$blender = "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
$scriptPath = Join-Path $projectRoot $Script
if ($Log -eq "") {
    $Log = Join-Path $projectRoot ("blender\" + [IO.Path]::GetFileNameWithoutExtension($Script) + ".log")
}

$argumentList = @("--background", "--factory-startup", "--python-exit-code", "1", "--python", "`"$scriptPath`"")
if ($ScriptArgs.Count -gt 0) {
    $argumentList += "--"
    $argumentList += $ScriptArgs
}

$process = Start-Process -FilePath $blender -ArgumentList $argumentList -NoNewWindow -PassThru `
    -RedirectStandardOutput $Log -RedirectStandardError "$Log.err" -WorkingDirectory $projectRoot
# Reading Handle keeps ExitCode available after a redirected, no-window process exits.
$processHandle = $process.Handle
$process.PriorityClass = "BelowNormal"
$process.WaitForExit()
$exitCode = $process.ExitCode
Get-Content $Log -Tail 40
if ((Get-Item "$Log.err").Length -gt 0) {
    Write-Output "--- stderr ---"
    Get-Content "$Log.err" -Tail 40
}
Write-Output "blender exit code: $exitCode"
exit $exitCode
