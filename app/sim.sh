#!/bin/zsh
# Giả lập 1 ESP32 (sim-01) để thử khi chưa cắm board: ./sim.sh
cd "$(dirname "$0")"
[[ -f .env ]] || cp .env.example .env
[[ -d node_modules ]] || npm install --cache .npm-cache || exit 1
exec node --env-file=.env tools/sim_esp32.js
