#!/bin/zsh
# Giả lập các nhóm để thử dashboard trước giờ học: ./sim.sh [số nhóm]
cd "$(dirname "$0")"
[[ -f .env ]] || cp .env.example .env
[[ -d node_modules ]] || npm install --cache .npm-cache || exit 1
exec node --env-file=.env tools/sim_nhom.js "$@"
