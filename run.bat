@echo off
REM Di chuyển đến thư mục chứa file package.json và node_modules
cd "C:\POSTING\drive-proxy"

REM Bắt đầu thực thi lệnh npm start
echo.
echo Khoi dong Drive Proxy...

REM Lệnh npm start sẽ chạy chương trình Node.js
npm start

REM Lệnh PAUSE để giữ cửa sổ Console mở nếu chương trình Node.js chạy xong (không cần thiết nếu nó chạy nền)
PAUSE