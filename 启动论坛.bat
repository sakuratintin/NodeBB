@echo off
chcp 65001 >nul
title 启动校园论坛
cd /d D:\nodebb

echo.
echo   正在启动校园论坛，请稍等 8 秒...
echo.

powershell -NoProfile -WindowStyle Hidden -Command "Start-Process node -ArgumentList 'loader.js' -WorkingDirectory 'D:\nodebb' -WindowStyle Hidden"

timeout /t 8 >nul

start "" http://localhost:4567

echo   ==========================================
echo     启动完成，浏览器已自动打开：
echo     http://localhost:4567
echo.
echo     论坛在后台悄悄运行，这个窗口可以关掉
echo     想关闭论坛，请双击「停止论坛」
echo   ==========================================
timeout /t 5 >nul
exit
