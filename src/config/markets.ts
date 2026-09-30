/**
 * Múi giờ của từng thị trường TALPHA.
 *
 * Đây là bảng tra CỨNG, không đọc từ env: sai múi giờ nghĩa là bắn tin lúc
 * 3 giờ sáng cho khách hàng thật. Page nào thuộc thị trường lạ thì phải khai
 * utc_offset thủ công khi thêm page.
 *
 * Thị trường có giờ mùa hè (châu Âu…) khai thêm `tz` (tên múi giờ IANA). Khi đó
 * utcOffset chỉ là giờ mùa đông; giờ thật của page được job sync tính lại theo
 * `tz` mỗi lượt (xem pages.repo syncDstOffsets).
 */
export interface Market {
    readonly key: string;
    readonly label: string;
    readonly city: string;
    readonly utcOffset: number;
    readonly flag: string;
    readonly tz?: string;
}

export const MARKETS = {
    // Nghiệp vụ 30/09/2026: KHÔNG chia page theo nước nữa — mọi page gửi 6h · 11h ·
    // 17h · 21h theo giờ Việt Nam. Các thị trường bên dưới giữ lại cho trường hợp
    // sau này cần tách riêng một page.
    Chung:   { key: "Chung",   label: "Giờ Việt Nam", city: "Việt Nam",  utcOffset: 7, flag: "🕖" },
    Saudi:   { key: "Saudi",   label: "Ả Rập Xê Út", city: "Riyadh",     utcOffset: 3, flag: "🇸🇦" },
    UAE:     { key: "UAE",     label: "UAE",          city: "Dubai",      utcOffset: 4, flag: "🇦🇪" },
    Kuwait:  { key: "Kuwait",  label: "Kuwait",       city: "Kuwait City",utcOffset: 3, flag: "🇰🇼" },
    Oman:    { key: "Oman",    label: "Oman",         city: "Muscat",     utcOffset: 4, flag: "🇴🇲" },
    Qatar:   { key: "Qatar",   label: "Qatar",        city: "Doha",       utcOffset: 3, flag: "🇶🇦" },
    Bahrain: { key: "Bahrain", label: "Bahrain",      city: "Manama",     utcOffset: 3, flag: "🇧🇭" },
    Japan:   { key: "Japan",   label: "Nhật Bản",     city: "Tokyo",      utcOffset: 9, flag: "🇯🇵" },
    Taiwan:  { key: "Taiwan",  label: "Đài Loan",     city: "Đài Bắc",    utcOffset: 8, flag: "🇹🇼" },
    Singapore: { key: "Singapore", label: "Singapore", city: "Singapore", utcOffset: 8, flag: "🇸🇬" },
    Philippines: { key: "Philippines", label: "Philippines", city: "Manila", utcOffset: 8, flag: "🇵🇭" },
    HongKong: { key: "HongKong", label: "Hồng Kông", city: "Hong Kong", utcOffset: 8, flag: "🇭🇰" },
    Vietnam: { key: "Vietnam", label: "Việt Nam", city: "Hà Nội", utcOffset: 7, flag: "🇻🇳" },
    // Ý đổi giờ mùa hè: +2 từ cuối tháng 3 tới cuối tháng 10, còn lại +1
    Italy: { key: "Italy", label: "Ý", city: "Rome", utcOffset: 1, flag: "🇮🇹", tz: "Europe/Rome" },
} as const satisfies Record<string, Market>;

export type MarketKey = keyof typeof MARKETS;

/** Thị trường mặc định khi thêm page mà không nói gì: đồng hồ chung giờ Việt Nam. */
export const DEFAULT_MARKET: MarketKey = "Chung";

export const MARKET_KEYS = Object.keys(MARKETS) as MarketKey[];

export function isMarketKey(v: string): v is MarketKey {
    return Object.prototype.hasOwnProperty.call(MARKETS, v);
}

/** Trả về múi giờ của thị trường, hoặc null nếu không nhận ra tên. */
export function utcOffsetOf(market: string): number | null {
    return isMarketKey(market) ? MARKETS[market].utcOffset : null;
}
