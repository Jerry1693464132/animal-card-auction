@echo off
cd /d "%~dp0"
if not exist temp mkdir temp
start "animal-card-auction-server" /MIN cmd /c "npm run dev > temp\server-restart.log 2>&1"
echo launched server
