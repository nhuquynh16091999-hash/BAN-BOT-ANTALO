# Vận hành trên VPS (bản clone)

Máy chủ: host `banbot-antalo` trong `~/.ssh/config` (không ghi địa chỉ thật vào
repo). CentOS Stream 9, **1 CPU, ~1GB RAM + 2,3GB swap**, cài tại `/opt/banbot`.

> ⚠️ Đây là bản **clone**. Không deploy, không SSH, không đụng tới server hay repo
> GitHub của dự án cũ.
>
> Máy này **chạy chung** dự án khác: TALPHA dashboard (`/opt/talpha`, pm2
> `talpha-*`, cổng 3000) và AI Sale (nginx cổng 80 + 8449). Đừng đụng tiến trình
> hay file nginx của họ, và giữ Bắn bot nhẹ: không build Next.js trên máy.
>
> Dashboard riêng (cổng 8446, pm2 `banbot-web`) đã **gộp vào trang web chính**
> ngày 30/09/2026 — chỉ còn một link.

| Thành phần | Giá trị |
|---|---|
| Web (trang DUY NHẤT) | `https://<IP>:8447` — nginx (HTTPS, **không đăng nhập**) → 127.0.0.1:3112. Gồm cả soạn kịch bản, bắn tay, theo dõi, hiệu quả, tra cứu khách |
| Ảnh gửi cho khách | `http://<IP>:8448/api/media/…` — nginx, KHÔNG đăng nhập, chỉ mở đúng đường dẫn ảnh |
| Đăng nhập | **Không có** — chủ dự án chọn ngày 30/09/2026. Ai biết link đều vào được, xem được khách và bấm gửi tin. nginx gửi `X-Robots-Tag: noindex` để công cụ tìm kiếm không lưu trang. Bật lại: xem cuối file |
| Database | PostgreSQL 16 (`dnf module postgresql:16`), database `banbot`, vai trò `root` qua socket — **không mật khẩu**, chỉ nghe localhost |
| Cấu hình Postgres | `/var/lib/pgsql/data/conf.d-banbot.conf` — shared_buffers 64MB, max_connections 60 |
| Bí mật | `/opt/banbot/.env`, `/opt/banbot/web/.env.local` (chmod 600) — KHÔNG có trong git |
| nginx | `/etc/nginx/conf.d/banbot.conf` |
| Chứng chỉ 8447 | **Let's Encrypt cho IP** `/etc/letsencrypt/live/<IP>/` — trình duyệt không báo đỏ. Do cấu hình AI Sale (cùng máy) cấp, profile ngắn hạn ~6 ngày, `certbot-renew.timer` tự gia hạn qua cổng 80 rồi reload nginx. Dự phòng: chứng chỉ tự ký `/etc/nginx/certs/banbot.*` |
| Log | `/root/.pm2/logs/banbot-*.log` |

## Cài lần đầu — thứ tự đã làm

1. `dnf module enable postgresql:16 && dnf install postgresql-server nginx httpd-tools policycoreutils-python-utils`
2. `postgresql-setup --initdb`, thêm `conf.d-banbot.conf`, `createuser root`, `createdb -O root banbot`
3. Đẩy code (`deploy/deploy.sh` làm phần này), viết `.env` + `web/.env.local`, `node dist/db/migrate.js`
4. `pm2 start ecosystem.config.cjs --only banbot-ui,banbot-send,banbot-sync,banbot-pos,banbot-health && pm2 save`
5. **Người quản trị tự chạy** `ssh -t banbot-antalo bash /opt/banbot/deploy/mo-cong.sh`:
   SELinux cho nginx dùng cổng 8447 + 8448, mở tường lửa, bật nginx. Không hỏi gì.
   Bước này đổi thiết lập bảo mật của máy nên không nằm trong deploy tự động.
6. Điền token thật vào `/opt/banbot/.env`: `PANCAKE_CRM_TOKEN` (bắt buộc),
   `FB_USER_ACCESS_TOKEN` + `FB_APP_SECRET` (đường dự phòng). Chưa điền thì engine
   không lấy được khách nào.

> ⚠️ Gia hạn chứng chỉ cần **nginx đang chạy** (cổng 80). Nginx chỉ bật sau khi
> chạy `mo-cong.sh` — chạy trễ quá hạn chứng chỉ thì 8447 hết hạn, phải cấp lại.
> Nếu gia hạn hỏng: đổi `ssl_certificate` trong banbot.conf về `/etc/nginx/certs/banbot.*` rồi reload.

`web/.env.local` có `PUBLIC_URL=http://<IP>:8448` — link ảnh lưu kèm địa chỉ này
để engine và Facebook tải được (Facebook không chấp nhận chứng chỉ tự ký, nên ảnh
đi HTTP). Giao diện xem trước ảnh qua đường tương đối nên không bị chặn vì trộn
HTTP/HTTPS.

## Tiến trình pm2

| Tên | Lịch | Việc |
|---|---|---|
| `banbot-ui` | liên tục | trang web duy nhất (Next.js) |
| `banbot-sync` | 5,20,35,50 | page đang 3h sáng giờ địa phương → quét đầy đủ; page khác → quét nhanh khách mới nhắn |
| `banbot-send` | mỗi phút | gửi lượt tới hạn (cả theo lịch lẫn bắn tay) |
| `banbot-pos` | 8,23,38,53 | đối chiếu đơn POS (cần `config/pos-shops.json`) |
| `banbot-health` | 2,17,32,47 | giám sát sức khoẻ page |

`banbot-webhook` **không chạy** trên máy này: chưa có hệ thống nào gọi vào, chạy
chỉ tốn RAM. Cần thì `pm2 start ecosystem.config.cjs --only banbot-webhook`
(xem mục webhook bên dưới trước khi mở ra ngoài).

Job theo lịch dùng `autorestart:false` + `cron_restart` → trạng thái `stopped`
giữa hai lượt là **bình thường**, không phải lỗi.

### ⚠️ Đổi lịch chạy thì phải TẠO LẠI tiến trình

`pm2 restart` **không** nạp lại `cron_restart` — pm2 vẫn chạy lịch cũ và không
báo gì. Dùng `RELOAD_CRON=1 bash deploy/deploy.sh`, rồi kiểm tra
`pm2 describe banbot-sync | grep cron`.

## Deploy bản mới

```bash
bash deploy/deploy.sh                  # từ máy dev
RELOAD_CRON=1 bash deploy/deploy.sh    # khi đổi lịch trong ecosystem.config.cjs
```

Script kiểm tra + build **trên máy dev** (kể cả giao diện Next.js) rồi mới đẩy lên.
Đừng `npm run build` trong `web/` trên server — 1GB RAM không đủ, dễ kéo sập cả
dự án chạy chung.

## Lệnh hay dùng

```bash
ssh banbot-antalo
cd /opt/banbot

node dist/scripts/list-pages.js                      # page mà token Pancake nhìn thấy
node dist/scripts/add-page.js --page <id> --market Saudi
node dist/jobs/sync.js --page <id> --dry-run         # thử, không ghi
node dist/scripts/add-page.js --page <id> --market Saudi --activate   # BẮT ĐẦU GỬI

pm2 logs banbot-send --lines 50
psql -d banbot
```

## Bật một page — thứ tự

1. `add-page` (chưa bật)
2. Soạn 12 tin trên giao diện (màn **Kịch bản tự động**, có ô "Chép từ page khác…")
   — **không có kịch bản thì page không gửi được gì**
3. `sync --dry-run` xem quét được bao nhiêu khách
4. Bật trên giao diện (nút **Bật chiến dịch**) ← **từ đây mới thật sự gửi tin cho khách**

Page mới bật gửi đủ tệp ngay (nghiệp vụ 29/09). Page chưa từng đồng bộ được
`banbot-sync` quét đầy đủ ở lượt kế tiếp (tối đa 15 phút).

## Cổng và bảo mật

Các tiến trình Bắn bot chỉ nghe trên **127.0.0.1**; nginx là cửa duy nhất vào từ ngoài.
Postgres chỉ nghe localhost, đăng nhập bằng danh tính hệ điều hành (peer), không
có mật khẩu nào để lộ.

### Webhook

`WEBHOOK_SECRET` còn trống. Mở webhook ra Internet khi chưa có secret nghĩa là
**ai cũng gửi đơn giả vào được**, khiến khách thật bị đánh dấu "đã mua" và ngừng
nhận tin. Muốn mở: đặt `WEBHOOK_SECRET`, chạy `banbot-webhook`, thêm server nginx trỏ vào.

## Gỡ cài đặt

```bash
pm2 delete banbot-ui banbot-send banbot-sync banbot-pos banbot-health && pm2 save
rm /etc/nginx/conf.d/banbot.conf && systemctl reload nginx
# dữ liệu vẫn còn trong database banbot — xoá riêng nếu muốn: dropdb banbot
```

## Bật lại đăng nhập

Web đang mở không đăng nhập theo lựa chọn của chủ dự án. Muốn khoá lại:

```bash
htpasswd -B -c /etc/nginx/banbot.htpasswd admin     # gõ mật khẩu 2 lần (cần terminal gõ được)
chown root:nginx /etc/nginx/banbot.htpasswd && chmod 640 /etc/nginx/banbot.htpasswd
```

Rồi thêm vào khối `listen 8447` trong `/etc/nginx/conf.d/banbot.conf`:

```nginx
    auth_basic           "Ban bot";
    auth_basic_user_file /etc/nginx/banbot.htpasswd;
```

và `nginx -t && systemctl reload nginx`. Cách không cần mật khẩu: chỉ cho vài IP vào
(`allow <IP>; deny all;` trong cùng khối).
