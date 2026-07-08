@echo off
rem budgetr launcher for Windows. Requires Node.js 20+ from https://nodejs.org
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required but was not found.
  echo Install it from https://nodejs.org ^(choose LTS^), or run:
  echo   winget install OpenJS.NodeJS.LTS
  echo ...then run this file again.
  pause
  exit /b 1
)

cd /d "%~dp0web"

if not exist node_modules (
  echo Installing dependencies - the first run takes a few minutes...
  call npm ci --no-audit --no-fund || goto :fail
)

echo Preparing the database...
call npm run setup || goto :fail

if not exist .next\BUILD_ID (
  echo Building the app - the first run takes a few minutes...
  call npm run build || goto :fail
)

start "" http://localhost:3000
echo Starting budgetr at http://localhost:3000 - keep this window open to keep it running.
call npx next start -p 3000
exit /b

:fail
echo.
echo Something went wrong - see the messages above.
pause
exit /b 1
