@echo off
chcp 65001 >nul
for %%I in ("%~dp0..\..\..") do set "REPO=%%~fI"
echo === connections to 8787 ===
netstat -ano | findstr ":8787"
echo.
echo === windows.exe pid ===
tasklist | findstr /I "windows.exe"
echo.
echo === accounts.json tail ===
powershell -NoProfile -Command "Get-Content '%REPO%\data\accounts.json' -Tail 20"
