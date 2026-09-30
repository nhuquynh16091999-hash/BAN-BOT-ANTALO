#!/usr/bin/env bash
# Mở web Bắn bot ra Internet — NGƯỜI QUẢN TRỊ server tự chạy, một lần sau khi cài.
#
#   ssh -t root@<server> bash /opt/banbot/deploy/mo-cong.sh
#
# Script này đổi thiết lập bảo mật của máy chủ nên không tự chạy trong deploy:
#   1. SELinux: cho nginx nghe cổng 8447 (web) + 8448 (ảnh) và chuyển tiếp vào app
#   2. Tường lửa: mở cổng 8447 + 8448
#   3. Bật nginx
# Chạy lại lần nữa vẫn an toàn. Không hỏi gì, không cần gõ gì.
#
# Web KHÔNG có đăng nhập — chủ dự án chọn ngày 30/09/2026. Muốn bật lại đăng
# nhập: xem mục "Bật lại đăng nhập" trong deploy/SERVER.md.
set -euo pipefail

PORTS=(8447 8448)

echo "1/3 SELinux: cho nginx dùng cổng ${PORTS[*]}…"
if command -v semanage >/dev/null 2>&1 && [ "$(getenforce 2>/dev/null)" != "Disabled" ]; then
    for p in "${PORTS[@]}"; do
        semanage port -a -t http_port_t -p tcp "$p" 2>/dev/null || semanage port -m -t http_port_t -p tcp "$p"
    done
    setsebool -P httpd_can_network_connect 1
fi

echo "2/3 Tường lửa: mở cổng ${PORTS[*]}…"
if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port=8447-8448/tcp >/dev/null
    firewall-cmd --reload >/dev/null
fi

echo "3/3 Bật nginx…"
nginx -t
systemctl enable --now nginx >/dev/null 2>&1
systemctl reload nginx

IP=$(hostname -I | awk '{print $1}')
echo
echo "✅ Xong. Mở https://$IP:8447"
