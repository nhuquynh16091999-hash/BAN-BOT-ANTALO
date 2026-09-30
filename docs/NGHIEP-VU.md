# Nghiệp vụ Bắn bot — chốt ngày 29/09/2026

Chủ dự án trả lời bộ 20 câu hỏi trắc nghiệm để xác nhận lại nghiệp vụ trước khi
xây bản mới trên nền v2. File này là **nguồn sự thật**: code lệch với file này là
code sai. Đổi nghiệp vụ thì sửa file này trước, rồi mới sửa code.

## Bảng 20 câu trả lời

| # | Câu hỏi | Đã chốt | Hệ thống làm gì | Cấu hình |
|---|---|---|---|---|
| 1 | Nền tảng | Xây tiếp trên v2 | Giữ kiến trúc v2: Postgres, hàng đợi chống trùng, job riêng biệt | — |
| 2 | Nơi chạy | VPS thuê, 24/7 | pm2 trên VPS, xem `deploy/SERVER.md` | `ecosystem.config.cjs` |
| 3 | Số page | Trên 20 | Job SEND gửi **song song nhiều page** thay vì lần lượt — page cuối danh sách không bị trễ mất khung giờ | `SEND_PAGE_CONCURRENCY=10` |
| 4 | Thị trường | Vùng Vịnh · Đài Loan · Singapore → **30/09: chạy cả 37 page** | Thêm Singapore, Philippines, Hồng Kông, Việt Nam (giờ cố định) và **Ý (tự đổi giờ mùa hè theo Europe/Rome)**; từ từ chối tiếng Mã Lai. 11 page chưa rõ nước chủ dự án tự gán sau | `src/config/markets.ts` |
| 5 | Gửi cho ai | Khách chưa chốt đơn **lần này** | Khách mua từ lâu mà nay nhắn lại vẫn được chăm; chỉ dừng khi chốt đơn mới | `POS_CONVERT_MODE=increase` |
| 6 | Biết khách đã chốt | Đơn POS · Tag · **Khách để lại SĐT** | Thêm luật SĐT: SĐT để lại **trong chuỗi này** → dừng chuỗi, huỷ lượt còn chờ | `CONVERT_ON_PHONE=true` |
| 7 | Khách mới nhắn < 24h | **Gửi luôn** | Job SYNC **quét nhanh mỗi 15 phút** → khách vừa nhắn vào chuỗi ngay trong ngày, nhận tin ở khung giờ gần nhất | `SYNC_QUICK_ENABLED=true` |
| 8 | Khách trả lời bot | Chỉ dừng khi từ chối | Trả lời bình thường vẫn nhận tiếp; nhắn "stop", "توقف", "不要再傳", "berhenti"… thì dừng vĩnh viễn | `STOP_ON_REPLY=false` |
| 9 | Kiểu gửi | Mỗi khách đi chuỗi riêng | Khách vào hôm nay nhận tin số 1, hôm sau tin số 5… | `src/domain/journey.ts` |
| 10 | Số tin/ngày | 4 tin: 6h · 11h · 17h · 21h | Giờ địa phương của từng page | `SEND_SLOT_HOURS=6,11,17,21` |
| 11 | Độ dài chuỗi | 7 ngày | Tối đa Facebook cho phép; khách nhắn lại thì chuỗi tính lại từ đầu | `JOURNEY_DAYS=7` |
| 12 | Kịch bản 20+ page | Mỗi page riêng, **sao chép được** | Màn **Kịch bản tự động** có ô **"Chép từ page khác…"**: đổ 12 tin của page khác vào để sửa, bấm Lưu mới ghi | giao diện |
| 13 | Bị Facebook chặn #2022 | Tự giảm tốc, nghỉ, thử lại | Lỗi tăng → hãm tốc; bị chặn → nghỉ 30'; chặn 3 lần/24h → nghỉ 6h | `HEALTH_*` |
| 14 | Lỡ giờ | Gửi bù nếu trễ **dưới 2 tiếng** | Trễ quá 2 tiếng thì bỏ lượt đó | `SEND_LATE_WINDOW_MIN=120` |
| 15 | Người dùng | Vài người, chung mật khẩu → **30/09: bỏ mật khẩu** | Một trang web, **không đăng nhập** (chủ dự án không muốn đặt mật khẩu; đã được báo rủi ro: ai biết link đều xem được khách và bấm gửi tin). Chặn công cụ tìm kiếm lưu trang | nginx |
| 16 | Báo cáo | Cả 4 loại | Gửi được/lỗi + sức khoẻ page + nhật ký chạy nền (màn **Theo dõi**) · tin nào ra đơn, chốt ngày mấy, chốt qua đường nào (màn **Hiệu quả**) · tra cứu từng khách (màn **Tra cứu khách**) — tất cả trong MỘT trang web | giao diện |
| 17 | Cảnh báo | Chỉ xem trên web | Không nhắn Telegram/Zalo; cảnh báo hiện ở màn Tổng quan và Theo dõi | — |
| 18 | Page mới | **Gửi đủ tệp ngay** | Tắt khởi động dần (trước đây 25% trong 3 ngày đầu) | `RAMP_UP_DAYS=0` |
| 19 | Gửi tay | Cần | Màn **Bắn tay**: soạn 1 tin, chọn khách, gửi — vẫn đi qua cầu dao page, hãm tốc và nhật ký từng tin; tự bỏ khách đã chốt/từ chối | — |
| 20 | Ưu tiên số 1 | **Ra nhiều đơn nhất** | Mặc định chọn theo hướng gửi nhiều hơn (đủ tệp ngay, gửi bù 2 tiếng, khách mới vào ngay); báo cáo "tin nào ra đơn" để tối ưu nội dung | — |

## Luồng một ngày của một page

```
khách nhắn page ──(≤15')──▶ SYNC quét nhanh ─▶ vào chuỗi, ngày 1
                                              │
                        PLAN xếp các khung giờ hôm nay còn chưa quá 2 tiếng
                                              │
               SEND gửi đúng giờ (6h · 11h · 17h · 21h giờ địa phương)
                     │ Pancake trước, lỗi thì Facebook (4 loại tag)
                     ▼
  dừng chuỗi khi: đơn mới trên POS · tag mua hàng · để lại SĐT · nhắn từ chối
  hết chuỗi khi:  đi hết 7 ngày · quá 7 ngày khách không nhắn gì
```

Mỗi đêm 3h giờ địa phương, SYNC quét lại **toàn bộ** hội thoại (lùi tới 3 năm) để
bắt những gì quét nhanh có thể sót.

## Luật SĐT — vì sao so với "SĐT lúc vào chuỗi"

Câu 5 chốt "khách chưa chốt đơn **lần này**", nên không thể dừng mọi khách có SĐT:
khách mua 6 tháng trước (đã có SĐT) mà nay nhắn lại là khách ấm, cần chăm tiếp.

| Tình huống | Kết quả |
|---|---|
| Khách mới, để lại SĐT | Dừng |
| Khách mới, chưa có SĐT, hôm sau để lại SĐT | Dừng |
| Khách cũ quay lại, vẫn SĐT cũ | **Vẫn chăm** |
| Khách cũ quay lại, để lại SĐT mới | Dừng |

## Triển khai

Bản clone chạy trên server riêng (host `banbot-antalo`), cài mới từ đầu ngày
30/09/2026 — cách cài, cách deploy và các việc người quản trị tự làm (mở cổng,
điền token) ở **[deploy/SERVER.md](../deploy/SERVER.md)**.

Lưu ý khi sửa `.env` trên server: giá trị ghi trong `.env` thắng giá trị mặc định
trong code. Đừng chép `.env` từ nơi khác sang mà không xem lại các dòng
`RAMP_UP_DAYS`, `SEND_LATE_WINDOW_MIN` — chúng quyết định nghiệp vụ ở câu 14 và 18.

## Còn để ngỏ

- **Thêm page mới vẫn phải dùng lệnh** (`npm run page:add`). Với 20+ page, nếu cần
  thêm page ngay trên giao diện thì làm thêm một màn hình.
- Pancake có lúc chỉ báo "có SĐT" mà giấu số. Khi đó luật SĐT không bắt được;
  vẫn còn đường POS và tag.
- So SĐT theo chuỗi ký tự: khách quay lại gõ cùng số nhưng khác định dạng
  (`0901 234 567` với `0901234567`) sẽ bị tính là SĐT mới và dừng chuỗi.
