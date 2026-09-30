import { NextRequest, NextResponse } from "next/server";
import { requireAppKey } from "@/lib/auth";
import { searchCustomers, customerDetail } from "@/lib/report";

/**
 * Tra cứu khách.
 *   ?q=<tên | SĐT | PSID>  → danh sách khớp (tối đa 60)
 *   ?id=<id khách>         → chi tiết: đã nhận gì, sắp nhận gì, sự kiện
 */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const authError = requireAppKey(req);
    if (authError) return authError;
    try {
        const params = new URL(req.url).searchParams;
        const id = Number(params.get("id"));
        if (Number.isInteger(id) && id > 0) {
            const detail = await customerDetail(id);
            if (!detail) return NextResponse.json({ error: "Không có khách này" }, { status: 404 });
            return NextResponse.json(detail);
        }
        const q = (params.get("q") ?? "").trim();
        if (q.length < 2) return NextResponse.json({ customers: [] });
        return NextResponse.json({ customers: await searchCustomers(q) });
    } catch (err) {
        console.error("[api/customers] GET error:", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi" }, { status: 500 });
    }
}
