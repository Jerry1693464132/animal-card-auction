@echo off
chcp 65001 >nul
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
ping -n 15 127.0.0.1 >nul
echo === connections to 8787 ===
netstat -ano | findstr ":8787"
echo.
echo === windows.exe ===
tasklist | findstr /I "windows.exe"
echo.
echo === log ===
type "%ROOT%\temp\game-run.log"
