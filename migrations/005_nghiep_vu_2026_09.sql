-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  005 — Nghiệp vụ chốt ngày 29/09/2026 (xem docs/NGHIEP-VU.md)            ║
-- ║                                                                          ║
-- ║  1. Khách để lại SĐT = đã chốt → dừng chuỗi.                             ║
-- ║  2. Khách mới nhắn phải vào chuỗi ngay trong ngày, không chờ tới đêm     ║
-- ║     → job SYNC quét nhanh các hội thoại mới mỗi 15 phút.                 ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ─── SĐT lúc vào chuỗi ─────────────────────────────────────────────────────
-- "Chốt lần này" nghĩa là khách để lại SĐT TRONG chuỗi hiện tại. Khách mua từ
-- chuỗi trước (đã có SĐT cũ) mà nay nhắn lại vẫn được nuôi dưỡng — giống mốc
-- chuẩn POS ở 002. Vì vậy lưu SĐT tại thời điểm khách vào chuỗi, và chỉ coi là
-- chốt khi SĐT hiện tại KHÁC SĐT lúc vào.
--
--   NULL  = khách vào chuỗi lần đầu, chưa có SĐT → có SĐT bất kỳ là chốt
--   '090…' = khách quay lại, đã có SĐT từ chuỗi trước → chỉ SĐT mới mới tính
ALTER TABLE customers ADD COLUMN phone_at_entry TEXT;

-- Dữ liệu cũ: khách đang ở chuỗi thứ 2 trở đi thì SĐT hiện có là của chuỗi
-- trước. Khách ở chuỗi đầu để NULL — ai đã để SĐT sẽ được dừng ở lượt SYNC
-- kế tiếp, đúng với luật mới.
UPDATE customers SET phone_at_entry = phone WHERE journey_count > 1;


-- ─── Quét nhanh ────────────────────────────────────────────────────────────
-- Mốc lần quét nhanh gần nhất — lần sau chỉ lấy hội thoại mới từ mốc này.
ALTER TABLE pages ADD COLUMN last_quick_synced_at TIMESTAMPTZ;
