$ErrorActionPreference = 'Stop'

$wrangler = Join-Path $PSScriptRoot 'node_modules\.bin\wrangler.cmd'
& $wrangler dev --port 8787 --local
exit $LASTEXITCODE
