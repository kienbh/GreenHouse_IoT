#!/bin/zsh
# Gửi lệnh tới ESP32: ./pub.sh '{"ledR":1}'   ./pub.sh '{"pump":1}'   ./pub.sh '{"duty":60}'
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/mosquitto/bin:$PATH"
exec mosquitto_pub -h localhost -u app -P apppass -t "vju/nhakinh/${2:-esp32-01}/cmd" -m "${1:-{\"ledG\":1}}"
