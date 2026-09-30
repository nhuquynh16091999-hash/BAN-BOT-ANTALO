#!/usr/bin/env bash
# Mở web Bắn bot ra Internet — NGƯỜI QUẢN TRỊ server tự chạy, một lần sau khi cài.
#
#   ssh -t root@<server> bash /opt/banbot/deploy/mo-cong.sh
#
# Script này đổi thiết lập bảo mật của máy chủ nên không tự chạy trong deploy:
#   1. SELinux: cho nginx nghe cổng 8447 (web) + 8448 (ảnh) và chuyển tiếp vào app
#   2. Tường lửa: mở cổng 8447 + 8448
#   3. Tạo tài khoản đăng nhập web (tên admin) — mật khẩu do người chạy tự gõ
#   4. Bật nginx
# Chạy lại lần nữa vẫn an toàn; bước 3 hỏi trước khi thay mật khẩu cũ.
set -euo pipefail

PORTS=(8447 8448)
HTPASSWD=/etc/nginx/banbot.htpasswd

echo "1/4 SELinux: cho nginx dùng cổng ${PORTS[*]}…"
if command -v semanage >/dev/null 2>&1 && [ "$(getenforce 2>/dev/null)" != "Disabled" ]; then
    for p in "${PORTS[@]}"; do
        semanage port -a -t http_port_t -p tcp "$p" 2>/dev/null || semanage port -m -t http_port_t -p tcp "$p"
    done
    setsebool -P httpd_can_network_connect 1
fi

echo "2/4 Tường lửa: mở cổng ${PORTS[*]}…"
if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-port=8447-8448/tcp >/dev/null
    firewall-cmd --reload >/dev/null
fi

echo "3/4 Tài khoản đăng nhập web (tên: admin)…"
if [ -s "$HTPASSWD" ]; then
    read -r -p "   Đã có tài khoản. Đặt lại mật khẩu? [y/N] " again
else
    again=y
fi
if [[ "$again" =~ ^[yY]$ ]]; then
    echo "   Gõ mật khẩu mới 2 lần (màn hình không hiện chữ — bình thường):"
    htpasswd -B -c "$HTPASSWD" admin
fi
chown root:nginx "$HTPASSWD"
chmod 640 "$HTPASSWD"

echo "4/4 Bật nginx…"
nginx -t
systemctl enable --now nginx >/dev/null 2>&1
systemctl reload nginx

IP=$(hostname -I | awk '{print $1}')
echo
echo "✅ Xong. Mở https://$IP:8447 — đăng nhập bằng admin + mật khẩu vừa đặt"
