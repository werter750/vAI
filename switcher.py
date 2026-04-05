import os
import time
import subprocess
import uvicorn
import re
import psutil
import string
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# --- PATHFINDING LOGIC ---
def find_kobold_dir():
    base = os.path.dirname(os.path.abspath(__file__))
    # 1. Check next to the script
    local_path = os.path.join(base, "KoboldCPP")
    if os.path.exists(os.path.join(local_path, "koboldcpp.exe")):
        return local_path
    
    # 2. Search the roots of all drives (C:/KoboldCPP, D:/KoboldCPP...)
    drives = ['%s:\\' % d for d in string.ascii_uppercase if os.path.exists('%s:\\' % d)]
    for drive in drives:
        potential_path = os.path.join(drive, "KoboldCPP")
        if os.path.exists(os.path.join(potential_path, "koboldcpp.exe")):
            return potential_path
    
    return local_path 

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KOBOLD_DIR = find_kobold_dir()
EXE_NAME = "koboldcpp.exe"

# --- API INITIALIZATION ---
app = FastAPI(title="vAI Switcher")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

current_process = None

def kill_current_process():
    """Terminates our process and clears port 1337 of hanging copies."""
    global current_process
    if current_process and current_process.poll() is None:
        print(f">>> Terminating the PID process: {current_process.pid}")
        current_process.kill()
        current_process.wait(timeout=5)
    
    # Clear port 1337 from any processes
    for conn in psutil.net_connections():
        if conn.laddr.port == 1337:
            try:
                p = psutil.Process(conn.pid)
                print(f">>>Clearing port 1337 (killing PID) {conn.pid})...")
                p.terminate()
            except: pass
    time.sleep(1.5) 

@app.post("/switch_model")
def switch_model(config_name: str):
    global current_process
    
    if not re.match(r"^[\w\-]+$", config_name):
        raise HTTPException(status_code=400, detail="Invalid configuration name")

    executable_path = os.path.join(KOBOLD_DIR, EXE_NAME)
    config_path = os.path.join(KOBOLD_DIR, f"{config_name}.kcpps")

    if not os.path.exists(executable_path):
        raise HTTPException(status_code=404, detail=f"EXE не найден по пути: {executable_path}")
    
    kill_current_process()

    print(f"[{config_name}] >>> Run: {EXE_NAME} from {KOBOLD_DIR}")
    try:
        flags = subprocess.CREATE_NEW_CONSOLE if os.name == 'nt' else 0
        current_process = subprocess.Popen(
            [executable_path, "--config", config_path],
            cwd=KOBOLD_DIR,
            creationflags=flags
        )
        return {"status": "success", "message": f"Модель {config_name} запущена"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.on_event("shutdown")
def shutdown_event():
    kill_current_process()

def kill_port_8000():
    """Finds and kills any process that has occupied port 8000."""
    for conn in psutil.net_connections():
        if conn.laddr.port == 8000:
            try:
                p = psutil.Process(conn.pid)
                if p.pid != os.getpid(): # Don't kill ourselves
                    print(f">>> Port 8000 is in use by process {p.name()} (PID: {p.pid}). Cleaning up...")
                    p.kill()
                    time.sleep(1)
            except: pass

if __name__ == "__main__":
    print("==================================================")
    print("🚀vAI Backend Switcher is live!")
    
    # First, we clean port 8000 from "ghosts"
    kill_port_8000()
    
    print(f"📁 KoboldCPP found at: {KOBOLD_DIR}")
    print("==================================================")
    
    try:
        uvicorn.run(app, host="0.0.0.0", port=8000, log_level="warning")
    except Exception as e:
        print(f"❌ Critical error while starting the server: {e}")
        input("Press Enter to exit...")