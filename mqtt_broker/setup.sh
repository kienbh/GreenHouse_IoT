#!/bin/zsh
# Cài Mosquitto (nếu chưa có) và tạo tài khoản đăng nhập broker
# Dùng: ./setup.sh            -> tạo 2 tài khoản mặc định esp32 / app
#       ./setup.sh ten matkhau -> thêm hoặc đổi mật khẩu 1 tài khoản
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/opt/homebrew/opt/mosquitto/bin:/usr/local/bin:$PATH"

if ! command -v mosquitto_passwd >/dev/null; then
  echo "Chưa có Mosquitto, cài bằng Homebrew..."
  brew install mosquitto || exit 1
fi

mkdir -p data log
if [[ -n "$1" ]]; then
  [[ -f passwd ]] || { touch passwd; chmod 600 passwd; }
  mosquitto_passwd -b passwd "$1" "$2"
  echo "Đã cập nhật tài khoản $1"
else
  # Mật khẩu mặc định cho bài thực hành, phải khớp firmware/src/secrets.h và app/.env
  rm -f passwd
  touch passwd; chmod 600 passwd
  mosquitto_passwd -b passwd esp32 esp32pass
  mosquitto_passwd -b passwd app apppass
  echo "Đã tạo tài khoản: esp32/esp32pass, app/apppass"
fi
chmod 600 passwd
