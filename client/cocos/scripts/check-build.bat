@echo off
chcp 65001 >nul
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
echo === build processes ===
tasklist /FI "IMAGENAME eq cl.exe" 2>nul | find /I "cl.exe"
tasklist /FI "IMAGENAME eq MSBuild.exe" 2>nul | find /I "MSBuild.exe"
tasklist /FI "IMAGENAME eq cmake.exe" 2>nul | find /I "cmake.exe"
echo.
echo === log file ===
dir "%ROOT%\temp\compile-win2.log"
echo.
echo === obj count ===
dir /s /b "%ROOT%\build\windows\proj\*.obj" 2>nul | find /c /v ""
echo.
echo === exe ===
dir /b "%ROOT%\build\windows\proj\*.exe" 2>nul
echo.
echo === tail ===
powershell -NoProfile -Command "Get-Content '%ROOT%\temp\compile-win2.log' -Tail 8"
