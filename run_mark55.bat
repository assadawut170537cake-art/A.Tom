@echo off
title Mark 55 Memory Bus Watcher
rem ใช้โฟลเดอร์ของไฟล์นี้ (%~dp0) แทน path ตายตัว — clone ไว้ที่ไหนก็รันได้
cd /d "%~dp0"
echo [Mark 55] Starting Memory Bus Watcher...
"%~dp0mark55\.venv\Scripts\python.exe" "%~dp0mark55\main.py" %*
pause
