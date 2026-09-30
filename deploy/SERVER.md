# Vận hành trên VPS (bản clone)

Máy chủ: host `banbot-antalo` trong `~/.ssh/config` (không ghi địa chỉ thật vào
repo). CentOS Stream 9, **1 CPU, ~1GB RAM + 2,3GB swap**, cài tại `/opt/banbot`.

> ⚠️ Đây là bản **clone**. Không deploy, không SSH, không đụng tới server hay repo
> GitHub của dự án cũ.
>
> Máy này **chạy chung** dự án TALPHA dashboard (`/opt/talpha`, pm2 `talpha-*`,
> cổng 3000). Đừng đụng tiến trình của họ, và giữ Bắn bot nhẹ: không build
> Next.js trên máy, không chạy thứ không cần.

| Thành phần | Giá trị |
|---|---|
| Giao diện chính | `https://<IP>:8447` — nginx (HTTPS + đăng nhập) → 127.0.0.1:3112 |
| Dashboard báo cáo | `https://<IP>:8446` — nginx (HTTPS + đăng nhập) → 127.0.0.1:3110 |
| Ảnh gửi cho khách | `http://<IP>:8448/api/media/…` — nginx, KHÔNG đăng nhập, chỉ mở đúng đường dẫn ảnh |
| Đăng nhập | một tài khoản `admin` chung cho 8446 + 8447, file `/etc/nginx/banbot.htpasswd` |
| Database | PostgreSQL 16 (`dnf module postgresql:16`), database `banbot`, vai trò `root` qua socket — **không mật khẩu**, chỉ nghe localhost |
| Cấu hình Postgres | `/var/lib/pgsql/data/conf.d-banbot.conf` — shared_buffers 64MB, max_connections 60 |
| Bí mật | `/opt/banbot/.env`, `/opt/banbot/web/.env.local` (chmod 600) — KHÔNG có trong git |
| nginx | `/etc/nginx/conf.d/banbot.conf`, chứng chỉ tự ký `/etc/nginx/certs/banbot.*` |
| Log | `/root/.pm2/logs/banbot-*.log` |

## Cài lần đầu — thứ tự đã làm

1. `dnf module enable postgresql:16 && dnf install postgresql-server nginx httpd-tools policycoreutils-python-utils`
2. `postgresql-setup --initdb`, thêm `conf.d-banbot.conf`, `createuser root`, `createdb -O root banbot`
3. Đẩy code (`deploy/deploy.sh` làm phần này), viết `.env` + `web/.env.local`, `node dist/db/migrate.js`
4. `pm2 start ecosystem.config.cjs --only banbot-ui,banbot-web,banbot-send,banbot-sync,banbot-pos,banbot-health && pm2 save`
5. **Người quản trị tự chạy** `ssh -t banbot-antalo bash /opt/banbot/deploy/mo-cong.sh`:
   SELinux cho nginx dùng cổng 8446–8448, mở tường lửa, đặt mật khẩu đăng nhập, bật nginx.
   Bước này đổi thiết lập bảo mật của máy nên không nằm trong deploy tự động.
6. Điền token thật vào `/opt/banbot/.env`: `PANCAKE_CRM_TOKEN` (bắt buộc),
   `FB_USER_ACCESS_TOKEN` + `FB_APP_SECRET` (đường dự phòng). Chưa điền thì engine
   không lấy được khách nào.

`web/.env.local` có `PUBLIC_URL=http://<IP>:8448` — link ảnh lưu kèm địa chỉ này
để engine và Facebook tải được (Facebook không chấp nhận chứng chỉ tự ký, nên ảnh
đi HTTP). Giao diện xem trước ảnh qua đường tương đối nên không bị chặn vì trộn
HTTP/HTTPS.

## Tiến trình pm2

| Tên | Lịch | Việc |
|---|---|---|
| `banbot-ui` | liên tục | giao diện chính (Next.js) |
| `banbot-web` | liên tục | dashboard báo cáo |
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
pm2 delete banbot-ui banbot-web banbot-send banbot-sync banbot-pos banbot-health && pm2 save
rm /etc/nginx/conf.d/banbot.conf && systemctl reload nginx
# dữ liệu vẫn còn trong database banbot — xoá riêng nếu muốn: dropdb banbot
```
