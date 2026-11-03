#!/bin/zsh
# Xem mọi tin nhắn của nhà kính: ./sub.sh   (hoặc ./sub.sh '#' để xem tất cả topic)
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/mosquitto/bin:$PATH"
exec mosquitto_sub -h localhost -u app -P apppass -v -t "${1:-vju/nhakinh/#}"
