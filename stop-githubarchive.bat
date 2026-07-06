@echo off
setlocal

echo.
echo Stopping GithubArchive+ on http://localhost:5173 ...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command "$connections=Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue; if (-not $connections) { Write-Host 'No process is listening on port 5173.'; exit 0 }; $processIds=$connections | Select-Object -ExpandProperty OwningProcess -Unique; foreach ($processId in $processIds) { try { $proc=Get-Process -Id $processId -ErrorAction Stop; Write-Host ('Stopping PID {0} ({1})' -f $processId,$proc.ProcessName); Stop-Process -Id $processId -Force -ErrorAction Stop } catch { Write-Host ('Could not stop PID {0}: {1}' -f $processId,$_.Exception.Message); exit 1 } }"

if errorlevel 1 (
	echo.
	echo ERROR: one or more processes could not be stopped.
	pause
	exit /b 1
)

echo.
echo GithubArchive+ stopped.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 3" >nul
exit /b 0
