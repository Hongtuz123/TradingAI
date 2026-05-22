@echo off
title 荳荳AI股票篩選器 - 啟動器
chcp 65001 > nul

echo 正在啟動後端 API 服務...
start "荳荳AI選股後端" cmd /k "cd /d "%~dp0backend" && python main.py"

echo 正在開啟瀏覽器畫面...
timeout /t 2 > nul
start chrome "%~dp0index.html"

echo 啟動完成！後端視窗請勿關閉。
timeout /t 3 > nul
