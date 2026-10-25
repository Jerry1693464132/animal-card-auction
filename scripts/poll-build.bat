@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."
echo [poll] polling build task 1790000607341 ...
node scripts\poll-build.mjs %1
