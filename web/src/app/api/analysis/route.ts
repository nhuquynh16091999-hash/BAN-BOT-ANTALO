import { NextRequest, NextResponse } from "next/server";
import { requireAppKey } from "@/lib/auth";
import { queryOne } from "@/lib/db";
import { pageAnalysis } from "@/lib/report";

/**
 * Số liệu hội thoại thật của page, hiện cạnh ô soạn kịch bản.
 * Chưa phân tích thì trả { analysis: null } — giao diện nhắc lệnh chạy phân tích.
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const authError = requireAppKey(req);
    if (authError) return authError;
    try {
        const fbPageId = new URL(req.url).searchParams.get("pageId") ?? "";
        const page = await queryOne<{ id: number }>(`SELECT id FROM pages WHERE page_id = $1`, [fbPageId]);
        if (!page) return NextResponse.json({ error: "Không có page này" }, { status: 404 });
        return NextResponse.json({ analysis: await pageAnalysis(page.id) });
    } catch (err) {
        console.error("[api/analysis] GET error:", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi" }, { status: 500 });
    }
}
