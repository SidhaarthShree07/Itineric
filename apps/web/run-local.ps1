$ErrorActionPreference = 'Stop'

$vite = Join-Path $PSScriptRoot 'node_modules\.bin\vite.cmd'
& $vite --host 127.0.0.1 --port 5173 --strictPort
exit $LASTEXITCODE
