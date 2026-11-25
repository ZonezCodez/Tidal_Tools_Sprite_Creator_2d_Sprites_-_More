@echo off
setlocal
cd /d "%~dp0"
title Sprite Creator
set "APPFILE=%~dp0Sprite Creator.html"
if not exist "%APPFILE%" (
  echo Sprite Creator.html is missing. Please extract the entire portable ZIP first.
  pause
  exit /b 1
)
set "APPURL=file:///%APPFILE:\=/%"
set "PROFILE=%LOCALAPPDATA%\SpriteCreator\ShareProfile"
if not exist "%PROFILE%" mkdir "%PROFILE%" >nul 2>nul
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  start "Sprite Creator" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --app="%APPURL%" --start-maximized
  exit /b 0
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  start "Sprite Creator" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --app="%APPURL%" --start-maximized
  exit /b 0
)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
  start "Sprite Creator" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --user-data-dir="%PROFILE%" --no-first-run --no-default-browser-check --app="%APPURL%" --start-maximized
  exit /b 0
)
where msedge.exe >nul 2>nul
if not errorlevel 1 (start "Sprite Creator" msedge.exe --user-data-dir="%PROFILE%" --no-first-run --app="%APPURL%" --start-maximized&exit /b 0)
where chrome.exe >nul 2>nul
if not errorlevel 1 (start "Sprite Creator" chrome.exe --user-data-dir="%PROFILE%" --no-first-run --app="%APPURL%" --start-maximized&exit /b 0)
start "" "%APPFILE%"
exit /b 0
