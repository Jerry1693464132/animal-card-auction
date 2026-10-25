@echo off
chcp 65001 >nul
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "REL=%ROOT%\build\windows\proj\Release"
set "LOG=%ROOT%\temp\game-run.log"
cd /d "%REL%"
echo [run-game] starting windows.exe > "%LOG%"
windows.exe >> "%LOG%" 2>&1
echo [run-game] exit code: %ERRORLEVEL% >> "%LOG%"
