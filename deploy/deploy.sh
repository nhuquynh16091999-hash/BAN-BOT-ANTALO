#!/usr/bin/env bash
# Đẩy bản mới lên VPS của bản clone. Dùng SSH key (host "banbot-antalo" trong ~/.ssh/config).
#
#   bash deploy/deploy.sh
#   RELOAD_CRON=1 bash deploy/deploy.sh    # khi đổi lịch trong ecosystem.config.cjs
#
# ⚠️ Đây là bản CLONE. Chỉ deploy lên server của bản clone — KHÔNG trỏ BANBOT_HOST
#    về server của dự án cũ.
#
# KHÔNG đụng tới .env, web/.env.local và config/pos-shops.json trên server — các
# file đó chứa bí mật, chỉ sửa trực tiếp trên server.
#
# Giao diện được BUILD TRÊN MÁY NÀY rồi mới đẩy lên: server chỉ ~1GB RAM và chạy
# chung dự án khác, build Next.js trên đó dễ tràn bộ nhớ kéo sập cả máy.
set -euo pipefail
cd "$(dirname "$0")/.."

HOST=${BANBOT_HOST:-banbot-antalo}
DIR=${BANBOT_DIR:-/opt/banbot}

echo "▶ Kiểm tra trước khi đẩy…"
npx tsc --noEmit
npm run test:smoke

echo "▶ Biên dịch engine + giao diện…"
npm run build
(cd web && rm -rf .next && npx next build)

echo "▶ Đẩy engine lên $HOST:$DIR…"
rsync -az --delete ./dist "$HOST:$DIR/"
rsync -az ./migrations ./kich-ban ./deploy ./docs ./package.json ./package-lock.json ./ecosystem.config.cjs ./README.md "$HOST:$DIR/"

echo "▶ Đẩy giao diện (đã build sẵn)…"
# Bỏ node_modules của mã nguồn (server tự cài) nhưng GIỮ web/.next/node_modules:
# đó là các liên kết Next.js dùng để nạp pg/sharp lúc chạy — thiếu là API lỗi 500.
# Mẫu có "/" đầu chỉ khớp đúng đường dẫn đó, không khớp mọi thư mục cùng tên.
rsync -az --delete \
    --exclude /web/node_modules --exclude /web/.next/cache --exclude /web/.env.local \
    ./web "$HOST:$DIR/"

echo "▶ Cài gói + migrate + khởi động lại…"
ssh "$HOST" "cd $DIR \
  && chown -R root:root $DIR/dist $DIR/web $DIR/migrations $DIR/deploy \
  && npm ci --omit=dev --silent \
  && node dist/db/migrate.js \
  && cd web && npm ci --omit=dev --silent && cd $DIR \
  && pm2 restart banbot-web banbot-ui --update-env \
  && pm2 save >/dev/null"

# CẢNH BÁO: pm2 restart KHÔNG nạp lại cron_restart. Đổi lịch trong
# ecosystem.config.cjs thì phải XOÁ rồi TẠO LẠI tiến trình, không thì pm2 vẫn
# chạy lịch cũ mà không báo gì.
if [ "${RELOAD_CRON:-0}" = "1" ]; then
  echo "▶ Nạp lại lịch cho các job theo cron…"
  ssh "$HOST" "cd $DIR \
    && pm2 delete banbot-send banbot-sync banbot-pos banbot-health >/dev/null 2>&1
    pm2 start ecosystem.config.cjs --only banbot-send,banbot-sync,banbot-pos,banbot-health >/dev/null \
    && pm2 save >/dev/null && echo '  đã nạp lịch mới'"
fi

echo "▶ Kiểm tra còn sống…"
ssh "$HOST" "curl -s -o /dev/null -w 'dashboard → HTTP %{http_code}\n' http://127.0.0.1:3110/healthz
             curl -s -o /dev/null -w 'giao diện → HTTP %{http_code}\n' http://127.0.0.1:3112/
             curl -s -o /dev/null -w 'API page  → HTTP %{http_code}\n' 'http://127.0.0.1:3112/api/broadcast?getPages=true'"

IP=$(ssh -G "$HOST" | awk '/^hostname /{print $2}')
echo "✅ Xong → giao diện https://$IP:8447 · dashboard https://$IP:8446"
