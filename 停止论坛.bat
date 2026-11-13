@echo off
chcp 65001 >nul
title 停止校园论坛
cd /d D:\nodebb

echo.
echo   正在停止校园论坛...
echo.
node nodebb stop

echo.
echo   已停止。下次想打开就双击「启动论坛」。
pause
