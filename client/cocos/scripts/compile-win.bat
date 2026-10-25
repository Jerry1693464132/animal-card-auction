@echo off
chcp 65001 >nul
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
if not defined COCOS_CMAKE set "COCOS_CMAKE=C:\ProgramData\cocos\editors\Creator\3.8.8\resources\tools\cmake\bin\cmake.exe"
set "CMAKE=%COCOS_CMAKE%"
set "PROJ=%ROOT%\build\windows\proj"
set "LOG=%ROOT%\temp\compile-win2.log"

echo [compile-win] cmake --build "%PROJ%" --config Release
echo [compile-win] log -> %LOG%
"%CMAKE%" --build "%PROJ%" --config Release > "%LOG%" 2>&1
echo [compile-win] exit code: %ERRORLEVEL%
