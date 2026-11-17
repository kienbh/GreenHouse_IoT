#!/bin/zsh
# Gửi lệnh thô tới ESP32 qua TLS bằng tài khoản dịch vụ app: ./pub.sh '{"ledR":1}' [thiết-bị]
# Lưu ý: đi thẳng broker nên KHÔNG qua kiểm quyền/audit của app và không có cmd_id (ESP32 không gửi ack).
# Vận hành thường ngày hãy dùng dashboard hoặc POST /api/cmd.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/mosquitto/bin:$PATH"
exec mosquitto_pub -h localhost -p 8883 --cafile tls/ca.crt -u app -P "$(awk '$1=="app"{print $2}' accounts.local)" -q 1 \
  -t "vju/nhakinh/${2:-esp32-01}/cmd" -m "${1:-{\"ledG\":1}}"
