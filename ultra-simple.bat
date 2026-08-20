@echo off
chcp 65001
echo Starting DeepSeek Harness...
cd /d "%~dp0"
echo.
echo Installing dependencies...
pnpm install
echo.
echo Building project...
pnpm run build
echo.
echo Starting web interface...
echo Web interface will be at: http://127.0.0.1:3080
echo Press Ctrl+C to stop
echo.
pnpm dsh web
pause
