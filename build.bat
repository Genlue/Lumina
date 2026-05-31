@echo off
cd /d "%~dp0"

echo ========================================
echo   Photo Album Electron — Build EXE
echo ========================================
echo.

echo [1/2] Compiling TypeScript...
call npx tsc
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] TypeScript compilation failed.
    pause
    exit /b 1
)

echo.
echo [2/2] Building EXE...
call npm run build:win

echo.
echo Done! Check dist-pkg/ folder for the EXE.
echo.
pause
