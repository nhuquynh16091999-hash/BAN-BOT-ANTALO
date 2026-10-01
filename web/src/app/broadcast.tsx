"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";

/**
 * Giao diện vận hành bắn bot.
 *
 * Chia làm BA màn hình theo ba việc khác nhau, thay vì dồn tất cả vào một trang
 * cuộn dài như bản trước:
 *
 *   Tổng quan  — page nào đang chạy, còn bao nhiêu khách, đã có kịch bản chưa
 *   Kịch bản   — soạn 12 tin của chuỗi nuôi dưỡng, bày thành lưới 3 cụm × 4 khung giờ
 *   Bắn tay    — chọn khách trong bảng rồi gửi ngay một tin
 *
 * Trước đây hai việc "soạn kịch bản tự động" và "bắn tay cho khách đã chọn"
 * dùng chung một bộ ô soạn, dễ nhầm: sửa nội dung định để bắn tay lại hoá ra
 * đang sửa kịch bản đang chạy.
 */

// ─── Hằng số khung giờ ────────────────────────────────────────────────────────
const SLOT_HOURS = [6, 11, 17, 21];
const CUM = [
    { key: "A", name: "Giới thiệu", hint: "Chào hỏi, báo giá, công dụng, cách đặt" },
    { key: "B", name: "Bằng chứng", hint: "Feedback khách, cam kết, gỡ băn khoăn" },
    { key: "C", name: "Thúc chốt", hint: "Ưu đãi, khan hàng, xin thông tin" },
];
const SLOT_COUNT = SLOT_HOURS.length * CUM.length;

const DAYPART = [
    { label: "Sáng", color: "var(--dawn)" },
    { label: "Trưa", color: "var(--noon)" },
    { label: "Chiều", color: "var(--dusk)" },
    { label: "Tối", color: "var(--night)" },
];

const GOI_Y = [
    "Chào + trả lời ngay câu khách hay hỏi nhất",
    "Báo giá, phí ship, hình thức thanh toán",
    "Công dụng chính, nối tiếp lời hứa của quảng cáo",
    "Cách dùng / cách đặt hàng",
    "Ảnh hoặc lời của khách đã mua",
    "Gỡ băn khoăn phổ biến nhất",
    "Gỡ băn khoăn thứ hai",
    "Cam kết: kiểm hàng trước khi trả tiền",
    "Ưu đãi có hạn",
    "Khan hàng, giữ chỗ",
    "Hỏi thẳng để lấy tên + SĐT + địa chỉ",
    "Tin cuối, để ngỏ cửa quay lại",
];

// ─── Ý nghĩa từng loại lỗi ────────────────────────────────────────────────────
// Chỉ hiện mã lỗi kiểu PAGE_BLOCKED thì người vận hành không biết phải làm gì.
// Mỗi loại kèm luôn: nghĩa là gì, và có cần làm gì không.
const LOI: Record<string, { ten: string; lam: string; nang: "bad" | "warn" | "muted" }> = {
    PAGE_QUOTA: {
        ten: "Pancake hết gói cước",
        lam: "Nạp thêm gói cho page này. Engine đã tự ngưng page và sẽ thử lại sau 30 phút.",
        nang: "bad",
    },
    PAGE_BLOCKED: {
        ten: "Facebook chặn page (#2022)",
        lam: "Đang gửi quá dày. Engine đã tự ngưng page 30 phút. Lặp lại nhiều lần thì phải giảm số tin mỗi ngày.",
        nang: "bad",
    },
    OUT_OF_WINDOW: {
        ten: "Khách quá 7 ngày chưa nhắn",
        lam: "Không sửa được — Facebook không cho nhắn nữa. Cần chạy quảng cáo để có khách mới vào inbox.",
        nang: "muted",
    },
    USER_UNAVAILABLE: {
        ten: "Khách chặn tin hoặc đã xoá tài khoản",
        lam: "Bỏ qua, không làm gì được.",
        nang: "muted",
    },
    TOKEN_EXPIRED: {
        ten: "Token hết hạn",
        lam: "Engine tự làm mới token rồi thử lại. Nếu lặp lại liên tục, cần lấy token Pancake mới.",
        nang: "warn",
    },
    RATE_LIMITED: {
        ten: "Gửi quá nhanh",
        lam: "Engine tự hãm tốc. Không cần làm gì.",
        nang: "warn",
    },
    INVALID_RECIPIENT: {
        ten: "Mã khách sai định dạng",
        lam: "Dữ liệu đồng bộ có vấn đề. Chạy lại job sync cho page này.",
        nang: "warn",
    },
    NETWORK: {
        ten: "Mất mạng hoặc Pancake không phản hồi",
        lam: "Thường tự khỏi. Engine sẽ thử lại ở lượt sau.",
        nang: "warn",
    },
    UNKNOWN: {
        ten: "Lỗi chưa phân loại",
        lam: "Xem nội dung lỗi bên cạnh để biết chi tiết.",
        nang: "warn",
    },
};

interface MonitorData {
    totals: {
        queued: number; sending: number; sent24: number; failed24: number;
        converted24: number; errorRate: number; lastSend: string; nextDue: string;
    };
    pages: Array<{
        pageId: string; name: string; market: string; isActive: boolean; health: string;
        pausedUntil: string; pauseReason: string | null; queued: number;
        sent24: number; failed24: number; errorRate: number; lastSend: string; nextDue: string;
    }>;
    feed: Array<{
        at: string; page: string; customer: string; psid: string; msgIndex: number | null;
        journeyDay: number | null; slotIndex: number | null; channel: string; fbTag: string | null;
        success: boolean; errorKind: string | null; errorMessage: string | null;
    }>;
    errors: Array<{ kind: string; count: number; pages: number; sample: string | null; lastAt: string }>;
    at: string;
}

// ─── Kiểu dữ liệu ─────────────────────────────────────────────────────────────
interface PageInfo {
    pageId: string;
    name: string;
    shopName: string;
    isActive: boolean;
    health: string;
    rampPercent: number;
    hasScript: boolean;
    activeCustomers: number;
    totalCustomers: number;
    lastSyncedAt: string | null;
}

interface Customer {
    id: string;
    customerName: string;
    customerPhone: string;
    psid: string;
    tags: string[];
    lastInteraction: string;
    status: string;
    journeyDay: number;
    orderCount: number;
}

interface Segment {
    segIdx: number;
    hour: number;
    label: string;
    message: string;
    media: string[];
    successCount: number;
    errorCount: number;
}

interface Schedule {
    pageId: string;
    pageName: string;
    segments: Segment[];
    isActive: boolean;
    recipientCount: number;
    hasScript: boolean;
    health: string;
}

type Screen = "tong-quan" | "theo-doi" | "kich-ban" | "ban-tay" | "hieu-qua" | "tra-cuu";

// ─── Gọi API ──────────────────────────────────────────────────────────────────
const KEY_STORE = "banbot_key";

if (typeof window !== "undefined") {
    try {
        const u = new URL(window.location.href);
        const k = u.searchParams.get("key");
        if (k?.trim()) {
            localStorage.setItem(KEY_STORE, k.trim());
            u.searchParams.delete("key");
            window.history.replaceState({}, "", u.toString());
        }
    } catch {
        /* bỏ qua */
    }
}

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
    const key = typeof window !== "undefined" ? localStorage.getItem(KEY_STORE) ?? "" : "";
    const headers = new Headers(init?.headers);
    if (key) headers.set("x-app-key", key);
    const res = await fetch(url, { ...init, headers });
    // Máy chủ đặt mật khẩu ở tầng nginx nên bình thường không gặp 401 ở đây.
    // Giữ nhánh này cho trường hợp chạy trực tiếp khi phát triển.
    if (res.status === 401 && typeof window !== "undefined") {
        const entered = window.prompt("Nhập mã truy cập:");
        if (entered?.trim()) {
            localStorage.setItem(KEY_STORE, entered.trim());
            headers.set("x-app-key", entered.trim());
            return fetch(url, { ...init, headers });
        }
    }
    return res;
}

// ─── Tiện ích ─────────────────────────────────────────────────────────────────
function ago(iso: string): string {
    if (!iso) return "—";
    const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
    if (!Number.isFinite(s)) return "—";
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} phút trước`;
    if (s < 86400) return `${Math.round(s / 3600)} giờ trước`;
    return `${Math.round(s / 86400)} ngày trước`;
}

function num(n: number): string {
    return n.toLocaleString("vi-VN");
}

/**
 * Link ảnh để XEM TRƯỚC trên giao diện. Ảnh lưu kèm địa chỉ công khai PUBLIC_URL
 * (cổng HTTP riêng cho Facebook/Pancake tải) — trang đang chạy HTTPS thì trình
 * duyệt chặn ảnh HTTP. Xem trước qua đường tương đối của chính trang này thì
 * vừa cùng giao thức vừa dùng luôn phiên đăng nhập.
 */
function previewSrc(url: string): string {
    const i = url.indexOf("/api/media/");
    return i >= 0 ? url.slice(i) : url;
}

// ─── Thành phần dùng chung ────────────────────────────────────────────────────

function Chip({ kind, children }: { kind: "ok" | "warn" | "bad" | "brand" | "muted"; children: React.ReactNode }) {
    return <span className={`chip chip-${kind}`}>{children}</span>;
}

function PageStateChip({ p }: { p: { isActive: boolean; health: string } }) {
    if (!p.isActive) return <Chip kind="muted">Đang tắt</Chip>;
    if (p.health === "paused") return <Chip kind="bad">Tạm ngưng</Chip>;
    if (p.health === "degraded") return <Chip kind="warn">Hãm tốc</Chip>;
    return <Chip kind="ok">Đang chạy</Chip>;
}

function Stat({ value, label, hint, tone }: { value: string; label: string; hint?: string; tone?: string }) {
    return (
        <div className="surface px-4 py-3">
            <div className="num text-[26px] font-bold leading-tight" style={tone ? { color: tone } : undefined}>
                {value}
            </div>
            <div className="mt-0.5 text-[13px]" style={{ color: "var(--ink-2)" }}>
                {label}
            </div>
            {hint && (
                <div className="mt-0.5 text-[12px]" style={{ color: "var(--ink-3)" }}>
                    {hint}
                </div>
            )}
        </div>
    );
}

function Empty({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
    return (
        <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
            <div className="text-[15px] font-semibold">{title}</div>
            {hint && (
                <div className="mt-1.5 max-w-md text-[13.5px]" style={{ color: "var(--ink-3)" }}>
                    {hint}
                </div>
            )}
            {action && <div className="mt-4">{action}</div>}
        </div>
    );
}

// ═══ MÀN HÌNH 1 · TỔNG QUAN ═══════════════════════════════════════════════════

function OverviewScreen({
    pages,
    loading,
    onPick,
}: {
    pages: PageInfo[];
    loading: boolean;
    onPick: (pageId: string, screen: Screen) => void;
}) {
    const totals = useMemo(
        () => ({
            active: pages.filter((p) => p.isActive).length,
            customers: pages.reduce((a, p) => a + p.activeCustomers, 0),
            noScript: pages.filter((p) => !p.hasScript).length,
            paused: pages.filter((p) => p.isActive && p.health === "paused").length,
        }),
        [pages]
    );

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat value={num(totals.active)} label="Page đang chạy" hint={`trên tổng ${pages.length} page`} />
                <Stat
                    value={num(totals.customers)}
                    label="Khách gửi được"
                    hint="còn trong cửa sổ 7 ngày"
                    tone="var(--brand)"
                />
                <Stat
                    value={num(totals.noScript)}
                    label="Page chưa có kịch bản"
                    hint={totals.noScript ? "chưa gửi được gì" : "đủ cả"}
                    tone={totals.noScript ? "var(--warn)" : undefined}
                />
                <Stat
                    value={num(totals.paused)}
                    label="Page bị tạm ngưng"
                    hint={totals.paused ? "Facebook đang siết" : "không có"}
                    tone={totals.paused ? "var(--bad)" : undefined}
                />
            </div>

            <div className="panel overflow-hidden">
                <div className="flex items-center justify-between border-b px-5 py-3.5" style={{ borderColor: "var(--line)" }}>
                    <h2 className="text-[15px] font-bold">Các page</h2>
                    <span className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                        Bấm vào một page để soạn kịch bản hoặc bắn tay
                    </span>
                </div>

                {loading ? (
                    <Empty title="Đang tải danh sách page…" />
                ) : pages.length === 0 ? (
                    <Empty
                        title="Chưa có page nào"
                        hint="Thêm page bằng dòng lệnh trên máy chủ: npm run page:add -- --page <id>"
                    />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="tbl min-w-[860px]">
                            <thead>
                                <tr>
                                    <th>Page</th>
                                    <th>Trạng thái</th>
                                    <th className="text-right">Gửi được</th>
                                    <th className="text-right">Tổng tệp</th>
                                    <th>Kịch bản</th>
                                    <th>Đồng bộ</th>
                                    <th />
                                </tr>
                            </thead>
                            <tbody>
                                {pages.map((p) => (
                                    <tr key={p.pageId}>
                                        <td>
                                            <div className="font-semibold">{p.name}</div>
                                            <div className="mono" style={{ color: "var(--ink-3)" }}>
                                                {p.pageId}
                                            </div>
                                        </td>
                                        <td>
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <PageStateChip p={p} />
                                                {p.isActive && p.rampPercent < 100 && (
                                                    <Chip kind="warn">khởi động {p.rampPercent}%</Chip>
                                                )}
                                            </div>
                                        </td>
                                        <td className="num text-right font-bold">{num(p.activeCustomers)}</td>
                                        <td className="num text-right" style={{ color: "var(--ink-3)" }}>
                                            {num(p.totalCustomers)}
                                        </td>
                                        <td>
                                            {p.hasScript ? (
                                                <Chip kind="ok">đã có</Chip>
                                            ) : (
                                                <Chip kind="warn">chưa có</Chip>
                                            )}
                                        </td>
                                        <td style={{ color: "var(--ink-3)" }}>{ago(p.lastSyncedAt ?? "")}</td>
                                        <td className="text-right">
                                            <div className="flex justify-end gap-1.5">
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => onPick(p.pageId, "kich-ban")}
                                                >
                                                    Kịch bản
                                                </button>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => onPick(p.pageId, "ban-tay")}
                                                >
                                                    Bắn tay
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══ MÀN HÌNH · THEO DÕI ══════════════════════════════════════════════════════

function clock(iso: string): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function pct(n: number): string {
    return `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`;
}

function MonitorScreen({
    data,
    loading,
    paused,
    onTogglePause,
    onRefresh,
    onOpenPage,
}: {
    data: MonitorData | null;
    loading: boolean;
    paused: boolean;
    onTogglePause: () => void;
    onRefresh: () => void;
    onOpenPage: (pageId: string) => void;
}) {
    if (!data) {
        return (
            <div className="panel">
                <Empty title={loading ? "Đang tải số liệu…" : "Chưa có số liệu"} />
            </div>
        );
    }

    const t = data.totals;
    const daGui = t.sent24 + t.failed24 > 0;

    return (
        <div className="space-y-5">
            {/* Số liệu 24 giờ */}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat
                    value={num(t.queued)}
                    label="Đang chờ gửi"
                    hint={t.nextDue ? `lượt gần nhất ${clock(t.nextDue)}` : "hàng đợi trống"}
                    tone={t.queued > 0 ? "var(--brand)" : undefined}
                />
                <Stat value={num(t.sent24)} label="Đã gửi 24h" hint="tin đi thành công" tone="var(--ok)" />
                <Stat
                    value={num(t.failed24)}
                    label="Lỗi 24h"
                    hint={daGui ? `tỉ lệ ${pct(t.errorRate)}` : "chưa gửi gì"}
                    tone={t.failed24 > 0 ? "var(--bad)" : undefined}
                />
                <Stat value={num(t.converted24)} label="Chốt đơn 24h" hint="đã dừng chuỗi" tone="var(--ok)" />
                <Stat
                    value={t.lastSend ? clock(t.lastSend) : "—"}
                    label="Lần gửi cuối"
                    hint={t.lastSend ? ago(t.lastSend) : "chưa gửi lần nào"}
                />
            </div>

            {/* Lỗi — phần quan trọng nhất */}
            <div className="panel overflow-hidden">
                <div
                    className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5"
                    style={{ borderColor: "var(--line)" }}
                >
                    <div>
                        <h2 className="text-[15px] font-bold">Lỗi trong 24 giờ qua</h2>
                        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                            Mỗi dòng kèm luôn ý nghĩa và việc cần làm
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button className="btn btn-ghost btn-sm" onClick={onTogglePause}>
                            {paused ? "Tiếp tục tự cập nhật" : "Tạm dừng tự cập nhật"}
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={onRefresh}>
                            Cập nhật ngay
                        </button>
                    </div>
                </div>

                {data.errors.length === 0 ? (
                    <Empty title="Không có lỗi nào" hint="Trong 24 giờ qua mọi tin đều gửi được." />
                ) : (
                    <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
                        {data.errors.map((e) => {
                            const info = LOI[e.kind] ?? LOI.UNKNOWN!;
                            return (
                                <div key={e.kind} className="flex flex-wrap gap-x-4 gap-y-1.5 px-5 py-3.5">
                                    <div className="w-16 shrink-0">
                                        <div
                                            className="num text-[19px] font-bold leading-none"
                                            style={{ color: `var(--${info.nang === "muted" ? "ink-2" : info.nang})` }}
                                        >
                                            {num(e.count)}
                                        </div>
                                        <div className="mt-0.5 text-[11px]" style={{ color: "var(--ink-3)" }}>
                                            {e.pages > 1 ? `${e.pages} page` : "1 page"}
                                        </div>
                                    </div>
                                    <div className="min-w-[240px] flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-[14px] font-bold">{info.ten}</span>
                                            <Chip kind={info.nang}>{e.kind}</Chip>
                                            <span className="text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                                                gần nhất {ago(e.lastAt)}
                                            </span>
                                        </div>
                                        <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>
                                            {info.lam}
                                        </p>
                                        {e.sample && (
                                            <p className="mono mt-1 break-all" style={{ color: "var(--ink-3)" }}>
                                                {e.sample.slice(0, 160)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Theo từng page */}
            <div className="panel overflow-hidden">
                <div className="border-b px-5 py-3.5" style={{ borderColor: "var(--line)" }}>
                    <h2 className="text-[15px] font-bold">Từng page gửi ra sao</h2>
                </div>
                <div className="overflow-x-auto">
                    <table className="tbl min-w-[820px]">
                        <thead>
                            <tr>
                                <th>Page</th>
                                <th>Trạng thái</th>
                                <th className="text-right">Đã gửi 24h</th>
                                <th className="text-right">Lỗi 24h</th>
                                <th className="text-right">Tỉ lệ lỗi</th>
                                <th className="text-right">Đang chờ</th>
                                <th>Gửi lần cuối</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.pages.map((p) => (
                                <tr key={p.pageId} className="cursor-pointer" onClick={() => onOpenPage(p.pageId)}>
                                    <td>
                                        <div className="font-semibold">{p.name}</div>
                                        <div className="mono" style={{ color: "var(--ink-3)" }}>
                                            {p.pageId}
                                        </div>
                                    </td>
                                    <td>
                                        <PageStateChip p={p} />
                                        {p.health === "paused" && p.pauseReason && (
                                            <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--bad)" }}>
                                                {p.pauseReason}
                                            </div>
                                        )}
                                    </td>
                                    <td className="num text-right font-semibold">{num(p.sent24)}</td>
                                    <td
                                        className="num text-right"
                                        style={{ color: p.failed24 > 0 ? "var(--bad)" : "var(--ink-3)" }}
                                    >
                                        {p.failed24 > 0 ? num(p.failed24) : "—"}
                                    </td>
                                    <td
                                        className="num text-right"
                                        style={{
                                            color:
                                                p.errorRate > 0.3
                                                    ? "var(--bad)"
                                                    : p.errorRate > 0
                                                      ? "var(--warn)"
                                                      : "var(--ink-3)",
                                        }}
                                    >
                                        {p.sent24 + p.failed24 > 0 ? pct(p.errorRate) : "—"}
                                    </td>
                                    <td className="num text-right">{p.queued > 0 ? num(p.queued) : "—"}</td>
                                    <td style={{ color: "var(--ink-3)" }}>{p.lastSend ? ago(p.lastSend) : "chưa gửi"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Dòng chảy từng tin */}
            <div className="panel overflow-hidden">
                <div
                    className="flex items-center justify-between border-b px-5 py-3.5"
                    style={{ borderColor: "var(--line)" }}
                >
                    <h2 className="text-[15px] font-bold">Từng tin vừa gửi</h2>
                    <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                        {paused ? "đã tạm dừng cập nhật" : "tự cập nhật mỗi 10 giây"} · lúc {clock(data.at)}
                    </span>
                </div>

                {data.feed.length === 0 ? (
                    <Empty
                        title="Chưa gửi tin nào"
                        hint="Khi engine bắt đầu gửi, từng tin sẽ hiện ở đây kèm kết quả."
                    />
                ) : (
                    <div className="max-h-[58vh] overflow-auto">
                        <table className="tbl min-w-[900px]">
                            <thead className="sticky top-0 z-10">
                                <tr>
                                    <th className="w-20">Lúc</th>
                                    <th>Page</th>
                                    <th>Khách</th>
                                    <th className="text-right">Tin</th>
                                    <th>Kênh</th>
                                    <th>Kết quả</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.feed.map((f, i) => (
                                    <tr key={`${f.at}-${f.psid}-${i}`}>
                                        <td className="mono" style={{ color: "var(--ink-3)" }}>
                                            {clock(f.at)}
                                        </td>
                                        <td style={{ color: "var(--ink-2)" }}>{f.page}</td>
                                        <td>
                                            <div className="font-medium">{f.customer}</div>
                                            <div className="mono" style={{ color: "var(--ink-3)" }}>
                                                {f.psid}
                                            </div>
                                        </td>
                                        <td className="num text-right">
                                            {f.msgIndex ? (
                                                <>
                                                    <span className="font-semibold">#{f.msgIndex}</span>
                                                    {f.journeyDay && (
                                                        <span
                                                            className="ml-1 text-[11.5px]"
                                                            style={{ color: "var(--ink-3)" }}
                                                        >
                                                            ngày {f.journeyDay}
                                                        </span>
                                                    )}
                                                </>
                                            ) : (
                                                <Chip kind="muted">bắn tay</Chip>
                                            )}
                                        </td>
                                        <td>
                                            <Chip kind={f.channel === "pancake" ? "brand" : "muted"}>
                                                {f.channel === "pancake" ? "Pancake" : "Facebook"}
                                            </Chip>
                                        </td>
                                        <td>
                                            {f.success ? (
                                                <Chip kind="ok">gửi được</Chip>
                                            ) : (
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <Chip kind={LOI[f.errorKind ?? "UNKNOWN"]?.nang ?? "warn"}>
                                                        {LOI[f.errorKind ?? "UNKNOWN"]?.ten ?? f.errorKind}
                                                    </Chip>
                                                    {f.errorMessage && (
                                                        <span
                                                            className="mono"
                                                            style={{ color: "var(--ink-3)" }}
                                                            title={f.errorMessage}
                                                        >
                                                            {f.errorMessage.slice(0, 44)}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
}

// ═══ MÀN HÌNH 2 · KỊCH BẢN ════════════════════════════════════════════════════

function SlotCard({
    idx,
    label,
    body,
    media,
    uploading,
    onLabel,
    onBody,
    onPaste,
    onDrop,
    onPickFile,
    onRemoveMedia,
}: {
    idx: number;
    label: string;
    body: string;
    media: string[];
    uploading: boolean;
    onLabel: (v: string) => void;
    onBody: (v: string) => void;
    onPaste: (e: React.ClipboardEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onPickFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onRemoveMedia: (i: number) => void;
}) {
    const slot = idx % SLOT_HOURS.length;
    const dp = DAYPART[slot]!;
    const empty = !body.trim() && media.length === 0;

    return (
        <div
            className="surface flex flex-col p-3.5"
            style={empty ? { borderColor: "var(--warn)" } : undefined}
            onDrop={onDrop}
            onDragOver={(e) => e.preventDefault()}
        >
            <div className="mb-2 flex items-center gap-2">
                <span
                    className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[12px] font-bold text-white"
                    style={{ background: dp.color }}
                >
                    {idx + 1}
                </span>
                <span className="text-[12px] font-semibold" style={{ color: dp.color }}>
                    {SLOT_HOURS[slot]}h · {dp.label}
                </span>
                {empty && (
                    <span className="ml-auto">
                        <Chip kind="warn">trống</Chip>
                    </span>
                )}
            </div>

            <input
                className="field mb-2 !px-2.5 !py-1.5 !text-[12.5px]"
                value={label}
                onChange={(e) => onLabel(e.target.value)}
                placeholder="nhãn ghi nhớ"
            />

            <textarea
                className="field flex-1 resize-y !text-[13.5px] leading-relaxed"
                rows={5}
                value={body}
                onChange={(e) => onBody(e.target.value)}
                onPaste={onPaste}
                placeholder={uploading ? "Đang tải ảnh lên…" : GOI_Y[idx]}
            />

            <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {media.map((url, i) => (
                    <span key={url + i} className="relative">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={previewSrc(url)}
                            alt=""
                            className="h-11 w-11 rounded-md border object-cover"
                            style={{ borderColor: "var(--line)" }}
                        />
                        <button
                            onClick={() => onRemoveMedia(i)}
                            title="Bỏ ảnh này"
                            className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                            style={{ background: "var(--bad)" }}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <label
                    className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md border border-dashed text-[17px]"
                    style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}
                    title="Thêm ảnh — hoặc dán thẳng vào ô nội dung"
                >
                    +
                    <input type="file" accept="image/*" multiple className="hidden" onChange={onPickFile} />
                </label>
            </div>
        </div>
    );
}

function ScriptScreen({
    page,
    schedule,
    msgs,
    medias,
    labels,
    uploadingSlot,
    saving,
    onLabel,
    onBody,
    onPaste,
    onDrop,
    onPickFile,
    onRemoveMedia,
    onSave,
    onToggleActive,
    copySources,
    onCopyFrom,
}: {
    page: PageInfo;
    schedule: Schedule | null;
    msgs: string[];
    medias: string[][];
    labels: string[];
    uploadingSlot: number | null;
    saving: boolean;
    onLabel: (i: number, v: string) => void;
    onBody: (i: number, v: string) => void;
    onPaste: (i: number) => (e: React.ClipboardEvent) => void;
    onDrop: (i: number) => (e: React.DragEvent) => void;
    onPickFile: (i: number) => (e: React.ChangeEvent<HTMLInputElement>) => void;
    onRemoveMedia: (i: number, m: number) => void;
    onSave: () => void;
    onToggleActive: () => void;
    copySources: Array<{ pageId: string; pageName: string; filled: number }>;
    onCopyFrom: (pageId: string) => void;
}) {
    const filled = msgs.filter((m, i) => m.trim() || medias[i]!.length).length;
    const sent = schedule?.segments.reduce((a, s) => a + s.successCount, 0) ?? 0;

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat
                    value={`${filled}/${SLOT_COUNT}`}
                    label="Ô đã nhập"
                    hint={filled === SLOT_COUNT ? "đủ cả" : `còn ${SLOT_COUNT - filled} ô trống`}
                    tone={filled === SLOT_COUNT ? "var(--ok)" : "var(--warn)"}
                />
                <Stat value={num(page.activeCustomers)} label="Khách sẽ nhận" hint="còn trong cửa sổ 7 ngày" />
                <Stat value={num(sent)} label="Tin đã gửi" hint="từ kịch bản này" />
                <Stat
                    value={page.isActive ? "Đang chạy" : "Đang tắt"}
                    label="Trạng thái page"
                    hint={page.isActive ? "engine đang gửi theo lịch" : "chưa gửi gì"}
                    tone={page.isActive ? "var(--ok)" : "var(--ink-3)"}
                />
            </div>

            <div className="panel">
                <div
                    className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5"
                    style={{ borderColor: "var(--line)" }}
                >
                    <div>
                        <h2 className="text-[15px] font-bold">Chuỗi nuôi dưỡng — {SLOT_COUNT} tin</h2>
                        <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                            Mỗi khách đi hết 7 ngày, mỗi ngày nhận 4 tin. Tin lặp lại sau đúng 3 ngày.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {copySources.length > 0 && (
                            <select
                                className="field !w-auto !py-1.5 !text-[13px]"
                                value=""
                                onChange={(e) => {
                                    if (e.target.value) onCopyFrom(e.target.value);
                                }}
                                title="Đổ kịch bản của page khác vào đây để sửa — chưa lưu cho tới khi bấm Lưu"
                            >
                                <option value="">Chép từ page khác…</option>
                                {copySources.map((s) => (
                                    <option key={s.pageId} value={s.pageId}>
                                        {s.pageName} ({s.filled} tin)
                                    </option>
                                ))}
                            </select>
                        )}
                        <button className="btn btn-primary" onClick={onSave} disabled={saving || filled === 0}>
                            {saving ? "Đang lưu…" : "Lưu kịch bản"}
                        </button>
                    </div>
                </div>

                <div className="space-y-5 p-4">
                    {CUM.map((cum, ci) => (
                        <section key={cum.key}>
                            <div className="mb-2 flex items-baseline gap-2.5">
                                <h3 className="text-[13.5px] font-bold">
                                    Cụm {cum.key} · {cum.name}
                                </h3>
                                <span className="text-[12px]" style={{ color: "var(--ink-3)" }}>
                                    {cum.hint}
                                </span>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                                {SLOT_HOURS.map((_, si) => {
                                    const idx = ci * SLOT_HOURS.length + si;
                                    return (
                                        <SlotCard
                                            key={idx}
                                            idx={idx}
                                            label={labels[idx] ?? ""}
                                            body={msgs[idx] ?? ""}
                                            media={medias[idx] ?? []}
                                            uploading={uploadingSlot === idx}
                                            onLabel={(v) => onLabel(idx, v)}
                                            onBody={(v) => onBody(idx, v)}
                                            onPaste={onPaste(idx)}
                                            onDrop={onDrop(idx)}
                                            onPickFile={onPickFile(idx)}
                                            onRemoveMedia={(m) => onRemoveMedia(idx, m)}
                                        />
                                    );
                                })}
                            </div>
                        </section>
                    ))}
                </div>
            </div>

            <div className="panel flex flex-wrap items-center gap-4 px-5 py-4">
                <div className="flex-1 min-w-[280px]">
                    <div className="text-[14px] font-bold">
                        {page.isActive ? "Chiến dịch đang chạy" : "Bật chiến dịch"}
                    </div>
                    <p className="mt-0.5 text-[13px]" style={{ color: "var(--ink-2)" }}>
                        {page.isActive
                            ? `Engine đang gửi tự động cho ${num(page.activeCustomers)} khách theo 4 khung giờ mỗi ngày.`
                            : filled === 0
                              ? "Cần nhập nội dung và lưu kịch bản trước khi bật."
                              : `Bật lên là engine bắt đầu gửi thật cho ${num(page.activeCustomers)} khách, đủ tệp ngay từ khung giờ gần nhất.`}
                    </p>
                </div>
                <button
                    className={page.isActive ? "btn btn-danger" : "btn btn-primary"}
                    onClick={onToggleActive}
                    disabled={!page.isActive && !schedule?.hasScript}
                >
                    {page.isActive ? "Tắt chiến dịch" : "Bật chiến dịch"}
                </button>
            </div>
        </div>
    );
}

// ═══ MÀN HÌNH 3 · BẮN TAY ═════════════════════════════════════════════════════

function ManualScreen({
    page,
    customers,
    loading,
    selected,
    onToggle,
    onToggleAll,
    body,
    media,
    uploading,
    sending,
    progress,
    onBody,
    onPaste,
    onDrop,
    onPickFile,
    onRemoveMedia,
    onSend,
    onReload,
}: {
    page: PageInfo;
    customers: Customer[];
    loading: boolean;
    selected: Set<string>;
    onToggle: (id: string) => void;
    onToggleAll: () => void;
    body: string;
    media: string[];
    uploading: boolean;
    sending: boolean;
    progress: { done: number; total: number } | null;
    onBody: (v: string) => void;
    onPaste: (e: React.ClipboardEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onPickFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
    onRemoveMedia: (i: number) => void;
    onSend: () => void;
    onReload: () => void;
}) {
    const [q, setQ] = useState("");
    const [shown, setShown] = useState(100);

    const filtered = useMemo(() => {
        const t = q.trim().toLowerCase();
        if (!t) return customers;
        return customers.filter(
            (c) =>
                c.customerName.toLowerCase().includes(t) ||
                c.customerPhone.includes(t) ||
                c.psid.includes(t)
        );
    }, [customers, q]);

    const allShown = filtered.slice(0, shown);
    const canSend = selected.size > 0 && (body.trim() || media.length > 0) && !sending;

    return (
        <div className="grid gap-5 xl:grid-cols-[1fr_400px]">
            {/* Danh sách khách */}
            <div className="panel overflow-hidden">
                <div
                    className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3"
                    style={{ borderColor: "var(--line)" }}
                >
                    <input
                        className="field max-w-[260px] flex-1 !py-1.5 !text-[13px]"
                        placeholder="Tìm theo tên, số điện thoại, PSID…"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                    />
                    <button className="btn btn-ghost btn-sm" onClick={onReload}>
                        Tải lại
                    </button>
                    <div className="ml-auto flex items-center gap-2 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                        <span className="num">
                            <b style={{ color: "var(--brand)" }}>{num(selected.size)}</b> đã chọn
                        </span>
                        <span>/</span>
                        <span className="num">{num(filtered.length)} khách</span>
                    </div>
                </div>

                {loading ? (
                    <Empty title="Đang tải danh sách khách…" />
                ) : customers.length === 0 ? (
                    <Empty
                        title="Chưa có khách nào gửi được"
                        hint="Tệp khách được job đồng bộ đổ vào mỗi đêm. Chỉ khách tương tác trong 7 ngày gần nhất mới gửi được."
                    />
                ) : (
                    <>
                        <div className="max-h-[62vh] overflow-auto">
                            <table className="tbl">
                                <thead className="sticky top-0 z-10">
                                    <tr>
                                        <th className="w-10">
                                            <input
                                                type="checkbox"
                                                checked={selected.size > 0 && selected.size === filtered.length}
                                                onChange={onToggleAll}
                                                title="Chọn / bỏ chọn tất cả"
                                            />
                                        </th>
                                        <th>Khách hàng</th>
                                        <th>Số điện thoại</th>
                                        <th className="text-right">Ngày</th>
                                        <th>Tương tác cuối</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {allShown.map((c) => (
                                        <tr
                                            key={c.id}
                                            className="cursor-pointer"
                                            onClick={() => onToggle(c.id)}
                                            style={selected.has(c.id) ? { background: "var(--brand-soft)" } : undefined}
                                        >
                                            <td>
                                                <input
                                                    type="checkbox"
                                                    checked={selected.has(c.id)}
                                                    onChange={() => onToggle(c.id)}
                                                    onClick={(e) => e.stopPropagation()}
                                                />
                                            </td>
                                            <td>
                                                <div className="font-medium">{c.customerName}</div>
                                                <div className="mono" style={{ color: "var(--ink-3)" }}>
                                                    {c.psid}
                                                </div>
                                            </td>
                                            <td className="num" style={{ color: c.customerPhone ? "var(--ink-2)" : "var(--ink-3)" }}>
                                                {c.customerPhone || "—"}
                                            </td>
                                            <td className="num text-right">{c.journeyDay}</td>
                                            <td style={{ color: "var(--ink-3)" }}>{ago(c.lastInteraction)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {filtered.length > shown && (
                            <div className="border-t px-4 py-2.5 text-center" style={{ borderColor: "var(--line-soft)" }}>
                                <button className="btn btn-ghost btn-sm" onClick={() => setShown((s) => s + 200)}>
                                    Hiện thêm ({num(filtered.length - shown)} khách nữa)
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Soạn tin */}
            <div className="panel flex h-fit flex-col p-4 xl:sticky xl:top-[124px]">
                <h2 className="text-[15px] font-bold">Gửi ngay một tin</h2>
                <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                    Tin này gửi một lần cho khách đang chọn, không ảnh hưởng chuỗi nuôi dưỡng.
                </p>

                <textarea
                    className="field mt-3 resize-y !text-[13.5px] leading-relaxed"
                    rows={7}
                    value={body}
                    onChange={(e) => onBody(e.target.value)}
                    onPaste={onPaste}
                    onDrop={onDrop}
                    onDragOver={(e) => e.preventDefault()}
                    placeholder={uploading ? "Đang tải ảnh lên…" : "Nhập nội dung… (dán ảnh thẳng vào đây cũng được)"}
                />

                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {media.map((url, i) => (
                        <span key={url + i} className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={previewSrc(url)}
                                alt=""
                                className="h-12 w-12 rounded-md border object-cover"
                                style={{ borderColor: "var(--line)" }}
                            />
                            <button
                                onClick={() => onRemoveMedia(i)}
                                className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-bold text-white"
                                style={{ background: "var(--bad)" }}
                            >
                                ×
                            </button>
                        </span>
                    ))}
                    <label
                        className="flex h-12 w-12 cursor-pointer items-center justify-center rounded-md border border-dashed text-[18px]"
                        style={{ borderColor: "var(--line)", color: "var(--ink-3)" }}
                    >
                        +
                        <input type="file" accept="image/*" multiple className="hidden" onChange={onPickFile} />
                    </label>
                </div>

                {!page.isActive && (
                    <div
                        className="mt-3 rounded-lg px-3 py-2.5 text-[12.5px]"
                        style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
                    >
                        Page đang tắt — tin sẽ nằm trong hàng đợi và chỉ gửi khi anh/chị bật page.
                    </div>
                )}

                {progress && (
                    <div className="mt-3">
                        <div className="mb-1 flex justify-between text-[12px]" style={{ color: "var(--ink-2)" }}>
                            <span>Đang gửi…</span>
                            <span className="num">
                                {progress.done}/{progress.total}
                            </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full" style={{ background: "var(--line)" }}>
                            <div
                                className="h-full rounded-full transition-all"
                                style={{
                                    background: "var(--brand)",
                                    width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`,
                                }}
                            />
                        </div>
                    </div>
                )}

                <button className="btn btn-primary mt-3.5 w-full !py-2.5" onClick={onSend} disabled={!canSend}>
                    {sending
                        ? "Đang xếp hàng đợi…"
                        : selected.size === 0
                          ? "Chọn khách để gửi"
                          : `Gửi cho ${num(selected.size)} khách`}
                </button>
            </div>
        </div>
    );
}

// ═══ Gộp từ dashboard cũ (cổng 8446) ══════════════════════════════════════════
// Trước đây báo cáo, tra cứu khách và nhật ký job nằm ở một trang web riêng với
// link + đăng nhập riêng. Nay gộp về đây: một link, một lần đăng nhập.

function dt(iso: string | null | undefined): string {
    if (!iso) return "—";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function short(s: string | null | undefined, n: number): string {
    const t = (s ?? "").replace(/\s+/g, " ").trim();
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

function Bar({ value, max, tone = "var(--ok)" }: { value: number; max: number; tone?: string }) {
    const w = max > 0 ? Math.round((value / max) * 100) : 0;
    return (
        <div className="h-2 w-full min-w-[60px] rounded-full" style={{ background: "var(--line-soft)" }}>
            <div className="h-2 rounded-full" style={{ width: `${w}%`, background: tone }} />
        </div>
    );
}

function PanelHead({ title, hint, right }: { title: string; hint?: string; right?: React.ReactNode }) {
    return (
        <div
            className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-3.5"
            style={{ borderColor: "var(--line)" }}
        >
            <div>
                <h2 className="text-[15px] font-bold">{title}</h2>
                {hint && (
                    <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                        {hint}
                    </p>
                )}
            </div>
            {right}
        </div>
    );
}

/** Gọi API GET rồi trả dữ liệu; lỗi thì ném ra câu tiếng Việt từ máy chủ. */
async function getJson<T>(url: string): Promise<T> {
    const r = await apiFetch(url);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? `Lỗi ${r.status}`);
    return d as T;
}

// ─── Màn Hiệu quả: tin nào ra đơn ─────────────────────────────────────────────

const NGUON_CHOT: Record<string, string> = {
    pos: "Đơn mới trên POS",
    tag: "Tag mua hàng",
    phone: "Để lại SĐT",
    webhook: "Hệ thống khác báo về",
    khac: "Không rõ",
};

interface ReportData {
    perf: Array<{ order_index: number; label: string | null; body: string; sent: number; failed: number; conversions: number }>;
    byDay: Array<{ journey_day: number | null; n: number }>;
    bySource: Array<{ via: string; n: number }>;
}

function ReportScreen({ page }: { page: PageInfo }) {
    const [data, setData] = useState<ReportData | null>(null);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let alive = true;
        setData(null);
        setErr(null);
        getJson<ReportData>(`/api/report?pageId=${encodeURIComponent(page.pageId)}`)
            .then((d) => alive && setData(d))
            .catch((e) => alive && setErr(e instanceof Error ? e.message : "Lỗi"));
        return () => {
            alive = false;
        };
    }, [page.pageId]);

    if (err) return <div className="panel"><Empty title="Không tải được báo cáo" hint={err} /></div>;
    if (!data) return <div className="panel"><Empty title="Đang tải báo cáo…" /></div>;

    const orders = data.byDay.reduce((a, d) => a + d.n, 0);
    const sent = data.perf.reduce((a, m) => a + m.sent, 0);
    const maxConv = Math.max(1, ...data.perf.map((m) => m.conversions));
    const maxDay = Math.max(1, ...data.byDay.map((d) => d.n));
    const best = [...data.perf].sort((a, b) => b.conversions - a.conversions)[0];

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Stat value={num(orders)} label="Khách đã chốt" hint="dừng chuỗi vì chốt đơn" tone="var(--ok)" />
                <Stat value={num(sent)} label="Tin đã gửi" hint="theo kịch bản đang chạy" />
                <Stat value={sent > 0 ? pct(orders / sent) : "—"} label="Đơn / tin gửi" hint="càng cao càng tốt" />
                <Stat
                    value={best && best.conversions > 0 ? `Tin ${best.order_index + 1}` : "—"}
                    label="Tin ra đơn nhiều nhất"
                    hint={best && best.conversions > 0 ? best.label || short(best.body, 32) : "chưa có đơn"}
                    tone="var(--ok)"
                />
            </div>

            <div className="panel overflow-hidden">
                <PanelHead
                    title="Tin nào ra đơn nhiều nhất"
                    hint={
                        orders === 0
                            ? "Chưa có khách nào chốt — bảng có số khi POS, tag, SĐT hoặc webhook ghi nhận đơn đầu tiên."
                            : `Mỗi khách đã chốt được tính cho tin CUỐI CÙNG họ nhận trước lúc chốt. Tổng ${num(orders)} đơn.`
                    }
                />
                {data.perf.length === 0 ? (
                    <Empty title="Page này chưa có kịch bản" hint="Soạn ở màn Kịch bản tự động." />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="tbl min-w-[820px]">
                            <thead>
                                <tr>
                                    <th>#</th>
                                    <th>Khung</th>
                                    <th>Nội dung</th>
                                    <th className="text-right">Đã gửi</th>
                                    <th className="text-right">Lỗi</th>
                                    <th className="text-right">Ra đơn</th>
                                    <th />
                                    <th className="text-right">Tỉ lệ</th>
                                </tr>
                            </thead>
                            <tbody>
                                {data.perf.map((m) => (
                                    <tr key={m.order_index}>
                                        <td className="num font-bold">{m.order_index + 1}</td>
                                        <td className="num">{SLOT_HOURS[m.order_index % SLOT_HOURS.length]}h</td>
                                        <td>
                                            {m.label && <div className="font-semibold">{m.label}</div>}
                                            <div style={{ color: "var(--ink-3)" }}>{short(m.body === "—" ? "" : m.body, 70) || "—"}</div>
                                        </td>
                                        <td className="num text-right">{num(m.sent)}</td>
                                        <td className="num text-right" style={{ color: m.failed ? "var(--bad)" : undefined }}>
                                            {m.failed ? num(m.failed) : "—"}
                                        </td>
                                        <td className="num text-right font-bold" style={{ color: m.conversions ? "var(--ok)" : undefined }}>
                                            {m.conversions ? num(m.conversions) : "—"}
                                        </td>
                                        <td className="w-[120px]"><Bar value={m.conversions} max={maxConv} /></td>
                                        <td className="num text-right">{m.sent > 0 ? pct(m.conversions / m.sent) : "—"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
                <div className="panel overflow-hidden">
                    <PanelHead title="Khách chốt ở ngày thứ mấy" hint="Giúp quyết định chuỗi nên dài hay ngắn" />
                    {data.byDay.length === 0 ? (
                        <Empty title="Chưa có đơn nào" />
                    ) : (
                        <div className="space-y-2.5 px-5 py-4">
                            {data.byDay.map((d) => (
                                <div key={String(d.journey_day)} className="flex items-center gap-3 text-[13px]">
                                    <span className="w-20 shrink-0">{d.journey_day ? `Ngày ${d.journey_day}` : "Không rõ"}</span>
                                    <Bar value={d.n} max={maxDay} />
                                    <span className="num w-20 shrink-0 text-right">
                                        <b>{num(d.n)}</b> · {pct(d.n / orders)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="panel overflow-hidden">
                    <PanelHead title="Chốt qua đường nào" hint="Hệ thống biết khách đã chốt nhờ đâu" />
                    {data.bySource.length === 0 ? (
                        <Empty title="Chưa có đơn nào" />
                    ) : (
                        <div className="space-y-2.5 px-5 py-4">
                            {data.bySource.map((s) => (
                                <div key={s.via} className="flex items-center gap-3 text-[13px]">
                                    <span className="w-40 shrink-0">{NGUON_CHOT[s.via] ?? s.via}</span>
                                    <Bar value={s.n} max={orders} tone="var(--brand)" />
                                    <span className="num w-20 shrink-0 text-right">
                                        <b>{num(s.n)}</b> · {pct(s.n / orders)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Màn Tra cứu khách ────────────────────────────────────────────────────────

const TRANG_THAI_KHACH: Record<string, { ten: string; kind: "ok" | "warn" | "bad" | "brand" | "muted" }> = {
    active: { ten: "Đang nhận tin", kind: "brand" },
    converted: { ten: "Đã chốt", kind: "ok" },
    opted_out: { ten: "Từ chối nhận tin", kind: "bad" },
    expired: { ten: "Hết chuỗi", kind: "muted" },
};

const SU_KIEN: Record<string, string> = {
    entered: "Vào tệp",
    replied: "Khách trả lời",
    ordered: "Chốt đơn",
    opted_out: "Từ chối nhận tin",
    expired: "Hết chuỗi",
    restarted: "Quay lại chuỗi",
};

interface CustRow {
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
    last_interaction_at: string;
    first_seen_at: string;
    stop_reason: string | null;
    sent_count: number;
}

interface CustDetail {
    customer: CustRow;
    sends: Array<{
        sent_at: string; journey_day: number | null; slot_index: number | null; channel: string;
        success: boolean; error_kind: string | null; error_message: string | null;
        order_index: number | null; label: string | null; body: string | null;
    }>;
    events: Array<{ type: string; journey_day: number | null; payload: Record<string, unknown>; occurred_at: string }>;
    upcoming: Array<{ scheduled_at: string; journey_day: number; slot_index: number; order_index: number | null; manual: boolean }>;
}

function StatusChip({ status }: { status: string }) {
    const s = TRANG_THAI_KHACH[status] ?? { ten: status, kind: "muted" as const };
    return <Chip kind={s.kind}>{s.ten}</Chip>;
}

function LookupScreen() {
    const [q, setQ] = useState("");
    const [rows, setRows] = useState<CustRow[] | null>(null);
    const [loading, setLoading] = useState(false);
    const [detail, setDetail] = useState<CustDetail | null>(null);
    const [err, setErr] = useState<string | null>(null);

    const search = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const term = q.trim();
        if (term.length < 2) return;
        setLoading(true);
        setErr(null);
        setDetail(null);
        try {
            const d = await getJson<{ customers: CustRow[] }>(`/api/customers?q=${encodeURIComponent(term)}`);
            setRows(d.customers);
        } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : "Lỗi");
        } finally {
            setLoading(false);
        }
    };

    const open = async (id: number) => {
        setErr(null);
        try {
            setDetail(await getJson<CustDetail>(`/api/customers?id=${id}`));
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (e2) {
            setErr(e2 instanceof Error ? e2.message : "Lỗi");
        }
    };

    return (
        <div className="space-y-5">
            <form className="panel flex flex-wrap items-center gap-3 px-5 py-4" onSubmit={search}>
                <input
                    className="field max-w-[420px] flex-1"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Tên, số điện thoại hoặc PSID của khách"
                    autoFocus
                />
                <button className="btn btn-primary" disabled={loading || q.trim().length < 2}>
                    {loading ? "Đang tìm…" : "Tìm"}
                </button>
                <span className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                    Tìm trên mọi page
                </span>
            </form>

            {err && <div className="panel"><Empty title="Không tra cứu được" hint={err} /></div>}

            {detail && <CustomerCard d={detail} onClose={() => setDetail(null)} />}

            {rows && (
                <div className="panel overflow-hidden">
                    <PanelHead title={`${num(rows.length)} khách khớp "${q.trim()}"`} hint="Bấm vào một dòng để xem khách đó đã nhận gì" />
                    {rows.length === 0 ? (
                        <Empty title="Không tìm thấy khách nào" />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="tbl min-w-[860px]">
                                <thead>
                                    <tr>
                                        <th>Khách</th>
                                        <th>Page</th>
                                        <th>SĐT</th>
                                        <th>Trạng thái</th>
                                        <th className="text-right">Ngày</th>
                                        <th className="text-right">Đã nhận</th>
                                        <th>Nhắn cuối</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((c) => (
                                        <tr key={c.id} className="cursor-pointer" onClick={() => void open(c.id)}>
                                            <td>
                                                <div className="font-semibold">{c.name ?? "(không tên)"}</div>
                                                <div className="mono" style={{ color: "var(--ink-3)" }}>{c.psid}</div>
                                            </td>
                                            <td>{c.page_name}</td>
                                            <td className="mono">{c.phone ?? "—"}</td>
                                            <td>
                                                <StatusChip status={c.status} />
                                                {c.stop_reason && (
                                                    <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                                                        {short(c.stop_reason, 44)}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="num text-right">{c.journey_day}</td>
                                            <td className="num text-right">{num(c.sent_count)}</td>
                                            <td style={{ color: "var(--ink-3)" }}>{ago(c.last_interaction_at)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function CustomerCard({ d, onClose }: { d: CustDetail; onClose: () => void }) {
    const c = d.customer;
    return (
        <div className="space-y-5">
            <div className="panel px-5 py-4">
                <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-[17px] font-bold">{c.name ?? "(không tên)"}</h2>
                    <span className="mono" style={{ color: "var(--ink-3)" }}>{c.psid}</span>
                    <StatusChip status={c.status} />
                    <span className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>{c.page_name}</span>
                    <button className="btn btn-ghost btn-sm ml-auto" onClick={onClose}>Đóng</button>
                </div>
                {c.stop_reason && (
                    <p className="mt-1 text-[13px]" style={{ color: "var(--ink-2)" }}>Lý do dừng: {c.stop_reason}</p>
                )}
            </div>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
                <Stat value={String(c.journey_day)} label="Ngày trong chuỗi" hint={c.journey_count > 1 ? `lần thứ ${c.journey_count} vào chuỗi` : "lần đầu"} tone="var(--brand)" />
                <Stat value={num(c.sent_count)} label="Đã nhận" hint="tin gửi thành công" />
                <Stat value={num(c.order_count)} label="Đơn trên POS" hint={c.order_count_baseline !== null ? `mốc lúc vào chuỗi: ${c.order_count_baseline}` : "chưa đối chiếu"} />
                <Stat value={c.phone ?? "—"} label="SĐT" />
                <Stat value={ago(c.last_interaction_at)} label="Nhắn cuối" hint={dt(c.last_interaction_at)} />
                <Stat value={ago(c.first_seen_at)} label="Vào tệp" hint={dt(c.first_seen_at)} />
            </div>

            {d.upcoming.length > 0 && (
                <div className="panel overflow-hidden">
                    <PanelHead title="Sắp nhận" />
                    <div className="overflow-x-auto">
                        <table className="tbl min-w-[520px]">
                            <thead><tr><th>Lúc</th><th className="text-right">Ngày</th><th>Khung</th><th>Tin</th></tr></thead>
                            <tbody>
                                {d.upcoming.map((u, i) => (
                                    <tr key={i}>
                                        <td className="num">{dt(u.scheduled_at)}</td>
                                        <td className="num text-right">{u.journey_day}</td>
                                        <td className="num">{u.manual ? "bắn tay" : `${SLOT_HOURS[u.slot_index] ?? "?"}h`}</td>
                                        <td>{u.order_index !== null ? `Tin ${u.order_index + 1}` : "Nội dung bắn tay"}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="panel overflow-hidden">
                <PanelHead title="Đã nhận gì" hint="60 lượt gửi gần nhất, cả thành công lẫn lỗi" />
                {d.sends.length === 0 ? (
                    <Empty title="Chưa nhận tin nào" />
                ) : (
                    <div className="overflow-x-auto">
                        <table className="tbl min-w-[820px]">
                            <thead><tr><th>Lúc</th><th className="text-right">Ngày</th><th>Tin</th><th>Kênh</th><th>Kết quả</th></tr></thead>
                            <tbody>
                                {d.sends.map((s, i) => (
                                    <tr key={i}>
                                        <td className="num">{dt(s.sent_at)}</td>
                                        <td className="num text-right">{s.journey_day ?? "—"}</td>
                                        <td>
                                            <div className="font-semibold">{s.order_index !== null ? `Tin ${s.order_index + 1}${s.label ? ` · ${s.label}` : ""}` : "Bắn tay"}</div>
                                            <div style={{ color: "var(--ink-3)" }}>{short(s.body, 60)}</div>
                                        </td>
                                        <td>{s.channel === "pancake" ? "Pancake" : "Facebook"}</td>
                                        <td>
                                            {s.success ? (
                                                <Chip kind="ok">đã gửi</Chip>
                                            ) : (
                                                <>
                                                    <Chip kind="bad">{(LOI[s.error_kind ?? ""] ?? LOI.UNKNOWN!).ten}</Chip>
                                                    <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>{short(s.error_message, 70)}</div>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <div className="panel overflow-hidden">
                <PanelHead title="Sự kiện" />
                {d.events.length === 0 ? (
                    <Empty title="Chưa có sự kiện" />
                ) : (
                    <div className="divide-y" style={{ borderColor: "var(--line-soft)" }}>
                        {d.events.map((e, i) => (
                            <div key={i} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-[13px]">
                                <span className="num w-28 shrink-0">{dt(e.occurred_at)}</span>
                                <Chip kind={e.type === "ordered" ? "ok" : e.type === "opted_out" ? "bad" : "muted"}>{SU_KIEN[e.type] ?? e.type}</Chip>
                                {e.journey_day && <span style={{ color: "var(--ink-3)" }}>ngày {e.journey_day}</span>}
                                {typeof e.payload?.via === "string" && (
                                    <span style={{ color: "var(--ink-3)" }}>qua {NGUON_CHOT[e.payload.via] ?? e.payload.via}</span>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─── Cửa sổ gửi từng page (hiện trong màn Theo dõi) ───────────────────────────
// Facebook chắc chắn cho chủ động nhắn trong 24h sau tin cuối của khách; sau đó
// phụ thuộc tag Human Agent nên page được page không. Hệ thống đo, và page nào
// gửi muộn toàn lỗi thì tự thu về chỉ gửi trong 24h.

interface WindowRow {
    page_id: string;
    page_name: string;
    is_active: boolean;
    send_window_hours: number | null;
    window_narrowed_at: string | null;
    n1: number; ok1: number;
    n2: number; ok2: number;
    n3: number; ok3: number;
}

function RateCell({ ok, n }: { ok: number; n: number }) {
    if (n === 0) return <td className="num text-right" style={{ color: "var(--ink-3)" }}>—</td>;
    const r = ok / n;
    const tone = r >= 0.6 ? "var(--ok)" : r >= 0.2 ? "var(--warn)" : "var(--bad)";
    return (
        <td className="num text-right">
            <b style={{ color: tone }}>{pct(r)}</b>
            <span style={{ color: "var(--ink-3)" }}> · {num(ok)}/{num(n)}</span>
        </td>
    );
}

function WindowPanel() {
    const [rows, setRows] = useState<WindowRow[] | null>(null);

    useEffect(() => {
        let alive = true;
        const load = () =>
            getJson<{ pages: WindowRow[] }>("/api/window")
                .then((d) => alive && setRows(d.pages))
                .catch(() => { /* vòng tự cập nhật — không báo lỗi liên tục */ });
        void load();
        const id = setInterval(load, 60_000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, []);

    return (
        <div className="panel overflow-hidden">
            <PanelHead
                title="Gửi được theo thời gian từ lúc khách nhắn"
                hint="7 ngày gần nhất. Facebook chắc chắn cho gửi trong 24 giờ; sau đó tuỳ page. Page gửi muộn toàn lỗi → hệ thống tự chỉ gửi trong 24 giờ, 7 ngày sau thử lại."
            />
            {!rows ? (
                <Empty title="Đang tải…" />
            ) : rows.length === 0 ? (
                <Empty title="Chưa có page nào đang chạy" hint="Bật chiến dịch cho một page là bảng này bắt đầu có số." />
            ) : (
                <div className="overflow-x-auto">
                    <table className="tbl min-w-[820px]">
                        <thead>
                            <tr>
                                <th>Page</th>
                                <th className="text-right">Khách nhắn &lt; 24 giờ</th>
                                <th className="text-right">1–3 ngày</th>
                                <th className="text-right">3–7 ngày</th>
                                <th>Đang gửi cho</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.page_id}>
                                    <td className="font-semibold">{r.page_name}</td>
                                    <RateCell ok={r.ok1} n={r.n1} />
                                    <RateCell ok={r.ok2} n={r.n2} />
                                    <RateCell ok={r.ok3} n={r.n3} />
                                    <td>
                                        {r.send_window_hours !== null ? (
                                            <>
                                                <Chip kind="warn">chỉ khách nhắn &lt; {r.send_window_hours} giờ</Chip>
                                                <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--ink-3)" }}>
                                                    tự thu hẹp {dt(r.window_narrowed_at)} · gửi muộn toàn lỗi
                                                </div>
                                            </>
                                        ) : (
                                            <Chip kind="ok">khách nhắn trong 7 ngày</Chip>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── Nhật ký job (hiện trong màn Theo dõi) ────────────────────────────────────

const TEN_JOB: Record<string, string> = {
    sync: "Đồng bộ khách",
    plan: "Xếp lịch",
    send: "Gửi tin",
    pos: "Đối chiếu POS",
    health: "Sức khoẻ page",
    webhook: "Webhook",
};

interface JobRun {
    job: string;
    page_name: string | null;
    started_at: string;
    finished_at: string | null;
    ok: boolean | null;
    stats: Record<string, unknown>;
    error: string | null;
}

function JobsPanel() {
    const [runs, setRuns] = useState<JobRun[] | null>(null);

    useEffect(() => {
        let alive = true;
        const load = () =>
            getJson<{ runs: JobRun[] }>("/api/jobs")
                .then((d) => alive && setRuns(d.runs))
                .catch(() => { /* vòng tự cập nhật — không báo lỗi liên tục */ });
        void load();
        const id = setInterval(load, 30_000);
        return () => {
            alive = false;
            clearInterval(id);
        };
    }, []);

    return (
        <div className="panel overflow-hidden">
            <PanelHead title="Nhật ký chạy nền" hint="30 lượt gần nhất của các việc tự động — dòng đỏ là việc bị lỗi" />
            {!runs ? (
                <Empty title="Đang tải…" />
            ) : runs.length === 0 ? (
                <Empty title="Chưa có lượt chạy nào" />
            ) : (
                <div className="overflow-x-auto">
                    <table className="tbl min-w-[820px]">
                        <thead><tr><th>Bắt đầu</th><th>Việc</th><th>Page</th><th className="text-right">Mất</th><th>Kết quả</th><th>Chi tiết</th></tr></thead>
                        <tbody>
                            {runs.map((r, i) => {
                                const secs = r.finished_at
                                    ? Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000)
                                    : null;
                                return (
                                    <tr key={i}>
                                        <td className="num">{dt(r.started_at)}</td>
                                        <td className="font-semibold">{TEN_JOB[r.job] ?? r.job}</td>
                                        <td>{r.page_name ?? "—"}</td>
                                        <td className="num text-right">{secs === null ? "đang chạy" : `${secs}s`}</td>
                                        <td>
                                            {r.ok === null ? <Chip kind="warn">đang chạy</Chip> : r.ok ? <Chip kind="ok">ok</Chip> : <Chip kind="bad">lỗi</Chip>}
                                        </td>
                                        <td className="mono text-[11.5px]" style={{ color: r.error ? "var(--bad)" : "var(--ink-3)" }}>
                                            {r.error ? short(r.error, 110) : short(JSON.stringify(r.stats), 110)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

// ─── Số liệu hội thoại thật (hiện trên màn Kịch bản) ──────────────────────────

const TEN_NGON_NGU: Record<string, string> = {
    ar: "Ả Rập", ja: "Nhật", zh: "Trung", ko: "Hàn", th: "Thái", vi: "Việt", latin: "Anh", unknown: "không rõ",
};

interface ChatAnalysis {
    report: {
        conversations?: number;
        withCustomerMessage?: number;
        priceAskedFirstTurn?: number;
        phoneRate?: number;
        prices?: Array<{ currency: string; amount: number; count: number }>;
        langs?: Array<{ lang: string; pct: number }>;
        objections?: Array<{ label: string; count: number; samples?: string[] }>;
        slots?: Array<{ label: string; hint: string; seed?: string }>;
    };
    conversations: number;
    analyzed_at: string;
}

function AnalysisPanel({ page }: { page: PageInfo }) {
    const [a, setA] = useState<ChatAnalysis | null | undefined>(undefined);

    useEffect(() => {
        let alive = true;
        setA(undefined);
        getJson<{ analysis: ChatAnalysis | null }>(`/api/analysis?pageId=${encodeURIComponent(page.pageId)}`)
            .then((d) => alive && setA(d.analysis))
            .catch(() => alive && setA(null));
        return () => {
            alive = false;
        };
    }, [page.pageId]);

    if (a === undefined) return null;
    if (a === null) {
        return (
            <details className="panel px-5 py-3 text-[13px]">
                <summary className="cursor-pointer font-semibold" style={{ color: "var(--ink-2)" }}>
                    Muốn soạn dựa trên hội thoại thật của page này?
                </summary>
                <p className="mt-2" style={{ color: "var(--ink-2)" }}>
                    Hệ thống đọc khoảng 100 hội thoại gần nhất rồi cho biết khách hay hỏi gì, giá đang báo bao nhiêu,
                    vướng ở đâu, và gợi ý mỗi ô nên nói gì. Chạy một lần trên server (vài phút, không tốn phí):
                </p>
                <code className="mono mt-1.5 block rounded-md px-3 py-2" style={{ background: "var(--card-2)" }}>
                    node dist/scripts/phan-tich-chat.js --page {page.pageId} --so 100
                </code>
            </details>
        );
    }

    const r = a.report;
    const price = r.prices?.[0];
    const lang = r.langs?.[0];
    return (
        <div className="panel overflow-hidden">
            <PanelHead
                title={`Số liệu từ ${num(a.conversations)} hội thoại thật`}
                hint={`Phân tích lúc ${dt(a.analyzed_at)} — dùng để quyết định mỗi ô nên nói gì`}
            />
            <div className="grid grid-cols-2 gap-3 px-5 py-4 lg:grid-cols-4">
                <Stat
                    value={r.withCustomerMessage ? pct((r.priceAskedFirstTurn ?? 0) / r.withCustomerMessage) : "—"}
                    label="Hỏi giá ngay câu đầu"
                    hint="nên báo giá ở tin 1–2"
                    tone="var(--brand)"
                />
                <Stat value={price ? `${price.currency} ${price.amount}` : "—"} label="Giá đang báo" hint={price ? `${price.count} lần` : "không thấy trong hội thoại"} />
                <Stat value={pct(r.phoneRate ?? 0)} label="Để lại SĐT" hint="tỉ lệ hiện tại" tone="var(--ok)" />
                <Stat value={lang ? TEN_NGON_NGU[lang.lang] ?? lang.lang : "—"} label="Ngôn ngữ chính" hint={lang ? pct(lang.pct) : undefined} />
            </div>
            {(r.objections?.length ?? 0) > 0 && (
                <div className="border-t px-5 py-3.5" style={{ borderColor: "var(--line-soft)" }}>
                    <div className="mb-1.5 text-[13px] font-bold">Vấn đề khiến khách không chốt</div>
                    <ul className="space-y-1.5 text-[13px]">
                        {r.objections!.slice(0, 6).map((o) => (
                            <li key={o.label}>
                                <b>{o.label}</b> <span style={{ color: "var(--ink-3)" }}>— {num(o.count)} hội thoại</span>
                                {o.samples?.[0] && (
                                    <div className="text-[12.5px]" style={{ color: "var(--ink-3)" }}>“{short(o.samples[0], 110)}”</div>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {(r.slots?.length ?? 0) > 0 && (
                <details className="border-t px-5 py-3.5 text-[13px]" style={{ borderColor: "var(--line-soft)" }}>
                    <summary className="cursor-pointer font-bold">Gợi ý cho từng ô (theo đúng số liệu trên)</summary>
                    <ol className="mt-2 space-y-2">
                        {r.slots!.map((s, i) => (
                            <li key={i}>
                                <b>Ô {i + 1} · {s.label}</b>
                                <div style={{ color: "var(--ink-2)" }}>💡 {s.hint}</div>
                                {s.seed && (
                                    <div className="mt-0.5 text-[12.5px]" style={{ color: "var(--ink-3)" }}>
                                        Nhân viên đang dùng: “{short(s.seed, 200)}”
                                    </div>
                                )}
                            </li>
                        ))}
                    </ol>
                </details>
            )}
        </div>
    );
}

// ═══ ỨNG DỤNG ═════════════════════════════════════════════════════════════════

export default function App() {
    const [screen, setScreen] = useState<Screen>("tong-quan");
    const [pages, setPages] = useState<PageInfo[]>([]);
    const [loadingPages, setLoadingPages] = useState(true);
    const [pageId, setPageId] = useState("");

    const [schedules, setSchedules] = useState<Schedule[]>([]);
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [loadingCust, setLoadingCust] = useState(false);
    const [selected, setSelected] = useState<Set<string>>(new Set());

    const [msgs, setMsgs] = useState<string[]>(() => Array(SLOT_COUNT).fill(""));
    const [labels, setLabels] = useState<string[]>(() => Array(SLOT_COUNT).fill(""));
    const [medias, setMedias] = useState<string[][]>(() => Array.from({ length: SLOT_COUNT }, () => []));
    const [uploadingSlot, setUploadingSlot] = useState<number | null>(null);
    const [saving, setSaving] = useState(false);

    const [manualBody, setManualBody] = useState("");
    const [manualMedia, setManualMedia] = useState<string[]>([]);
    const [manualUploading, setManualUploading] = useState(false);
    const [sending, setSending] = useState(false);
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

    const [monitor, setMonitor] = useState<MonitorData | null>(null);
    const [loadingMonitor, setLoadingMonitor] = useState(false);
    const [monitorPaused, setMonitorPaused] = useState(false);

    const [toast, setToast] = useState<{ text: string; kind: "ok" | "bad" } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const say = useCallback((text: string, kind: "ok" | "bad" = "ok", ms = 5000) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ text, kind });
        toastTimer.current = setTimeout(() => setToast(null), ms);
    }, []);

    const page = useMemo(() => pages.find((p) => p.pageId === pageId) ?? null, [pages, pageId]);
    const schedule = useMemo(() => schedules.find((s) => s.pageId === pageId) ?? null, [schedules, pageId]);

    // ─── Tải dữ liệu ──────────────────────────────────────────────────────
    const loadPages = useCallback(async () => {
        setLoadingPages(true);
        try {
            const [pr, sr] = await Promise.all([
                apiFetch("/api/broadcast?getPages=true"),
                apiFetch("/api/broadcast/schedule"),
            ]);
            const pd = await pr.json();
            const sd = await sr.json();
            if (pd.pages) setPages(pd.pages);
            if (sd.schedules) setSchedules(sd.schedules);
        } catch {
            say("Không tải được danh sách page", "bad");
        } finally {
            setLoadingPages(false);
        }
    }, [say]);

    useEffect(() => {
        void loadPages();
    }, [loadPages]);

    const loadCustomers = useCallback(
        async (pid: string) => {
            if (!pid) return;
            setLoadingCust(true);
            setSelected(new Set());
            try {
                const r = await apiFetch(`/api/broadcast?pageFilter=${encodeURIComponent(pid)}`);
                const d = await r.json();
                setCustomers(d.customers ?? []);
            } catch {
                say("Không tải được danh sách khách", "bad");
                setCustomers([]);
            } finally {
                setLoadingCust(false);
            }
        },
        [say]
    );

    const loadMonitor = useCallback(async () => {
        setLoadingMonitor(true);
        try {
            const r = await apiFetch("/api/monitor");
            const d = await r.json();
            if (!r.ok) throw new Error(d.error);
            setMonitor(d);
        } catch {
            /* im lặng: vòng tự cập nhật không nên spam thông báo lỗi */
        } finally {
            setLoadingMonitor(false);
        }
    }, []);

    // Tự cập nhật mỗi 10 giây khi đang mở màn hình Theo dõi. Dừng khi rời màn
    // hình hoặc khi người dùng bấm tạm dừng — tránh gọi API vô ích cả ngày.
    useEffect(() => {
        if (screen !== "theo-doi") return;
        void loadMonitor();
        if (monitorPaused) return;
        const id = setInterval(() => void loadMonitor(), 10_000);
        return () => clearInterval(id);
    }, [screen, monitorPaused, loadMonitor]);

    // Đổ nội dung kịch bản vào ô soạn theo segIdx — KHÔNG theo vị trí mảng, vì
    // kịch bản chỉ chứa các ô có nội dung, đổ theo vị trí sẽ lệch khung giờ.
    useEffect(() => {
        const nm: string[] = Array(SLOT_COUNT).fill("");
        const nl: string[] = Array(SLOT_COUNT).fill("");
        const nd: string[][] = Array.from({ length: SLOT_COUNT }, () => []);
        for (const seg of schedule?.segments ?? []) {
            const i = seg.segIdx;
            if (i >= 0 && i < SLOT_COUNT) {
                nm[i] = seg.message ?? "";
                nl[i] = seg.label ?? "";
                nd[i] = seg.media ?? [];
            }
        }
        setMsgs(nm);
        setLabels(nl);
        setMedias(nd);
    }, [schedule]);

    useEffect(() => {
        if (pageId && screen === "ban-tay") void loadCustomers(pageId);
    }, [pageId, screen, loadCustomers]);

    // ─── Tải ảnh ──────────────────────────────────────────────────────────
    const upload = useCallback(
        async (files: File[]): Promise<string[]> => {
            const imgs = files.filter((f) => f.type.startsWith("image/"));
            if (imgs.length === 0) return [];
            const fd = new FormData();
            for (const f of imgs) fd.append("images", f);
            if (pageId) fd.append("pageId", pageId);
            const res = await apiFetch("/api/upload", { method: "POST", body: fd });
            const d = await res.json();
            if (!res.ok || !d.media) {
                say(d.error ?? "Tải ảnh lên thất bại", "bad");
                return [];
            }
            return (d.media as { url: string }[]).map((m) => m.url);
        },
        [pageId, say]
    );

    const addSlotMedia = useCallback(
        async (i: number, files: File[]) => {
            setUploadingSlot(i);
            const urls = await upload(files);
            if (urls.length) setMedias((prev) => prev.map((m, k) => (k === i ? [...m, ...urls] : m)));
            setUploadingSlot(null);
        },
        [upload]
    );

    const addManualMedia = useCallback(
        async (files: File[]) => {
            setManualUploading(true);
            const urls = await upload(files);
            if (urls.length) setManualMedia((prev) => [...prev, ...urls]);
            setManualUploading(false);
        },
        [upload]
    );

    // ─── Lưu kịch bản ─────────────────────────────────────────────────────
    const saveScript = useCallback(async () => {
        if (!pageId) return;
        setSaving(true);
        try {
            const segments = msgs.map((m, i) => ({
                segIdx: i,
                hour: SLOT_HOURS[i % SLOT_HOURS.length],
                label: labels[i] ?? "",
                message: m,
                media: medias[i] ?? [],
            }));
            const res = await apiFetch("/api/broadcast/schedule", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "save", schedule: { pageId, segments } }),
            });
            const d = await res.json();
            if (!res.ok) {
                say(d.error ?? "Lưu thất bại", "bad");
                return;
            }
            say(d.message ?? "Đã lưu");
            await loadPages();
        } catch {
            say("Lỗi kết nối khi lưu", "bad");
        } finally {
            setSaving(false);
        }
    }, [pageId, msgs, labels, medias, say, loadPages]);

    // ─── Chép kịch bản từ page khác ───────────────────────────────────────
    // Chỉ đổ vào các ô soạn, CHƯA lưu: người dùng sửa lại tên sản phẩm/giá cho
    // đúng page này rồi mới bấm "Lưu kịch bản". Kịch bản page nguồn giữ nguyên.
    const copySources = useMemo(
        () =>
            schedules
                .filter((s) => s.pageId !== pageId && s.hasScript)
                .map((s) => ({
                    pageId: s.pageId,
                    pageName: s.pageName,
                    filled: s.segments.filter((g) => g.message.trim() || g.media.length).length,
                }))
                .filter((s) => s.filled > 0)
                .sort((a, b) => a.pageName.localeCompare(b.pageName)),
        [schedules, pageId]
    );

    const copyScriptFrom = useCallback(
        (sourcePageId: string) => {
            const src = schedules.find((s) => s.pageId === sourcePageId);
            if (!src) return;
            const hasContent = msgs.some((m, i) => m.trim() || (medias[i] ?? []).length);
            if (
                hasContent &&
                !confirm(`Chép kịch bản của "${src.pageName}" sẽ thay toàn bộ nội dung đang soạn ở đây.\n\nTiếp tục?`)
            )
                return;

            const nm: string[] = Array(SLOT_COUNT).fill("");
            const nl: string[] = Array(SLOT_COUNT).fill("");
            const nd: string[][] = Array.from({ length: SLOT_COUNT }, () => []);
            let copied = 0;
            for (const seg of src.segments) {
                const i = seg.segIdx;
                if (i < 0 || i >= SLOT_COUNT) continue;
                nm[i] = seg.message ?? "";
                nl[i] = seg.label ?? "";
                nd[i] = [...(seg.media ?? [])];
                if (nm[i].trim() || nd[i].length) copied++;
            }
            setMsgs(nm);
            setLabels(nl);
            setMedias(nd);
            say(`Đã chép ${copied} tin từ "${src.pageName}" — sửa cho đúng page này rồi bấm "Lưu kịch bản"`, "ok", 8000);
        },
        [schedules, msgs, medias, say]
    );

    // ─── Bật / tắt page ───────────────────────────────────────────────────
    const toggleActive = useCallback(async () => {
        if (!page) return;
        const turningOn = !page.isActive;
        if (
            turningOn &&
            !confirm(
                `Bật chiến dịch cho "${page.name}"?\n\nEngine sẽ bắt đầu gửi tin thật cho ${num(
                    page.activeCustomers
                )} khách hàng, gửi đủ tệp ngay từ khung giờ gần nhất.`
            )
        )
            return;

        const res = await apiFetch("/api/broadcast/schedule", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "toggle", scheduleId: page.pageId }),
        });
        const d = await res.json();
        if (!res.ok) {
            say(d.error ?? "Không đổi được trạng thái", "bad");
            return;
        }
        say(d.isActive ? "Đã BẬT chiến dịch — engine bắt đầu gửi" : "Đã tắt chiến dịch");
        await loadPages();
    }, [page, say, loadPages]);

    // ─── Bắn tay ──────────────────────────────────────────────────────────
    const sendManual = useCallback(async () => {
        if (!page || selected.size === 0) return;
        const psids = customers.filter((c) => selected.has(c.id)).map((c) => c.psid);
        if (!confirm(`Gửi cho ${psids.length} khách?\n\nTin vào hàng đợi và được gửi trong vòng 1 phút.`)) return;

        setSending(true);
        const since = new Date().toISOString();
        try {
            const res = await apiFetch("/api/send", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ pageId, psids, message: manualBody, media: manualMedia }),
            });
            const d = await res.json();
            if (!res.ok) {
                say(d.error ?? "Không xếp được hàng đợi", "bad", 8000);
                return;
            }
            say(d.message, "ok", 8000);

            const deadline = Date.now() + 10 * 60_000;
            const poll = async () => {
                if (Date.now() > deadline) return setProgress(null);
                try {
                    const r = await apiFetch(
                        `/api/send?pageId=${encodeURIComponent(pageId)}&since=${encodeURIComponent(since)}`
                    );
                    const p = await r.json();
                    setProgress({ done: p.done ?? 0, total: p.total ?? 0 });
                    if ((p.queued ?? 0) + (p.sending ?? 0) > 0) setTimeout(poll, 3000);
                    else {
                        say(`Xong: ${p.sent} gửi được${p.failed ? ` · ${p.failed} lỗi` : ""}`, "ok", 9000);
                        setTimeout(() => setProgress(null), 4000);
                    }
                } catch {
                    setProgress(null);
                }
            };
            void poll();
        } finally {
            setSending(false);
        }
    }, [page, pageId, selected, customers, manualBody, manualMedia, say]);

    const goto = useCallback((pid: string, s: Screen) => {
        setPageId(pid);
        setScreen(s);
    }, []);

    const NAV: Array<{ key: Screen; label: string; needsPage: boolean }> = [
        { key: "tong-quan", label: "Tổng quan", needsPage: false },
        { key: "theo-doi", label: "Theo dõi", needsPage: false },
        { key: "kich-ban", label: "Kịch bản tự động", needsPage: true },
        { key: "ban-tay", label: "Bắn tay", needsPage: true },
        { key: "hieu-qua", label: "Hiệu quả", needsPage: true },
        { key: "tra-cuu", label: "Tra cứu khách", needsPage: false },
    ];

    return (
        <div className="min-h-screen">
            {/* ─── Thanh trên cùng ─────────────────────────────────────── */}
            <header
                className="sticky top-0 z-30 border-b"
                style={{ background: "var(--card)", borderColor: "var(--line)" }}
            >
                <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-2.5">
                    <div className="flex items-center gap-2">
                        <span
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-[13px] font-bold"
                            style={{ background: "var(--brand)", color: "var(--brand-ink)" }}
                        >
                            B
                        </span>
                        <span className="text-[14.5px] font-bold tracking-tight">Bắn bot TALPHA</span>
                    </div>

                    <nav className="flex gap-1">
                        {NAV.map((n) => {
                            const disabled = n.needsPage && !pageId;
                            const on = screen === n.key;
                            return (
                                <button
                                    key={n.key}
                                    disabled={disabled}
                                    onClick={() => setScreen(n.key)}
                                    title={disabled ? "Chọn một page trước" : undefined}
                                    className="rounded-lg px-3 py-1.5 text-[13.5px] font-semibold disabled:opacity-40"
                                    style={
                                        on
                                            ? { background: "var(--brand-soft)", color: "var(--brand)" }
                                            : { color: "var(--ink-2)" }
                                    }
                                >
                                    {n.label}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="ml-auto flex items-center gap-2.5">
                        <select
                            className="field max-w-[280px] !w-auto !py-1.5 !text-[13px]"
                            value={pageId}
                            onChange={(e) => setPageId(e.target.value)}
                        >
                            <option value="">— Chọn page —</option>
                            {pages.map((p) => (
                                <option key={p.pageId} value={p.pageId}>
                                    {p.name} ({num(p.activeCustomers)})
                                </option>
                            ))}
                        </select>
                        {page && <PageStateChip p={page} />}
                    </div>
                </div>

                {/* Thanh ngữ cảnh: luôn thấy đang làm việc với page nào */}
                {page && (
                    <div
                        className="border-t px-5 py-2"
                        style={{ background: "var(--card-2)", borderColor: "var(--line-soft)" }}
                    >
                        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-1 text-[12.5px]">
                            <span className="font-semibold">{page.name}</span>
                            <span className="num" style={{ color: "var(--ink-2)" }}>
                                <b>{num(page.activeCustomers)}</b> khách gửi được
                                <span style={{ color: "var(--ink-3)" }}> / {num(page.totalCustomers)} trong tệp</span>
                            </span>
                            {!page.hasScript && <Chip kind="warn">chưa có kịch bản</Chip>}
                            {page.isActive && page.rampPercent < 100 && (
                                <Chip kind="warn">khởi động dần {page.rampPercent}%</Chip>
                            )}
                            <span className="ml-auto" style={{ color: "var(--ink-3)" }}>
                                đồng bộ {ago(page.lastSyncedAt ?? "")}
                            </span>
                        </div>
                    </div>
                )}
            </header>

            <main className="mx-auto max-w-[1440px] px-5 py-5">
                {screen === "tong-quan" && (
                    <OverviewScreen pages={pages} loading={loadingPages} onPick={goto} />
                )}

                {screen === "theo-doi" && (
                    <MonitorScreen
                        data={monitor}
                        loading={loadingMonitor}
                        paused={monitorPaused}
                        onTogglePause={() => setMonitorPaused((v) => !v)}
                        onRefresh={() => void loadMonitor()}
                        onOpenPage={(pid) => goto(pid, "kich-ban")}
                    />
                )}
                {screen === "theo-doi" && (
                    <div className="mt-5 space-y-5">
                        <WindowPanel />
                        <JobsPanel />
                    </div>
                )}

                {screen === "tra-cuu" && <LookupScreen />}

                {screen === "hieu-qua" && page && <ReportScreen page={page} />}

                {screen !== "tong-quan" && screen !== "theo-doi" && screen !== "tra-cuu" && !page && (
                    <div className="panel">
                        <Empty
                            title="Chưa chọn page"
                            hint="Chọn một page ở góc trên bên phải, hoặc quay lại Tổng quan để xem danh sách."
                            action={
                                <button className="btn btn-primary" onClick={() => setScreen("tong-quan")}>
                                    Về Tổng quan
                                </button>
                            }
                        />
                    </div>
                )}

                {screen === "kich-ban" && page && (
                    <div className="mb-5">
                        <AnalysisPanel page={page} />
                    </div>
                )}
                {screen === "kich-ban" && page && (
                    <ScriptScreen
                        page={page}
                        schedule={schedule}
                        msgs={msgs}
                        medias={medias}
                        labels={labels}
                        uploadingSlot={uploadingSlot}
                        saving={saving}
                        onLabel={(i, v) => setLabels((p) => p.map((x, k) => (k === i ? v : x)))}
                        onBody={(i, v) => setMsgs((p) => p.map((x, k) => (k === i ? v : x)))}
                        onPaste={(i) => (e) => {
                            const f = Array.from(e.clipboardData?.files ?? []);
                            if (f.length) {
                                e.preventDefault();
                                void addSlotMedia(i, f);
                            }
                        }}
                        onDrop={(i) => (e) => {
                            const f = Array.from(e.dataTransfer?.files ?? []);
                            if (f.length) {
                                e.preventDefault();
                                void addSlotMedia(i, f);
                            }
                        }}
                        onPickFile={(i) => (e) => {
                            const f = Array.from(e.target.files ?? []);
                            if (f.length) void addSlotMedia(i, f);
                            e.target.value = "";
                        }}
                        onRemoveMedia={(i, m) =>
                            setMedias((p) => p.map((x, k) => (k === i ? x.filter((_, j) => j !== m) : x)))
                        }
                        onSave={saveScript}
                        onToggleActive={toggleActive}
                        copySources={copySources}
                        onCopyFrom={copyScriptFrom}
                    />
                )}

                {screen === "ban-tay" && page && (
                    <ManualScreen
                        page={page}
                        customers={customers}
                        loading={loadingCust}
                        selected={selected}
                        onToggle={(id) =>
                            setSelected((prev) => {
                                const n = new Set(prev);
                                if (n.has(id)) n.delete(id);
                                else n.add(id);
                                return n;
                            })
                        }
                        onToggleAll={() =>
                            setSelected((prev) =>
                                prev.size === customers.length ? new Set() : new Set(customers.map((c) => c.id))
                            )
                        }
                        body={manualBody}
                        media={manualMedia}
                        uploading={manualUploading}
                        sending={sending}
                        progress={progress}
                        onBody={setManualBody}
                        onPaste={(e) => {
                            const f = Array.from(e.clipboardData?.files ?? []);
                            if (f.length) {
                                e.preventDefault();
                                void addManualMedia(f);
                            }
                        }}
                        onDrop={(e) => {
                            const f = Array.from(e.dataTransfer?.files ?? []);
                            if (f.length) {
                                e.preventDefault();
                                void addManualMedia(f);
                            }
                        }}
                        onPickFile={(e) => {
                            const f = Array.from(e.target.files ?? []);
                            if (f.length) void addManualMedia(f);
                            e.target.value = "";
                        }}
                        onRemoveMedia={(i) => setManualMedia((p) => p.filter((_, k) => k !== i))}
                        onSend={sendManual}
                        onReload={() => void loadCustomers(pageId)}
                    />
                )}
            </main>

            {toast && (
                <div
                    className="panel fixed bottom-5 left-1/2 z-50 max-w-[92vw] -translate-x-1/2 px-4 py-2.5 text-[13.5px] font-medium"
                    style={{
                        background: toast.kind === "bad" ? "var(--bad-soft)" : "var(--ok-soft)",
                        color: toast.kind === "bad" ? "var(--bad)" : "var(--ok)",
                        borderColor: "transparent",
                    }}
                >
                    {toast.text}
                </div>
            )}
        </div>
    );
}
