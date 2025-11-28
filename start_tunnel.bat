@echo off
title Cloudflare Tunnel - Auto Restart
echo Starting Cloudflare Tunnel...
echo -------------------------------------

:loop
"C:\RoninBackEndExtension\cloudflared.exe" tunnel --config "C:\Users\tonng\.cloudflared\config.yml" run ronintunnel
echo.
echo Tunnel stopped or crashed. Restarting in 3 seconds...
timeout /t 3 >nul
goto loop