#!/bin/zsh
# Bài 8: bảng ca thử TLS + tài khoản + ACL trên broker đang chạy. Dùng: ./test-acl.sh [IP]
# Mỗi ca publish một bản tin "PROBE-<số>" rồi xem dịch vụ app (đăng ký qua TLS) có thực sự nhận được không.
# Lưu ý: MQTT 3.1.1 không báo lỗi cho bên gửi khi bị ACL chặn (broker vẫn trả PUBACK rồi bỏ bản tin),
# nên phải kiểm ở BÊN NHẬN, không dựa vào mã thoát của mosquitto_pub.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$PATH"
IP=${1:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1)}
CA=tls/ca.crt
pw() { awk -v u=$1 '$1==u{print $2}' accounts.local; }
TMP=$(mktemp)
n=0
row() { printf '| %-48s | %-10s | %s\n' "$1" "$2" "$3"; }

# Ca kết nối: mã thoát của mosquitto_sub cho biết bị từ chối ở bước nào
conn() {
  local name=$1 expect=$2; shift 2
  out=$("$@" -t probe/none -C 1 -W 3 2>&1); rc=$?
  case $rc in 27) res="KẾT NỐI OK";; 5) res="TỪ CHỐI: sai tài khoản/mật khẩu";; *) res="TỪ CHỐI TLS (rc=$rc ${out:0:40})";; esac
  row "$name" "$expect" "$res"
}
# Ca quyền: publish rồi kiểm bên nhận
probe() {
  local name=$1 expect=$2 topic=$3; shift 3
  n=$((n+1)); local msg="PROBE-$n-$$"
  mosquitto_sub -h $IP -p 8883 --cafile $CA -u app -P "$(pw app)" -t "$topic" -C 1 -W 4 > $TMP 2>&1 &
  local sp=$!; sleep 1
  "$@" -m "$msg" -q 1 >/dev/null 2>&1
  wait $sp
  if grep -q "$msg" $TMP; then row "$name" "$expect" "ĐI QUA (bên nhận thấy)"; else row "$name" "$expect" "BỊ CHẶN (bên nhận không thấy)"; fi
}

echo "Broker $IP · $(date '+%F %T') · $(mosquitto -h 2>/dev/null | head -1)"
row "Ca thử" "Mong đợi" "Kết quả thực tế"
row "------" "--------" "---------------"
conn  "viewer, đúng mật khẩu, CA nhóm, TLS 8883"     "kết nối"  mosquitto_sub -h $IP -p 8883 --cafile $CA -u viewer -P "$(pw viewer)"
conn  "viewer, SAI mật khẩu"                         "từ chối"  mosquitto_sub -h $IP -p 8883 --cafile $CA -u viewer -P sai-mat-khau
conn  "không tài khoản ở cổng TLS"                    "từ chối"  mosquitto_sub -h $IP -p 8883 --cafile $CA
conn  "CA không tin cậy (CA hệ thống, không có CA nhóm)" "từ chối"  mosquitto_sub -h $IP -p 8883 --capath /etc/ssl/certs -u viewer -P "$(pw viewer)"
# Sai tên máy chủ: kết nối đúng IP nhưng đòi tên không có trong chứng chỉ (SAN hiện có IP, localhost, <máy>.local)
if openssl s_client -connect $IP:8883 -CAfile $CA -verify_hostname sai-ten.vju.local -verify_return_error </dev/null >/dev/null 2>&1
then row "sai tên máy chủ (sai-ten.vju.local)" "từ chối" "KẾT NỐI OK"
else row "sai tên máy chủ (sai-ten.vju.local)" "từ chối" "TỪ CHỐI TLS (hostname mismatch)"; fi
probe "app gửi lệnh qua TLS (dịch vụ)"               "đi qua"   'vju/nhakinh/+/cmd'      mosquitto_pub -h $IP -p 8883 --cafile $CA -u app -P "$(pw app)" -t vju/nhakinh/sim-01/cmd
probe "esp32-01 gửi telemetry của mình"              "đi qua"   'vju/nhakinh/esp32-01/telemetry' mosquitto_pub -h $IP -p 8883 --cafile $CA -u esp32-01 -P "$(pw esp32-01)" -t vju/nhakinh/esp32-01/telemetry
probe "esp32-01 tự gửi lệnh lên cmd"                 "chặn"     'vju/nhakinh/+/cmd'      mosquitto_pub -h $IP -p 8883 --cafile $CA -u esp32-01 -P "$(pw esp32-01)" -t vju/nhakinh/esp32-01/cmd
probe "esp32-01 giả làm sim-01 (telemetry)"          "chặn"     'vju/nhakinh/sim-01/telemetry' mosquitto_pub -h $IP -p 8883 --cafile $CA -u esp32-01 -P "$(pw esp32-01)" -t vju/nhakinh/sim-01/telemetry
probe "viewer gửi lệnh"                              "chặn"     'vju/nhakinh/+/cmd'      mosquitto_pub -h $IP -p 8883 --cafile $CA -u viewer -P "$(pw viewer)" -t vju/nhakinh/esp32-01/cmd
probe "tài khoản app ở cổng 1883 không mã hóa"       "chặn"     'vju/nhakinh/+/cmd'      mosquitto_pub -h $IP -p 1883 -u app -P "$(pw app)" -t vju/nhakinh/sim-01/cmd
probe "vô danh ở 1883 ghi vào nhánh nhà kính"         "chặn"     'vju/nhakinh/+/cmd'      mosquitto_pub -h $IP -p 1883 -t vju/nhakinh/esp32-01/cmd
rm -f $TMP
