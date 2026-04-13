@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0OrganizerLauncher.ps1"
exit /b %ERRORLEVEL%
