@echo off
setlocal
cd /d "%~dp0"
rem Main developer-folder launcher. The share ZIP contains a separate browser launcher.
call "%~dp0Launch Dev.bat"
exit /b %errorlevel%
