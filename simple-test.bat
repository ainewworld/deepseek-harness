@echo off
chcp 65001 >nul 2>&1

echo Step 1: Basic test
echo.

echo Testing pnpm command:
pnpm --version
echo Command executed, error level: %errorlevel%
echo.

echo Step 2: Testing set /p with temp file
pnpm --version > test_version.txt
set /p MY_VERSION=<test_version.txt
del test_version.txt
echo Version from temp file: %MY_VERSION%
echo.

echo Step 3: Testing if this continues
echo If you see this, the script is working!
echo.

echo All tests passed. Press any key to continue...
pause >nul
