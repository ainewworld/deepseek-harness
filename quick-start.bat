@echo off
REM Quick Start Script for DeepSeek Harness (Use after first setup)
REM This script skips dependency installation and building

REM Set UTF-8 encoding
chcp 65001 >nul 2>&1

set "INFO=[INFO]"
set "SUCCESS=[SUCCESS]"
set "ERROR=[ERROR]"

echo.
echo %INFO% Quick Start - DeepSeek Harness Web Interface
echo.

REM Get script directory
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

REM Start web interface directly
echo %INFO% Starting web interface at: http://127.0.0.1:3080
echo %INFO% Press Ctrl+C to stop
echo.

call pnpm dsh web

REM If script exits
echo.
echo %INFO% DeepSeek Harness has stopped
pause
