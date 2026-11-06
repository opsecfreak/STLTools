@echo off
rem STL Tools from a USB drive: all data (designs, projects, printers, settings) stays in
rem the stltools-data folder next to this file. Stop STL Tools before you unplug the drive.
call "%~dp0Start STL Tools.bat" --portable %*
