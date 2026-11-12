@echo off
setlocal
cd /d "%~dp0"

echo Starting CAR DRIVE 3D local server...
start "CAR DRIVE 3D server" /min cmd /c "python -m http.server 8000 --bind 127.0.0.1"
timeout /t 1 /nobreak >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "$url = [uri]::EscapeUriString('http://127.0.0.1:8000/CAR DRIVE 3D ' + [char]0x2014 + ' Night Cockpit.html'); Start-Process $url"

echo.
echo Game opened at:
echo http://127.0.0.1:8000/
echo Keep the server window running while playing.
endlocal
