@echo off
setlocal

set "APP_DIR=%~dp0"
set "STATUS_URL=http://localhost:5173/admin/status"

cd /d "%APP_DIR%"

echo.
echo GithubArchive+ local launcher
echo ==============================
echo.

where npm >nul 2>nul
if errorlevel 1 (
	echo ERROR: npm was not found. Install Node.js LTS, then run this file again.
	echo https://nodejs.org/
	echo.
	pause
	exit /b 1
)

if not exist "package.json" (
	echo ERROR: package.json was not found in "%APP_DIR%".
	echo Run this launcher from the GithubArchive+ project folder.
	echo.
	pause
	exit /b 1
)

if not exist "node_modules" (
	echo Installing dependencies...
	if exist "package-lock.json" (
		call npm ci
	) else (
		call npm install
	)
	if errorlevel 1 (
		echo.
		echo ERROR: dependency installation failed.
		pause
		exit /b 1
	)
) else (
	echo Dependencies already installed.
)

echo.
echo Initializing database...
call npm run db:init
if errorlevel 1 (
	echo.
	echo ERROR: database initialization failed.
	pause
	exit /b 1
)

echo.
echo Starting GithubArchive+...
start "GithubArchive+ Server" /D "%APP_DIR%" cmd /k "npm run dev -- --host 127.0.0.1"

echo Waiting for http://localhost:5173 ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline=(Get-Date).AddSeconds(45); do { try { $client=[Net.Sockets.TcpClient]::new(); $iar=$client.BeginConnect('127.0.0.1',5173,$null,$null); if ($iar.AsyncWaitHandle.WaitOne(500)) { $client.EndConnect($iar); $client.Close(); exit 0 }; $client.Close() } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
	echo The server is still starting. Opening the status page anyway.
) else (
	echo Server is ready.
)

start "" "%STATUS_URL%"

echo.
echo GithubArchive+ is launching at %STATUS_URL%
echo Close the "GithubArchive+ Server" window or run stop-githubarchive.bat to stop it.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 5" >nul
exit /b 0
