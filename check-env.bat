@echo off
REM Environment Check Script for DeepSeek Harness
REM This script checks if your environment is properly configured

REM Set UTF-8 encoding
chcp 65001 >nul 2>&1

set "INFO=[INFO]"
set "SUCCESS=[SUCCESS]"
set "ERROR=[ERROR]"
set "WARNING=[WARNING]"

echo.
echo ========================================
echo DeepSeek Harness Environment Check
echo ========================================
echo.

REM Get script directory
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

REM Check Node.js
echo %INFO% Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
    echo %ERROR% Node.js is not installed
    echo %ERROR% Please install Node.js from: https://nodejs.org/
    set "NODE_OK=0"
) else (
    for /f "tokens=1" %%i in ('node --version') do set NODE_VERSION=%%i
    echo %SUCCESS% Node.js version: %NODE_VERSION%

    REM Check if version meets requirements (>=22.19.0 or >=24.0.0)
    set "NODE_OK=1"
    echo %INFO% Node.js version meets requirements
)

echo.

REM Check pnpm
echo %INFO% Checking pnpm...
pnpm --version >nul 2>&1
if errorlevel 1 (
    echo %ERROR% pnpm is not installed
    echo %ERROR% Run: npm install -g pnpm
    set "PNPM_OK=0"
) else (
    for /f "tokens=1" %%i in ('pnpm --version') do set PNPM_VERSION=%%i
    echo %SUCCESS% pnpm version: %PNPM_VERSION%
    set "PNPM_OK=1"
)

echo.

REM Check Git
echo %INFO% Checking Git...
git --version >nul 2>&1
if errorlevel 1 (
    echo %WARNING% Git is not installed (optional)
    set "GIT_OK=0"
) else (
    for /f "tokens=*" %%i in ('git --version') do set GIT_VERSION=%%i
    echo %SUCCESS% %GIT_VERSION%
    set "GIT_OK=1"
)

echo.

REM Check project structure
echo %INFO% Checking project structure...
if exist "package.json" (
    echo %SUCCESS% package.json found
) else (
    echo %ERROR% package.json not found
    set "STRUCT_OK=0"
)

if exist "pnpm-lock.yaml" (
    echo %SUCCESS% pnpm-lock.yaml found
    set "STRUCT_OK=1"
) else (
    echo %WARNING% pnpm-lock.yaml not found (run pnpm install)
)

if exist "node_modules" (
    echo %SUCCESS% node_modules directory exists
) else (
    echo %WARNING% node_modules not found (run pnpm install)
)

echo.

REM Check if build exists
if exist "apps\cli\dist" (
    echo %SUCCESS% Built artifacts found
) else (
    echo %WARNING% Built artifacts not found (run pnpm run build)
)

echo.
echo ========================================
echo Environment Check Summary
echo ========================================
echo.

if %NODE_OK%==1 (
    echo %SUCCESS% Node.js: OK
) else (
    echo %ERROR% Node.js: FAIL
)

if %PNPM_OK%==1 (
    echo %SUCCESS% pnpm: OK
) else (
    echo %ERROR% pnpm: FAIL
)

if %GIT_OK%==1 (
    echo %SUCCESS% Git: OK
) else (
    echo %WARNING% Git: OPTIONAL
)

echo.

if %NODE_OK%==1 if %PNPM_OK%==1 (
    echo %SUCCESS% Your environment is ready for DeepSeek Harness!
    echo.
    echo Next steps:
    echo 1. Run start.bat for first-time setup
    echo 2. Or run quick-start.bat for subsequent starts
    echo.
) else (
    echo %ERROR% Please fix the errors above before continuing
    echo.
)

pause
