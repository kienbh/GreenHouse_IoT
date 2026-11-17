#!/bin/zsh
# Cài Mosquitto (nếu chưa có) và tạo tài khoản đăng nhập broker (Bài 8: không còn mật khẩu mặc định)
# Dùng: ./setup.sh            -> sinh mật khẩu NGẪU NHIÊN cho mọi tài khoản, ghi vào:
#                                accounts.local (tra cứu), ../app/.env, ../firmware/src/secrets.h
#       ./setup.sh ten matkhau -> thêm hoặc đổi mật khẩu 1 tài khoản (tự sửa .env / secrets.h nếu cần)
# Mọi file trên đều nằm trong .gitignore. Sau khi đổi mật khẩu ESP32 phải nạp lại firmware.
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/opt/homebrew/opt/mosquitto/bin:/usr/local/bin:$PATH"

if ! command -v mosquitto_passwd >/dev/null; then
  echo "Chưa có Mosquitto, cài bằng Homebrew..."
  brew install mosquitto || exit 1
fi
mkdir -p data log

# Tài khoản và vai (quyền chi tiết trong file acl):
#   app       dịch vụ app nhà kính: đọc dữ liệu mọi node, là bên DUY NHẤT được gửi lệnh (topic cmd)
#   viewer    chỉ đọc telemetry/status/ack (sub.sh, MQTT Explorer)
#   esp32-01  ESP32 nhà kính: chỉ ghi dữ liệu của chính nó, chỉ nhận lệnh của chính nó
#   sim-01    bộ giả lập trên PC, quyền giống một node
#   sleep-01  node chỉ đo thử ngủ sâu (Bài 9)
USERS=(app viewer esp32-01 sim-01 sleep-01)

# Thay giá trị KEY=... trong file .env (tạo dòng mới nếu chưa có)
set_env() {
  local file=$1 key=$2 val=$3
  [[ -f $file ]] || return 0
  if grep -q "^$key=" $file; then sed -i '' "s|^$key=.*|$key=$val|" $file; else echo "$key=$val" >> $file; fi
}
apply() {
  local u=$1 p=$2
  case $u in
    app)      set_env ../app/.env MQTT_PASS $p ;;
    sim-01)   set_env ../app/.env SIM_PASS $p ;;
    esp32-01) [[ -f ../firmware/src/secrets.h ]] && sed -i '' \
                -e "s|^#define MQTT_USER .*|#define MQTT_USER  \"esp32-01\"|" \
                -e "s|^#define MQTT_PASS .*|#define MQTT_PASS  \"$p\"|" ../firmware/src/secrets.h ;;
  esac
  if [[ -f accounts.local ]] && grep -q "^$u " accounts.local; then
    sed -i '' "s|^$u .*|$u $p|" accounts.local
  else echo "$u $p" >> accounts.local; fi
}

touch passwd accounts.local; chmod 600 passwd accounts.local
if [[ -n "$1" ]]; then
  [[ -n "$2" ]] || { echo "Thiếu mật khẩu"; exit 1; }
  mosquitto_passwd -b passwd "$1" "$2"
  apply "$1" "$2"
  echo "Đã cập nhật tài khoản $1"
else
  : > passwd; : > accounts.local
  echo "# Mật khẩu broker sinh ngày $(date +%F). KHÔNG đưa lên git, không nộp bài." >> accounts.local
  for u in $USERS; do
    p=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
    mosquitto_passwd -b passwd $u $p
    apply $u $p
  done
  set_env ../app/.env MQTT_USER app
  set_env ../app/.env SIM_USER sim-01
  echo "Đã tạo ${#USERS} tài khoản mật khẩu ngẫu nhiên, xem mqtt_broker/accounts.local"
fi
chmod 600 passwd accounts.local
# Broker đang chạy thì nạp lại file mật khẩu/ACL ngay
pkill -HUP -x mosquitto 2>/dev/null && echo "Đã nạp lại broker" || true
