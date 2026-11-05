@echo off
rem Installs STL Tools for this Windows user (no admin rights needed) and adds shortcuts.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\install-windows.ps1"
pause
