@echo off
REM Debug version of start.bat to find the issue
chcp 65001 >nul 2>&1

echo [DEBUG] Starting debug version...
echo.

REM Get script directory
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

echo [DEBUG] Current directory: %CD%
echo.

REM Step 1: Test Node.js
echo [DEBUG] Testing Node.js...
node --version
if errorlevel 1 (
    echo [ERROR] Node.js check failed
    pause
    exit /b 1
) else (
    echo [SUCCESS] Node.js check passed
)
echo.

REM Step 2: Test pnpm
echo [DEBUG] Testing pnpm...
echo [DEBUG] Running: pnpm --version
pnpm --version
set PNPM_ERROR=%errorlevel%
echo [DEBUG] Error level: %PNPM_ERROR%

if %PNPM_ERROR% neq 0 (
    echo [ERROR] pnpm command failed with error level %PNPM_ERROR%
    pause
    exit /b 1
) else (
    echo [SUCCESS] pnpm command succeeded
)
echo.

REM Step 3: Test for loop
echo [DEBUG] Testing for loop...
for /f "delims=" %%i in ('pnpm --version 2^>^&1') do (
    set "PNPM_VERSION=%%i"
    echo [DEBUG] Found version: %%i
)
echo [DEBUG] PNPM_VERSION variable: %PNPM_VERSION%
echo.

REM Step 4: Continue if successful
if "%PNPM_VERSION%"=="" (
    echo [ERROR] Failed to get pnpm version
    pause
    exit /b 1
) else (
    echo [SUCCESS] Got pnpm version: %PNPM_VERSION%
)
echo.

echo [DEBUG] All checks passed! Would continue to install...
pause
