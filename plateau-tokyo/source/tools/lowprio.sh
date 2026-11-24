#!/usr/bin/env bash
# Run a command at BelowNormal priority (Windows children inherit the class).
WP=$(cat /proc/$$/winpid)
powershell.exe -NoProfile -Command "(Get-Process -Id $WP).PriorityClass='BelowNormal'" >/dev/null 2>&1
exec "$@"
