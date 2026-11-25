@echo off
setlocal
cd /d "%~dp0"
title Sprite Creator - Browser Preview
set "APPFILE=%~dp0src\index.html"
if not exist "%APPFILE%" (echo Missing src\index.html&pause&exit /b 1)
set "APPURL=file:///%APPFILE:\=/%"
where msedge.exe >nul 2>nul
if not errorlevel 1 (start "Sprite Creator Preview" msedge.exe --app="%APPURL%" --start-maximized&exit /b 0)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (start "Sprite Creator Preview" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app="%APPURL%" --start-maximized&exit /b 0)
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (start "Sprite Creator Preview" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app="%APPURL%" --start-maximized&exit /b 0)
where chrome.exe >nul 2>nul
if not errorlevel 1 (start "Sprite Creator Preview" chrome.exe --app="%APPURL%" --start-maximized&exit /b 0)
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (start "Sprite Creator Preview" "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" --app="%APPURL%" --start-maximized&exit /b 0)
start "" "%APPFILE%"
exit /b 0
