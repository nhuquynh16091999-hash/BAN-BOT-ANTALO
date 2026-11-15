-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  007 — Trạng thái Pancake của từng page + dọn tàn dư                     ║
-- ║                                                                          ║
-- ║  Tháng 11/2026 Pancake huỷ kích hoạt hàng loạt page (hết gói), một số    ║
-- ║  page rời hẳn tài khoản. Hệ thống không biết nên cứ 15 phút lại thử quét ║
-- ║  rồi ghi lỗi, còn giao diện vẫn hiện page như bình thường. Lưu trạng     ║
-- ║  thái lại để job bỏ qua đúng page và người dùng thấy lý do ngay trên web.║
-- ╚══════════════════════════════════════════════════════════════════════════╝

-- ok · inactivated · no_token · missing · unreachable (xem src/clients/pancake.ts)
-- NULL = chưa kiểm tra lần nào.
ALTER TABLE pages
    ADD COLUMN pancake_state      TEXT,
    ADD COLUMN pancake_checked_at TIMESTAMPTZ;

-- ─── Dọn tàn dư ────────────────────────────────────────────────────────────
-- Tính năng "tự đo cửa sổ gửi" đã gỡ ngày 01/10/2026, nhưng file migration cũ
-- của nó (007_cua_so_gui_tung_page.sql) còn nằm lại trên server vì deploy không
-- xoá file thừa → lần deploy sau lặng lẽ tạo lại các cột. IF EXISTS để máy cài
-- mới (chưa từng có các cột này) chạy cũng không sao.
DROP INDEX IF EXISTS send_log_late_idx;
ALTER TABLE send_log DROP COLUMN IF EXISTS hours_since_interaction;
ALTER TABLE pages
    DROP COLUMN IF EXISTS send_window_hours,
    DROP COLUMN IF EXISTS window_narrowed_at;
DELETE FROM schema_migrations WHERE name = '007_cua_so_gui_tung_page.sql';
