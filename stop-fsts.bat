@echo off
REM Terminates any FSTS process started via start-fsts.bat by title.
taskkill /FI "WINDOWTITLE eq FSTS" /T /F
exit /b 0
