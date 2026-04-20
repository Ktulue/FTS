@echo off
REM Terminates any FTS process started via start-fts.bat by title.
taskkill /FI "WINDOWTITLE eq FTS" /T /F
exit /b 0
