import { NextRequest, NextResponse } from "next/server";
import { requireAppKey } from "@/lib/auth";
import { recentJobRuns } from "@/lib/report";

/** Các lượt chạy gần nhất của sync · plan · send · pos · health. */
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
    const authError = requireAppKey(req);
    if (authError) return authError;
    try {
        return NextResponse.json({ runs: await recentJobRuns(30) });
    } catch (err) {
        console.error("[api/jobs] GET error:", err);
        return NextResponse.json({ error: err instanceof Error ? err.message : "Lỗi" }, { status: 500 });
    }
}
