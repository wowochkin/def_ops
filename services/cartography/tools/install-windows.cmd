@echo off
setlocal
set "PY=%~dp0..\..\portable\runtime\python\python.exe"
if not exist "%PY%" (
 echo Python runtime not found: %PY%
 pause
 exit /b 1
)
"%PY%" "%~dp0install.py"
set "RESULT=%ERRORLEVEL%"
pause
exit /b %RESULT%
