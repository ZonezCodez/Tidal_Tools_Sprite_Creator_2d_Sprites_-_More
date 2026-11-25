@echo off
setlocal
cd /d "%~dp0"
title Sprite Creator - Developer Launch

where node.exe >nul 2>nul
if errorlevel 1 goto NoNode
for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
for /f %%V in ('node -p "Number(process.versions.node.split('.')[1])"') do set "NODE_MINOR=%%V"
if %NODE_MAJOR% LSS 22 goto OldNode
if %NODE_MAJOR% EQU 22 if %NODE_MINOR% LSS 12 goto OldNode
where npm.cmd >nul 2>nul
if errorlevel 1 goto NoNpm
if not exist node_modules\electron\dist\electron.exe (
  echo Installing pinned development dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto Failed
)
call npm run check
if errorlevel 1 goto Failed
call npm run dev
if errorlevel 1 goto Failed
exit /b 0
:NoNode
echo Node.js 22.12 or newer is required for developer mode.
echo The portable share package does not require Node.js.
pause
exit /b 1
:OldNode
echo Node.js 22.12 or newer is required. Detected: %NODE_MAJOR%.%NODE_MINOR%
pause
exit /b 1
:NoNpm
echo npm was not found. Reinstall Node.js with npm enabled.
pause
exit /b 1
:Failed
echo Developer launch failed. Review the error above.
pause
exit /b 1
