@echo off
REM --- Ronin Backend Server Startup ---
REM Dung de khoi dong Uvicorn (FastAPI)

title Ronin Backend Server - Listening on Port 3210

REM 1. Chuyen den thu muc code
cd C:\RoninBackEndExtension

REM 2. (TUY CHON): Kich hoat moi truong ao (Neu co)
REM Neu ban co tao virtual environment, hay bo dau REM o dong duoi va sua duong dan
REM C:\path\to\your\venv\Scripts\activate

echo.
echo ===================================================
echo 🚀 Kich hoat Ronin Backend Server (reload=False)...
echo ===================================================
echo.

REM 3. Khoi dong Server Python (python main.py)
python main.py

REM Giu cua so mo de xem logs neu server bi loi
pause