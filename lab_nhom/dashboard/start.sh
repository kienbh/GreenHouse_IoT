#!/bin/zsh
# Chạy dashboard lớp: ./start.sh  rồi mở http://localhost:3100
cd "$(dirname "$0")"
[[ -f .env ]] || cp .env.example .env
# Cache npm riêng trong thư mục, tránh lỗi quyền ~/.npm
[[ -d node_modules ]] || npm install --cache .npm-cache || exit 1
exec node --env-file=.env server.js
