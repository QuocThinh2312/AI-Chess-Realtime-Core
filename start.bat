@echo off
title AI Chess Realtime Core Local Server
color 0A

echo ==================================================
echo   [1/2] BIEN DICH EXTENSION TYPESCRIPT DONG BO...
echo ==================================================
cd extension
call npx tsc
cd ..

echo.
echo ==================================================
echo   [2/2] DANG KHOI DONG LO PHAN UNG (NODE.JS)...
echo ==================================================
cd chess-server
call npx ts-node src/server.ts

pause