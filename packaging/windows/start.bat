@echo off
rem STL Tools launcher for Windows. Double-click to start, then use the browser tab it opens.
setlocal
cd /d "%~dp0"
set "NODE=node"
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
"%NODE%" --version >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found.
  echo Use the windows-x64 download, which includes it, or install Node.js 18 or newer from https://nodejs.org
  pause
  exit /b 1
)
title STL Tools
"%NODE%" "%~dp0app\bin\stltools-app.js" %*
if errorlevel 1 pause
