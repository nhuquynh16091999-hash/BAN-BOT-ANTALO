-- ╔══════════════════════════════════════════════════════════════════════════╗
-- ║  006 — Thị trường có giờ mùa hè (Ý…)                                     ║
-- ║                                                                          ║
-- ║  utc_offset vẫn là thứ mọi job đọc. Page có timezone (tên IANA, vd       ║
-- ║  Europe/Rome) được job sync tính lại utc_offset mỗi lượt, nên tin 6h     ║
-- ║  sáng vẫn là 6h sáng ở Ý cả trước lẫn sau ngày đổi giờ.                  ║
-- ║  NULL = thị trường không đổi giờ, giữ offset cố định như cũ.             ║
-- ╚══════════════════════════════════════════════════════════════════════════╝

ALTER TABLE pages ADD COLUMN timezone TEXT;
