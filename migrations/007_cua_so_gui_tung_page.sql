-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  007 — Đo thật xem page nào gửi được sau 24 giờ                          ║
-- ║                                                                          ║
-- ║  Facebook chỉ chắc chắn cho chủ động nhắn trong 24 giờ sau tin cuối của  ║
-- ║  khách. Từ giờ 24 tới ngày 7 phải nhờ tag Human Agent — page/app này     ║
-- ║  được, page khác có thể không (bản v1 từng gửi 3.734 tin ngày 2–7 cho    ║
-- ║  một page, chỉ 80 tin đi). Thay vì đoán, hệ thống ĐO:                    ║
-- ║   • send_log ghi tin gửi lúc khách đã nhắn được bao nhiêu giờ            ║
-- ║   • job health thấy page gửi sau 24h toàn lỗi → thu hẹp page đó về 24h,  ║
-- ║     7 ngày sau tự thử lại                                                ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE send_log ADD COLUMN hours_since_interaction NUMERIC(6,1);

-- NULL = cửa sổ mặc định (SEND_WINDOW_DAYS). Có giá trị = page đã bị thu hẹp.
ALTER TABLE pages
    ADD COLUMN send_window_hours  SMALLINT CHECK (send_window_hours BETWEEN 1 AND 168),
    ADD COLUMN window_narrowed_at TIMESTAMPTZ;

-- Job health đếm tin gửi muộn (>24h) của từng page trong vài ngày gần nhất
CREATE INDEX send_log_late_idx ON send_log (page_id, sent_at DESC) WHERE hours_since_interaction > 24;
