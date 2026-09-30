import { NextRequest, NextResponse } from "next/server";
import { requireAppKey } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { messagePerformance, conversionByDay, conversionBySource } from "@/lib/report";

/** Hiệu quả kịch bản của một page: tin nào ra đơn, khách chốt ngày mấy, qua đường nào. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const authError = requireAppKey(req);
    if (authError) return authError;
    try {
        const fbPageId = new URL(req.url).searchParams.get("pageId") ?? "";
        const page = await queryOne<{ id: number }>(`SELECT id FROM pages WHERE page_id = $1`, [fbPageId]);
        if (!page) return NextResponse.json({ error: "Không có page này" }, { status: 404 });

        const [perf, byDay, bySource] = await Promise.all([
            messagePerformance(page.id),
            conversionByDay(page.id),
            conversionBySource(page.id),
        ]);
        return NextResponse.json({ perf, byDay, bySource });
    } catch (err) {
        console.error("[api/report] GET error:", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi" }, { status: 500 });
    }
}
