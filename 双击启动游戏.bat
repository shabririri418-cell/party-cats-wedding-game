@echo off
chcp 65001 >nul
title Party Cats 本地游戏服务
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-party-cats.ps1"
if errorlevel 1 pause
