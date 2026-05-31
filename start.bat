@echo off
cd /d "%~dp0"
call npx tsc --project tsconfig.json >nul 2>&1
if %ERRORLEVEL% NEQ 0 (echo TS errors! & pause & exit /b 1)
start "" /B npx electron .
