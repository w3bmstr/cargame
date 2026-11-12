$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $root

Write-Host 'CAR DRIVE 3D server: http://127.0.0.1:8000/'
Write-Host 'Press Ctrl+C to stop the server.'

Start-Process 'http://127.0.0.1:8000/CAR DRIVE 3D — Night Cockpit.html'
python -m http.server 8000 --bind 127.0.0.1
