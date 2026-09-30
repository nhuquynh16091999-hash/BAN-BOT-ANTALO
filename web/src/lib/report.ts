import { query, queryOne } from "./db";

/**
 * Báo cáo cho người vận hành — trước đây nằm ở dashboard riêng (cổng 8446),
 * nay gộp vào giao diện chính để chỉ còn MỘT trang web, MỘT lần đăng nhập.
 *
 * Chỉ đọc. Không file nào ở đây ghi vào database.
 */

// ─── Tin nào ra đơn ───────────────────────────────────────────────────────────

export interface MessagePerformance {
    order_index: number;
    label: string | null;
    body: string;
    sent: number;
    failed: number;
    conversions: number;
}

/**
 * Tin nào ra đơn nhiều nhất.
 *
 * Quy công "chạm cuối": với mỗi khách đã chốt, tìm tin CUỐI CÙNG họ nhận thành
 * công TRƯỚC lúc chốt rồi tính công cho tin đó. Không hoàn hảo (khách có thể
 * quyết từ tin trước), nhưng nhất quán và đủ để so các tin với nhau.
 */
export function messagePerformance(pageDbId: number): Promise<MessagePerformance[]> {
    return query<MessagePerformance>(
        `WITH conv AS (
             SELECT DISTINCT ON (customer_id) customer_id, occurred_at
               FROM customer_events
              WHERE page_id = $1 AND type = 'ordered'
              ORDER BY customer_id, occurred_at
         ),
         attributed AS (
             SELECT DISTINCT ON (v.customer_id) v.customer_id, l.script_message_id
               FROM conv v
               JOIN send_log l ON l.customer_id = v.customer_id AND l.success AND l.sent_at <= v.occurred_at
              ORDER BY v.customer_id, l.sent_at DESC
         )
         SELECT m.order_index, m.label, m.body,
                COALESCE(st.sent, 0)::int   AS sent,
                COALESCE(st.failed, 0)::int AS failed,
                COALESCE(a.n, 0)::int       AS conversions
           FROM script_messages m
           JOIN scripts s ON s.id = m.script_id AND s.is_active AND s.page_id = $1
           LEFT JOIN LATERAL (
                SELECT COUNT(*) FILTER (WHERE success)::int     AS sent,
                       COUNT(*) FILTER (WHERE NOT success)::int AS failed
                  FROM send_log WHERE script_message_id = m.id
           ) st ON TRUE
           LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS n FROM attributed WHERE script_message_id = m.id
           ) a ON TRUE
          ORDER BY m.order_index`,
        [pageDbId]
    );
}

/** Khách chốt đơn ở ngày thứ mấy của hành trình. */
export function conversionByDay(pageDbId: number) {
    return query<{ journey_day: number | null; n: number }>(
        `SELECT journey_day, COUNT(*)::int AS n
           FROM customer_events
          WHERE type = 'ordered' AND page_id = $1
          GROUP BY 1 ORDER BY 1 NULLS LAST`,
        [pageDbId]
    );
}

/** Khách chốt qua đường nào: POS · tag · SĐT · webhook. */
export function conversionBySource(pageDbId: number) {
    return query<{ via: string; n: number }>(
        `SELECT COALESCE(payload->>'via', CASE WHEN payload ? 'orderId' THEN 'webhook' ELSE 'khac' END) AS via,
                COUNT(*)::int AS n
           FROM customer_events
          WHERE type = 'ordered' AND page_id = $1
          GROUP BY 1 ORDER BY 2 DESC`,
        [pageDbId]
    );
}

// ─── Tra cứu khách ────────────────────────────────────────────────────────────

export interface CustomerRow {
    id: number;
    page_name: string;
    psid: string;
    name: string | null;
    phone: string | null;
    status: string;
    journey_day: number;
    journey_count: number;
    order_count: number;
    order_count_baseline: number | null;
    last_interaction_at: Date;
    first_seen_at: Date;
    stop_reason: string | null;
    sent_count: number;
}

const CUSTOMER_COLS = `
    c.id, p.page_name, c.psid, c.name, c.phone, c.status::text AS status,
    c.journey_day, c.journey_count, c.order_count, c.order_count_baseline,
    c.last_interaction_at, c.first_seen_at, c.stop_reason,
    (SELECT COUNT(*)::int FROM send_log l WHERE l.customer_id = c.id AND l.success) AS sent_count
`;

/** Tìm theo tên, SĐT (chuỗi con) hoặc đúng PSID. */
export function searchCustomers(q: string, limit = 60): Promise<CustomerRow[]> {
    const term = q.trim();
    if (!term) return Promise.resolve([]);
    return query<CustomerRow>(
        `SELECT ${CUSTOMER_COLS}
           FROM customers c JOIN pages p ON p.id = c.page_id
          WHERE c.psid = $2 OR c.name ILIKE $1 OR c.phone ILIKE $1
          ORDER BY c.last_interaction_at DESC LIMIT $3`,
        [`%${term.replace(/[\\%_]/g, (m) => `\\${m}`)}%`, term, limit]
    );
}

/** Một khách: đã nhận gì, sắp nhận gì, chuyện gì đã xảy ra. */
export async function customerDetail(id: number) {
    const customer = await queryOne<CustomerRow>(
        `SELECT ${CUSTOMER_COLS} FROM customers c JOIN pages p ON p.id = c.page_id WHERE c.id = $1`,
        [id]
    );
    if (!customer) return null;

    const [sends, events, upcoming] = await Promise.all([
        query<{
            sent_at: Date; journey_day: number | null; slot_index: number | null; channel: string;
            success: boolean; error_kind: string | null; error_message: string | null;
            order_index: number | null; label: string | null; body: string | null;
        }>(
            `SELECT l.sent_at, l.journey_day, l.slot_index, l.channel, l.success,
                    l.error_kind, l.error_message, m.order_index, m.label, m.body
               FROM send_log l LEFT JOIN script_messages m ON m.id = l.script_message_id
              WHERE l.customer_id = $1 ORDER BY l.sent_at DESC LIMIT 60`,
            [id]
        ),
        query<{ type: string; journey_day: number | null; payload: Record<string, unknown>; occurred_at: Date }>(
            `SELECT type::text, journey_day, payload, occurred_at FROM customer_events
              WHERE customer_id = $1 ORDER BY occurred_at DESC LIMIT 30`,
            [id]
        ),
        query<{ scheduled_at: Date; journey_day: number; slot_index: number; order_index: number | null; manual: boolean }>(
            `SELECT q.scheduled_at, q.journey_day, q.slot_index, m.order_index, q.manual
               FROM send_queue q LEFT JOIN script_messages m ON m.id = q.script_message_id
              WHERE q.customer_id = $1 AND q.state = 'queued' ORDER BY q.scheduled_at LIMIT 10`,
            [id]
        ),
    ]);

    return { customer, sends, events, upcoming };
}

// ─── Nhật ký job ──────────────────────────────────────────────────────────────

export function recentJobRuns(limit = 30) {
    return query<{
        job: string; page_name: string | null; started_at: Date; finished_at: Date | null;
        ok: boolean | null; stats: Record<string, unknown>; error: string | null;
    }>(
        `SELECT r.job, p.page_name, r.started_at, r.finished_at, r.ok, r.stats, r.error
           FROM job_runs r LEFT JOIN pages p ON p.id = r.page_id
          ORDER BY r.started_at DESC LIMIT $1`,
        [limit]
    );
}

// ─── Số liệu hội thoại thật (cho màn soạn kịch bản) ───────────────────────────

/**
 * Kết quả `npm run chat:phan-tich` đã lưu cho page. Báo cáo là JSON do engine
 * dựng (src/domain/chat-analysis.ts), kèm sẵn `slots` — gợi ý cho 12 ô soạn.
 */
export function pageAnalysis(pageDbId: number) {
    return queryOne<{ report: Record<string, unknown>; conversations: number; analyzed_at: Date }>(
        `SELECT report, conversations, analyzed_at FROM page_analysis WHERE page_id = $1`,
        [pageDbId]
    );
}
