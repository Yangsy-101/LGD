@echo off
setlocal
cd /d "%~dp0"
title LEO Satellite Platform Backend

where python >nul 2>&1
if errorlevel 1 (
    echo Python was not found. Please install Python or add it to PATH.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$client = New-Object Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1', 8090); $client.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
    echo Backend server is already running at http://127.0.0.1:8090
    pause
    exit /b 0
)

echo Starting backend server...
echo URL: http://127.0.0.1:8090
echo Close this window to stop the server.
echo.

python backend\server.py

echo.
echo Backend server stopped.
pause
