@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (echo Node.js 22 or newer is required to regenerate the share package.&pause&exit /b 1)
call npm run check
if errorlevel 1 goto Failed
call npm run build:portable
if errorlevel 1 goto Failed
if not exist dist\share mkdir dist\share
copy /y "Launch Portable Share.bat" "dist\share\Launch Sprite Creator.bat" >nul
copy /y LICENSE "dist\share\LICENSE.txt" >nul
copy /y "assets\sprite-creator.png" "dist\share\Sprite Creator Logo.png" >nul
copy /y "assets\sprite-creator.ico" "dist\share\Sprite Creator Windows Icon.ico" >nul
copy /y "BRAND GUIDE.md" "dist\share\Sprite Creator Brand Guide.md" >nul
copy /y "START HERE - SHARE.txt" "dist\share\START HERE.txt" >nul
copy /y "dist\portable\Sprite Creator.html" "dist\share\Sprite Creator.html" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path 'dist\Sprite-Creator-1.11.1-Portable.zip') { Remove-Item 'dist\Sprite-Creator-1.11.1-Portable.zip' }; Compress-Archive -Path 'dist\share\*' -DestinationPath 'dist\Sprite-Creator-1.11.1-Portable.zip' -CompressionLevel Optimal"
if errorlevel 1 goto Failed
echo Share package written to dist\Sprite-Creator-1.11.1-Portable.zip
pause
exit /b 0
:Failed
echo Share package build failed. Review the output above.
pause
exit /b 1
