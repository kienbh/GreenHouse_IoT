#!/bin/zsh
# Xem tin nhắn nhà kính qua TLS: ./sub.sh   (hoặc ./sub.sh 'vju/nhakinh/+/ack')
# Mặc định tài khoản chỉ đọc viewer (status/telemetry/ack); xem cả event/cmd: ACC=app ./sub.sh
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/mosquitto/bin:$PATH"
ACC=${ACC:-viewer}
exec mosquitto_sub -h localhost -p 8883 --cafile tls/ca.crt -u $ACC -P "$(awk -v u=$ACC '$1==u{print $2}' accounts.local)" -v -t "${1:-vju/nhakinh/#}"
