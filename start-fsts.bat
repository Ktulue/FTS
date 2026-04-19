@echo off
REM Starts FSTS in a named console window. Close the window to stop cleanly.
title FSTS
cd /d "%~dp0"
echo Starting FSTS...
call npm start
echo FSTS stopped.
pause
