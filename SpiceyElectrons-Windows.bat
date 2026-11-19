@echo off
rem Spicey Electrons - double-click launcher for Windows
rem Required Notice: Copyright Matthew Armstrong (https://github.com/The-Dorkknight)
rem Licensed under the PolyForm Noncommercial License 1.0.0. No warranty.
cd /d "%~dp0"
title Spicey Electrons

set PY=
where py >nul 2>nul && set PY=py -3
if not defined PY ( where python >nul 2>nul && set PY=python )
if not defined PY (
  echo Python 3 is needed. Get it free from https://www.python.org/downloads/
  echo Tick "Add python.exe to PATH" when installing, then double-click this file again.
  start "" https://www.python.org/downloads/
  pause
  exit /b 1
)

set FOUND=
where ngspice_con >nul 2>nul && set FOUND=1
if exist "tools\Spice64\bin\ngspice_con.exe" set FOUND=1
if exist "C:\Spice64\bin\ngspice_con.exe" set FOUND=1
if exist "C:\Program Files\Spice64\bin\ngspice_con.exe" set FOUND=1
if not defined FOUND (
  echo The simulation engine ^(ngspice^) is not installed yet.
  echo 1. Your browser will open the ngspice download page. Get the Windows 64-bit file.
  echo 2. Unpack it so you have this folder:  %CD%\tools\Spice64\bin\ngspice_con.exe
  echo    ^(no admin rights needed^). Or unpack it to C:\Spice64 if you are allowed.
  echo 3. Double-click this file again.
  start "" https://ngspice.sourceforge.io/download.html
  pause
)

echo Starting Spicey Electrons... ^(close this window to quit^)
%PY% src\main.py %*
if errorlevel 1 pause
