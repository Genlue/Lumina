@echo off
cd /d "%~dp0"

echo ========================================
echo   Photo Album Electron - Setup
echo ========================================
echo.
echo [1/2] Installing dependencies...
set ELECTRON_SKIP_BINARY_DOWNLOAD=1
call npm install
if %ERRORLEVEL% NEQ 0 goto :fail

echo.
echo [2/2] Testing TypeScript compile...
call npx tsc --noEmit
if %ERRORLEVEL% NEQ 0 echo TypeScript errors - check src

:done
echo.
echo Setup OK. Try: npm run dev
pause
exit /b 0

:fail
echo.
echo ERROR: npm install failed.
echo Try: npm config set strict-ssl false
pause
exit /b 1
