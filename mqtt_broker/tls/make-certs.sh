#!/bin/zsh
# Bài 8: tạo CA riêng của nhóm + chứng chỉ máy chủ cho Mosquitto (8883) và app (HTTPS 3443)
# Dùng: ./make-certs.sh          -> tạo CA nếu chưa có, cấp lại chứng chỉ server theo IP hiện tại
#       ./make-certs.sh 1.2.3.4  -> cấp chứng chỉ cho IP chỉ định
# ca.key và server.key là KHÓA BÍ MẬT: không đưa lên git, không nộp bài (đã có trong .gitignore)
# ESP32 chỉ cần ca.crt (nhúng vào firmware/src/ca_cert.h); đổi IP chỉ cần cấp lại server.crt, CA giữ nguyên.
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$PATH"
IP=${1:-$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1)}
[[ -n "$IP" ]] || { echo "Không tìm thấy IP, truyền IP làm tham số"; exit 1; }

if [[ ! -f ca.key ]]; then
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 \
    -subj "/O=VJU BCSE/CN=NhaKinh IoT Lab CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
  echo "Đã tạo CA mới: ca.crt (nhớ chạy lại ./ca-header.sh và nạp lại ESP32)"
fi

# CN = IP và SAN có cả DNS:<IP> lẫn IP:<IP>: mbedTLS 2.x trên ESP32 chỉ so khớp dNSName/CN,
# còn Node.js/OpenSSL so khớp iPAddress khi kết nối bằng IP.
cat > server.ext <<EOF
basicConstraints=CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
subjectAltName=DNS:$IP,IP:$IP,DNS:$(scutil --get LocalHostName 2>/dev/null || echo nhakinh).local,DNS:localhost,IP:127.0.0.1
EOF
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/O=VJU BCSE/CN=$IP"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 825 -extfile server.ext
rm -f server.csr server.ext
chmod 600 ca.key server.key
echo "Chứng chỉ server cho $IP:"
openssl x509 -in server.crt -noout -subject -enddate -ext subjectAltName
