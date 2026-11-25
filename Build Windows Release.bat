@echo off
setlocal
cd /d "%~dp0"
title Build Sprite Creator - Windows Release
where node.exe >nul 2>nul
if errorlevel 1 goto NoNode
for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
for /f %%V in ('node -p "Number(process.versions.node.split('.')[1])"') do set "NODE_MINOR=%%V"
if %NODE_MAJOR% LSS 22 goto OldNode
if %NODE_MAJOR% EQU 22 if %NODE_MINOR% LSS 12 goto OldNode
where npm.cmd >nul 2>nul
if errorlevel 1 goto NoNpm
if not exist node_modules\electron-builder goto InstallDeps
if not exist node_modules\electron\dist\electron.exe goto InstallDeps
goto RunChecks
:InstallDeps

  echo Installing pinned release tooling. Internet is required for this one-time step...
  call npm install --no-audit --no-fund
if errorlevel 1 goto Failed
:RunChecks
call npm run check
if errorlevel 1 goto Failed
call npm run pack:win
if errorlevel 1 goto Failed
echo.
echo Release build complete. Open the release folder for Setup.exe and Portable.exe.
pause
exit /b 0
:NoNode
echo Install Node.js 22.12 or newer to build the native Windows release.
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
echo Windows release build failed. Review the messages above.
pause
exit /b 1
