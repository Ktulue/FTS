@echo off
REM Starts FTS in a named console window. Close the window to stop cleanly.
title FTS
cd /d "%~dp0"
echo Starting FTS...
call npm start
echo FTS stopped.
pause
