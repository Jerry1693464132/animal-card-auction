@echo off
setlocal
cd /d "%~dp0.."
echo === 陪玩机器人自检（%1 人场） ===
set PT_SEATS=%1
set PT_DELAY=1
node scripts\playtest-bots.mjs
