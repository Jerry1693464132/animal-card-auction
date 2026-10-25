@echo off
chcp 65001 >nul
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
if not defined COCOS_CMAKE set "COCOS_CMAKE=C:\ProgramData\cocos\editors\Creator\3.8.8\resources\tools\cmake\bin\cmake.exe"
set "CMAKE=%COCOS_CMAKE%"
set "SRC=%ROOT%\native\engine\win64"
set "PROJ=%ROOT%\build\windows\proj"
set "RES=%ROOT%\build\windows"
set "LOG=%ROOT%\temp\rebuild-socket.log"

echo [rebuild] step 1: cmake configure (USE_SOCKET ON) > "%LOG%"
"%CMAKE%" -S"%SRC%" -B"%PROJ%" -A x64 -DRES_DIR="%RES%" -DAPP_NAME="windows" -DLAUNCH_TYPE="Release" >> "%LOG%" 2>&1
echo [rebuild] configure exit: %ERRORLEVEL% >> "%LOG%"
if errorlevel 1 goto :done

echo [rebuild] step 2: cmake --build Release >> "%LOG%"
"%CMAKE%" --build "%PROJ%" --config Release >> "%LOG%" 2>&1
echo [rebuild] build exit: %ERRORLEVEL% >> "%LOG%"

:done
echo [rebuild] ALL DONE >> "%LOG%"
