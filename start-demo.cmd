@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22 or newer from https://nodejs.org/ first.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4319 after the server starts.
node src/server.mjs --demo
pause

