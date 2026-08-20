@echo off
REM DeepSeek Harness Windows Startup Script - Updated Version
chcp 65001 >nul 2>&1

echo.
echo [INFO] Starting DeepSeek Harness...
echo.

cd /d "%~dp0"

REM Install dependencies
echo [STEP] Installing dependencies...
call pnpm install
if errorlevel 1 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)
echo [SUCCESS] Dependencies installed
echo.

REM Build project
echo [STEP] Building project...
echo [INFO] This may take a few minutes for the first time...
call pnpm run build
if errorlevel 1 (
    echo [ERROR] Failed to build project
    pause
    exit /b 1
)
echo [SUCCESS] Build completed successfully
echo.

REM Start web interface
echo [STEP] Starting web interface...
echo [INFO] Web interface: http://127.0.0.1:3080
echo [INFO] Press Ctrl+C to stop
echo.
call pnpm dsh web

REM If script exits normally
echo.
echo [INFO] DeepSeek Harness has stopped
pause
