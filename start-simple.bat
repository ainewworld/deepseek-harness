@echo off
REM Simple and robust startup script
chcp 65001 >nul 2>&1

echo.
echo [INFO] Starting DeepSeek Harness...
echo.

REM Get script directory
cd /d "%~dp0"

REM Check Node.js
echo [STEP] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found
    pause
    exit /b 1
)
echo [INFO] Node.js OK
echo.

REM Check pnpm
echo [STEP] Checking pnpm...
pnpm --version >nul 2>&1
if errorlevel 1 (
    echo [WARNING] pnpm not found, installing...
    call npm install -g pnpm
    if errorlevel 1 (
        echo [ERROR] Failed to install pnpm
        pause
        exit /b 1
    )
)
echo [INFO] pnpm OK
echo.

REM Install dependencies
echo [STEP] Installing dependencies...
call pnpm install
if errorlevel 1 (
    echo [ERROR] Install failed
    pause
    exit /b 1
)
echo [SUCCESS] Dependencies installed
echo.

REM Build project
echo [STEP] Building project...
call pnpm run build
if errorlevel 1 (
    echo [ERROR] Build failed
    pause
    exit /b 1
)
echo [SUCCESS] Build completed
echo.

REM Start web interface
echo [STEP] Starting web interface...
echo [INFO] Web interface: http://127.0.0.1:3080
echo [INFO] Press Ctrl+C to stop
echo.
call pnpm dsh web

echo.
echo [INFO] Stopped
pause
