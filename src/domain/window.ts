/**
 * Cửa sổ gửi của từng page — quyết định thuần, không đụng database, để test được.
 *
 * Facebook chắc chắn cho chủ động nhắn trong 24 giờ sau tin cuối của khách. Từ
 * giờ 24 tới ngày 7 phải nhờ tag Human Agent, và page này được page kia không.
 * Nên hệ thống đo: tin gửi muộn (>24h) của page trong vài ngày gần nhất đi được
 * bao nhiêu phần trăm.
 */

export interface LateSendStats {
    /** Tin gửi muộn (>24h) có kết quả nói lên được chuyện cửa sổ (đi được, hoặc lỗi ngoài cửa sổ/không rõ) */
    late: number;
    /** …trong đó đi được */
    lateOk: number;
}

export interface WindowState {
    /** NULL = cửa sổ mặc định; có giá trị = đang bị thu hẹp */
    sendWindowHours: number | null;
    narrowedAt: Date | null;
}

export interface WindowRules {
    minSample: number;
    maxSuccessRate: number;
    narrowHours: number;
    retryDays: number;
}

export type WindowDecision =
    | { action: "narrow"; hours: number; reason: string }
    | { action: "retry"; reason: string }
    | null;

export function decideWindow(state: WindowState, stats: LateSendStats, rules: WindowRules, now: Date = new Date()): WindowDecision {
    if (state.sendWindowHours === null) {
        if (stats.late < rules.minSample) return null; // chưa đủ dữ liệu để kết luận
        const rate = stats.lateOk / stats.late;
        if (rate > rules.maxSuccessRate) return null; // gửi muộn vẫn đi được — giữ 7 ngày
        return {
            action: "narrow",
            hours: rules.narrowHours,
            reason: `Gửi sau 24h chỉ đi ${Math.round(rate * 100)}% (${stats.lateOk}/${stats.late} tin) — chỉ gửi trong ${rules.narrowHours} giờ`,
        };
    }
    // Đang thu hẹp: đủ lâu thì mở lại để đo lần nữa (Facebook/Pancake có thể đã cho phép)
    if (state.narrowedAt && now.getTime() - state.narrowedAt.getTime() >= rules.retryDays * 86_400_000) {
        return { action: "retry", reason: `Đã thu hẹp ${rules.retryDays} ngày — mở lại để đo lần nữa` };
    }
    return null;
}
