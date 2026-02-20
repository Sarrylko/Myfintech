@echo off
:: MyFintech Backup Launcher
:: Called by Windows Task Scheduler — runs backup.sh via Git Bash

set LOG=Y:\Backups\MyFintech\backup.log
set BASH="C:\Program Files\Git\usr\bin\bash.exe"
set SCRIPT=C:/Github/MyFinTech/Myfintech/scripts/backup.sh

echo. >> "%LOG%"
echo [%DATE% %TIME%] Starting backup >> "%LOG%"

%BASH% "%SCRIPT%" >> "%LOG%" 2>&1

if %ERRORLEVEL% EQU 0 (
    echo [%DATE% %TIME%] Backup succeeded >> "%LOG%"
) else (
    echo [%DATE% %TIME%] Backup FAILED (exit code %ERRORLEVEL%) >> "%LOG%"
)
