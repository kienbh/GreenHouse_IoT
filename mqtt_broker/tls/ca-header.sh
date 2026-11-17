#!/bin/zsh
# Sinh firmware/src/ca_cert.h từ ca.crt (chứng chỉ công khai, được phép đưa lên git)
cd "$(dirname "$0")"
OUT=../../firmware/src/ca_cert.h
{
  echo '#pragma once'
  echo '// CA của broker nhà kính, sinh bằng mqtt_broker/tls/ca-header.sh. ESP32 dùng để xác minh máy chủ MQTT (TLS).'
  echo 'static const char CA_CERT[] = R"PEM('
  cat ca.crt
  echo ')PEM";'
} > $OUT
echo "Đã ghi $OUT"
