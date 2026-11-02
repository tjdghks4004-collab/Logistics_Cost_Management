@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or later from https://nodejs.org/ and run again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)"
if errorlevel 1 (
  echo Node.js 24 or later is required.
  pause
  exit /b 1
)
if not exist "node_modules\exceljs\package.json" (
  call npm ci --omit=dev
  if errorlevel 1 (
    echo Dependency installation failed. Check your network connection.
    pause
    exit /b 1
  )
)
call npm run start:local
pause
