@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

cd /d "%~dp0"
set "ROOT_DIR=%CD%"
set "LOG_FILE=%ROOT_DIR%\launch.log"

echo [%date% %time%] === Launching vAI === > "%LOG_FILE%"
echo.
echo ═══════════════════════════════════════
echo   vAI - Startup
echo ═══════════════════════════════════════
echo.

echo [1/5] Python check...
where python >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Python not found in PATH!
    pause
    exit /b 1
)
echo ✅ Python found
echo.

echo [2/5] Checking dependencies...
python -c "import fastapi, uvicorn, psutil" >nul 2>&1
if %errorlevel% neq 0 (
    echo ⚠️ Installing libraries...
    python -m pip install -q fastapi==0.109.0 uvicorn==0.27.0 psutil==5.9.8
)
echo ✅ Dependencies installed
echo.

echo [3/5] Checking port 8000...
set "PID="
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8000 " ^| findstr "LISTENING"') do set "PID=%%a"
if defined PID (
    echo ⚠️ Port 8000 is occupied by process PID: %PID%
    echo 🔄 Completing the process...
    taskkill /f /pid %PID% >nul 2>&1
    timeout /t 2 /nobreak > nul
)
echo ✅ Port 8000 is free
echo.

echo [4/5] Starting the backend...
start "vAI Backend" cmd /k "python switcher.py"

echo ⏳ Waiting for server...
set /a "retry_count=0"

:wait_loop
timeout /t 2 /nobreak > nul
set /a "retry_count+=1"

powershell -Command "try { $s = New-Object System.Net.Sockets.TcpClient('127.0.0.1', 8000); $s.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% neq 0 (
    if !retry_count! geq 10 (
        echo ❌ The server didn't respond within 20 seconds! Check the black Python window that opened; it says there's an error.
        pause
        exit /b 1
    )
    goto wait_loop
)
echo ✅ The server is ready!
echo.

echo [5/5] Opening the interface...
start "" "%ROOT_DIR%\index.html"

echo vAI is launched!
timeout /t 3 > nul
exit /b 0