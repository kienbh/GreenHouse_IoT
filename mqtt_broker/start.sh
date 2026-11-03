#!/bin/zsh
# Chạy broker ở chế độ foreground (Ctrl+C để dừng), log hiện ngay trên terminal
cd "$(dirname "$0")"
export PATH="/opt/homebrew/sbin:/opt/homebrew/opt/mosquitto/sbin:/opt/homebrew/bin:/usr/local/sbin:$PATH"
[[ -f passwd ]] || ./setup.sh

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1)
echo "Broker: mqtt://${IP:-<ip-may>}:1883   ws://${IP:-<ip-may>}:9001"
echo "Ghi IP này vào firmware/src/secrets.h (MQTT_HOST) rồi nạp lại ESP32"
exec mosquitto -c mosquitto.conf
