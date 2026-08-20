@echo off
REM Development Mode Startup Script for DeepSeek Harness
REM This script starts the web interface in development mode with hot reload

REM Set UTF-8 encoding
chcp 65001 >nul 2>&1

set "INFO=[INFO]"
set "SUCCESS=[SUCCESS]"
set "WARNING=[WARNING]"
set "ERROR=[ERROR]"

echo.
echo %INFO% Development Mode - DeepSeek Harness
echo.

REM Get script directory
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

REM Check if dependencies are installed
if not exist "node_modules" (
    echo %WARNING% Dependencies not found, installing...
    call pnpm install
    if errorlevel 1 (
        echo %ERROR% Failed to install dependencies
        pause
        exit /b 1
    )
)

REM Start development web server
echo %INFO% Starting development server with hot reload...
echo %INFO% Web interface will be available at: http://127.0.0.1:3080
echo %INFO% Press Ctrl+C to stop the server
echo.

call pnpm run dev:web

REM If script exits
echo.
echo %INFO% Development server has stopped
pause
