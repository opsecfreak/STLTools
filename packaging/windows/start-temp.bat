@echo off
rem One-time STL Tools session (shared or borrowed PC): data goes to a temp folder and is
rem deleted when STL Tools stops. It stops by itself after 4 hours. Download your STL files first.
rem Other limit: run "Start STL Tools.bat" --temp --hours 2 from a command prompt.
call "%~dp0Start STL Tools.bat" --temp --hours 4 %*
