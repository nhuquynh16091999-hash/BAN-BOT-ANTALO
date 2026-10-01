import { NextRequest, NextResponse } from "next/server";
import { requireAppKey } from "@/lib/auth";
import { query } from "@/lib/db";

/**
 * Gửi được bao nhiêu phần trăm, theo số giờ từ tin cuối của khách — từng page,
 * 7 ngày gần nhất. Facebook chắc chắn cho gửi trong 24h; sau đó phụ thuộc tag
 * Human Agent nên page được page không. Bảng này cho thấy sự thật đó, và cho
 * biết page nào đã bị hệ thống tự thu về chỉ gửi trong 24h.
 */
export const dynamic = "force-dynamic";

interface Row {
    page_id: string;
    page_name: string;
    is_active: boolean;
    send_window_hours: number | null;
    window_narrowed_at: Date | null;
    n1: number; ok1: number;
    n2: number; ok2: number;
    n3: number; ok3: number;
}

export async function GET(req: NextRequest) {
    const authError = requireAppKey(req);
    if (authError) return authError;
    try {
        const rows = await query<Row>(
            `SELECT p.page_id, p.page_name, p.is_active, p.send_window_hours, p.window_narrowed_at,
                    COUNT(l.*) FILTER (WHERE l.hours_since_interaction <= 24)::int                                 AS n1,
                    COUNT(l.*) FILTER (WHERE l.hours_since_interaction <= 24 AND l.success)::int                   AS ok1,
                    COUNT(l.*) FILTER (WHERE l.hours_since_interaction > 24 AND l.hours_since_interaction <= 72)::int AS n2,
                    COUNT(l.*) FILTER (WHERE l.hours_since_interaction > 24 AND l.hours_since_interaction <= 72 AND l.success)::int AS ok2,
                    COUNT(l.*) FILTER (WHERE l.hours_since_interaction > 72)::int                                  AS n3,
                    COUNT(l.*) FILTER (WHERE l.hours_since_interaction > 72 AND l.success)::int                    AS ok3
               FROM pages p
               LEFT JOIN send_log l
                      ON l.page_id = p.id
                     AND l.sent_at > now() - interval '7 days'
                     AND l.hours_since_interaction IS NOT NULL
                     -- lỗi cấp page / mạng / token không nói gì về chuyện gửi muộn
                     AND (l.success OR l.error_kind IN ('OUT_OF_WINDOW', 'UNKNOWN'))
              GROUP BY p.id
             HAVING p.is_active OR COUNT(l.*) > 0
              ORDER BY COUNT(l.*) DESC, p.page_name`
        );
        return NextResponse.json({ pages: rows });
    } catch (err) {
        console.error("[api/window] GET error:", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi" }, { status: 500 });
    }
}
