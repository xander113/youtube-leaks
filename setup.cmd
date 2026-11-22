@echo off
cd /d "%~dp0"
call npm run setup
if errorlevel 1 pause
