@echo off
setlocal
cd /d "%~dp0"
title Sprite Creator - Diagnostics
echo ========================================
echo SPRITE CREATOR 1.11.1 DIAGNOSTICS
echo ========================================
echo Project folder: %CD%
echo.
for %%F in ("src\index.html" "src\renderer.js" "src\main.js" "src\preload.js" "src\theme-init.js" "src\styles.css" "src\theme-system.css" "src\canvas.css" "src\selection.css" "src\theme-polish.css") do if exist %%F (echo [OK] %%~nxF) else (echo [MISSING] %%~nxF)
echo.
where node.exe >nul 2>nul
if errorlevel 1 (echo Node.js: not installed) else (node --version)
where npm.cmd >nul 2>nul
if errorlevel 1 (echo npm: not installed) else (call npm --version)
where msedge.exe >nul 2>nul
if errorlevel 1 (echo Edge: not on PATH) else (echo Edge: available)
where chrome.exe >nul 2>nul
if errorlevel 1 (echo Chrome: not on PATH) else (echo Chrome: available)
if exist "node_modules\electron\dist\electron.exe" (echo Electron runtime: installed) else (echo Electron runtime: not installed)
echo.
pause
