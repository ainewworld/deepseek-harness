@echo off
REM Stop Script for DeepSeek Harness
REM This script stops the running DeepSeek Harness processes

REM Set UTF-8 encoding
chcp 65001 >nul 2>&1

set "INFO=[INFO]"
set "SUCCESS=[SUCCESS]"
set "WARNING=[WARNING]"

echo.
echo %INFO% Stopping DeepSeek Harness processes...
echo.

REM Stop Node.js processes related to dsh
tasklist | find "node.exe" >nul 2>&1
if not errorlevel 1 (
    echo %INFO% Found running Node.js processes
    taskkill /F /IM node.exe >nul 2>&1
    if not errorlevel 1 (
        echo %SUCCESS% Node.js processes stopped
    ) else (
        echo %WARNING% Some processes could not be stopped
    )
) else (
    echo %INFO% No running Node.js processes found
)

REM Also check for pnpm related processes
tasklist | find "pnpm.exe" >nul 2>&1
if not errorlevel 1 (
    echo %INFO% Found running pnpm processes
    taskkill /F /IM pnpm.exe >nul 2>&1
    if not errorlevel 1 (
        echo %SUCCESS% pnpm processes stopped
    )
)

echo.
echo %SUCCESS% DeepSeek Harness has been stopped
echo.
timeout /t 2 >nul
