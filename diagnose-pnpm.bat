@echo off
chcp 65001 >nul 2>&1

echo Diagnosing pnpm issue...
echo.

echo Test 1: Can we run pnpm?
pnpm --version
echo Test 1 completed, error level: %errorlevel%
echo.

echo Test 2: Can we redirect pnpm output?
pnpm --version >nul 2>&1
echo Test 2 completed, error level: %errorlevel%
echo.

echo Test 3: Checking errorlevel value...
if errorlevel 1 (
    echo Errorlevel is greater than or equal to 1
) else (
    echo Errorlevel is 0 (success)
)
echo.

echo Test 4: Try to continue...
echo This should print if the script hasn't exited yet
echo.

echo All diagnostic tests completed
pause
