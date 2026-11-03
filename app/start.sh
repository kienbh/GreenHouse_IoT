#!/bin/zsh
# Chạy app nhà kính: ./start.sh  rồi mở http://localhost:3000
cd "$(dirname "$0")"
[[ -f .env ]] || cp .env.example .env
# Cache npm riêng trong thư mục app, tránh lỗi quyền ~/.npm
[[ -d node_modules ]] || npm install --cache .npm-cache || exit 1
exec node --env-file=.env server.js
