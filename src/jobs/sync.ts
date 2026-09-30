import type { Logger } from "pino";
import { config } from "../config/index.js";
import { localDateStr, localHourDecimal, DAY_MS } from "../lib/time.js";
import { runJob, withJobRun, isMain, shouldStop } from "../lib/runner.js";
import { PURCHASE_TAGS } from "../domain/rules.js";
import type { Page } from "../domain/types.js";
import * as pancake from "../clients/pancake.js";
import * as pagesRepo from "../db/repositories/pages.repo.js";
import * as customersRepo from "../db/repositories/customers.repo.js";
import * as queueRepo from "../db/repositories/queue.repo.js";
import { planPage } from "./plan.js";

/**
 * JOB SYNC — làm mới tệp khách của một page từ Pancake, rồi gọi PLAN xếp hàng đợi hôm nay.
 *
 * Hai chế độ:
 *   - ĐẦY ĐỦ: quét lùi tới 3 năm. Mỗi page một lần/ngày lúc SYNC_HOUR_LOCAL giờ
 *     địa phương, và ngay lập tức với page chưa từng đồng bộ.
 *   - NHANH: chỉ lấy hội thoại có hoạt động từ lần quét trước. Chạy mọi lượt
 *     còn lại, để khách vừa nhắn vào chuỗi ngay trong ngày thay vì chờ tới đêm
 *     (nghiệp vụ 29/09: "khách mới nhắn thì gửi luôn").
 *
 * Lịch chạy: cron gọi mỗi 15 phút (`npm run job:sync`). Một dòng cron phục vụ
 * mọi múi giờ vì job tự chọn chế độ cho từng page theo giờ địa phương của page.
 *
 * Chạy tay đầy đủ cho một page (bỏ qua kiểm tra giờ):  npm run job:sync -- --page <id>
 * Chạy tay đầy đủ cho mọi page đang bật:              npm run job:sync -- --force
 */

export type SyncMode = "full" | "quick";

export interface SyncStats extends Record<string, unknown> {
    mode: SyncMode;
    scanned: number;
    windows: number;
    hitCap: boolean;
    inserted: number;
    rejoined: number;
    updated: number;
    optedOut: number;
    convertedByTag: number;
    convertedByPhone: number;
    expiredOutOfWindow: number;
    expiredJourneyDone: number;
    planned: number;
}

/** Page này có tới giờ quét đầy đủ chưa? Page chưa từng đồng bộ thì luôn tới giờ. */
export function isDueForSync(page: Page, now: Date = new Date()): boolean {
    if (!page.last_synced_at) return true;
    const hourNow = Math.floor(localHourDecimal(page.utc_offset, now));
    if (hourNow !== config.sync.hourLocal) return false;
    return localDateStr(page.utc_offset, page.last_synced_at) !== localDateStr(page.utc_offset, now);
}

/**
 * Mốc bắt đầu của lượt quét nhanh (giây Unix): lần quét trước lùi thêm một
 * khoảng chồng lấn cho khỏi sót. Không lùi quá 27 ngày — giới hạn một cửa sổ
 * của Pancake, và phần cũ hơn đã có lượt quét đầy đủ ban đêm lo.
 */
export function quickSinceSec(page: Page, now: Date = new Date()): number {
    const last = page.last_quick_synced_at ?? page.last_synced_at ?? new Date(now.getTime() - DAY_MS);
    const since = last.getTime() - config.sync.quickOverlapMin * 60_000;
    const floor = now.getTime() - 27 * DAY_MS;
    return Math.floor(Math.max(since, floor) / 1000);
}

export async function syncPage(
    page: Page,
    log: Logger,
    opts: { dryRun?: boolean; skipPlan?: boolean; mode?: SyncMode } = {}
): Promise<SyncStats> {
    const mode = opts.mode ?? "full";
    const stats: SyncStats = {
        mode,
        scanned: 0, windows: 0, hitCap: false,
        inserted: 0, rejoined: 0, updated: 0,
        optedOut: 0, convertedByTag: 0, convertedByPhone: 0,
        expiredOutOfWindow: 0, expiredJourneyDone: 0,
        planned: 0,
    };
    // Mốc ghi lại là lúc BẮT ĐẦU quét: hội thoại phát sinh trong lúc quét sẽ được lượt sau lấy
    const startedAt = new Date();

    // 1. Quét hội thoại từ Pancake
    const sinceSec = mode === "quick" ? quickSinceSec(page, startedAt) : undefined;
    log.info(
        sinceSec ? { since: new Date(sinceSec * 1000).toISOString() } : {},
        mode === "quick" ? "Quét nhanh hội thoại mới…" : "Bắt đầu quét đầy đủ hội thoại từ Pancake…"
    );
    const scan = await pancake.scanConversations(page.page_id, {
        sinceSec,
        onProgress: (found, window) => {
            if (window % 6 === 0) log.debug({ found, window }, "…đang quét");
        },
    });
    stats.scanned = scan.customers.length;
    stats.windows = scan.windowsScanned;
    stats.hitCap = scan.hitCap;
    log.info({ scanned: stats.scanned, windows: stats.windows, hitCap: stats.hitCap }, "Quét xong");

    if (opts.dryRun) {
        log.info({ ...stats, dryRun: true }, "Dry-run: không ghi gì");
        return stats;
    }

    // 2. Ghi vào tệp khách theo lô
    const CHUNK = 500;
    for (let i = 0; i < scan.customers.length; i += CHUNK) {
        const r = await customersRepo.upsertBatch(page.id, scan.customers.slice(i, i + CHUNK));
        stats.inserted += r.inserted;
        stats.rejoined += r.rejoined;
        stats.updated += r.updated;
        await customersRepo.recordEvents(page.id, r.insertedIds, "entered");
        await customersRepo.recordEvents(page.id, r.rejoinedIds, "restarted");
        // Khách quay lại mang theo mốc chuẩn POS của chuỗi TRƯỚC — xoá đi để lần
        // đối chiếu POS kế tiếp ghi lại theo số đơn hiện tại, nếu không họ sẽ
        // không bao giờ được tính là "vừa chốt" trong chuỗi mới này.
        await customersRepo.resetPosBaseline(r.rejoinedIds);
    }

    // 3. Danh sách chặn luôn thắng
    stats.optedOut = await customersRepo.enforceOptOuts(page.id);

    // 4. Tag mua hàng → converted, huỷ lượt còn chờ
    const converted = await customersRepo.convertByPurchaseTags(
        page.id,
        PURCHASE_TAGS.map((t) => `%${t.toLowerCase()}%`)
    );
    stats.convertedByTag = converted.length;
    for (const id of converted) {
        await queueRepo.cancelPendingForCustomer(id, "Khách đã mua (tag)");
    }
    await customersRepo.recordEvents(page.id, converted, "ordered", { via: "tag" });

    // 5. Khách để lại SĐT trong chuỗi này → converted, huỷ lượt còn chờ
    if (config.convert.onPhone) {
        const byPhone = await customersRepo.convertByPhone(page.id);
        stats.convertedByPhone = byPhone.length;
        for (const id of byPhone) {
            await queueRepo.cancelPendingForCustomer(id, "Khách để lại SĐT");
        }
        await customersRepo.recordEvents(page.id, byPhone, "ordered", { via: "phone" });
    }

    // 6. Tính lại ngày thứ N rồi loại khách hết hạn
    await customersRepo.recomputeJourneyDays(page.id, page.utc_offset);
    const expired = await customersRepo.expireCustomers(page.id, config.journey.windowDays, config.journey.days);
    stats.expiredOutOfWindow = expired.outOfWindow;
    stats.expiredJourneyDone = expired.journeyDone;

    if (mode === "full") await pagesRepo.markSynced(page.id, startedAt);
    else await pagesRepo.markQuickSynced(page.id, startedAt);

    const cs = await customersRepo.stats(page.id);
    log.info(
        {
            inserted: stats.inserted, rejoined: stats.rejoined, updated: stats.updated,
            convertedByTag: stats.convertedByTag, convertedByPhone: stats.convertedByPhone,
            optedOut: stats.optedOut,
            expired: stats.expiredOutOfWindow + stats.expiredJourneyDone,
            active: cs.active, total: cs.total, byDay: cs.byDay,
        },
        `Tệp khách: ${cs.active} active / ${cs.total} tổng`
    );

    // 7. Xếp hàng đợi hôm nay (chỉ khi page đang bật). Chạy lại nhiều lần trong
    //    ngày vẫn an toàn — UNIQUE bỏ qua lượt đã xếp, chỉ khách mới được thêm.
    if (!opts.skipPlan && page.is_active) {
        const p = await planPage(page, log.child({ job: "plan" }));
        stats.planned = p.enqueued;
    }

    return stats;
}

// ─── Chạy độc lập ─────────────────────────────────────────────────────────────
if (isMain(import.meta.url)) {
    runJob("sync", async (args, log) => {
        const now = new Date();

        // Thị trường có giờ mùa hè: chỉnh utc_offset trước khi tính "tới giờ chưa"
        for (const c of await pagesRepo.syncDstOffsets(now)) {
            log.info(c, `🕐 ${c.page_name} đổi giờ: UTC${c.from >= 0 ? "+" : ""}${c.from} → UTC${c.to >= 0 ? "+" : ""}${c.to}`);
        }

        let work: Array<{ page: Page; mode: SyncMode }>;
        if (args.page) {
            const p = await pagesRepo.findByFbPageId(args.page);
            if (!p) {
                log.error(`Không tìm thấy page ${args.page} — thêm bằng npm run page:add`);
                process.exitCode = 1;
                return;
            }
            work = [{ page: p, mode: "full" }]; // chỉ định page cụ thể = luôn quét đầy đủ, bất kể giờ
        } else {
            const active = await pagesRepo.listActive();
            work = active
                .map((page) => ({
                    page,
                    mode: (args.force || isDueForSync(page, now) ? "full" : "quick") as SyncMode,
                }))
                .filter((w) => w.mode === "full" || config.sync.quickEnabled);
            if (work.length === 0) {
                log.info({ activePages: active.length }, "Không có page nào cần đồng bộ");
                return;
            }
        }

        let ok = 0;
        for (const { page, mode } of work) {
            // pm2 khởi động lượt kế tiếp → làm xong page đang dở rồi dừng; page còn
            // lại vẫn "tới hạn" nên lượt sau sẽ làm tiếp
            if (shouldStop()) break;
            const plog = log.child({ pageId: page.page_id, page: page.page_name, mode, tz: `UTC${page.utc_offset >= 0 ? "+" : ""}${page.utc_offset}` });
            try {
                await withJobRun("sync", page.id, plog, () => syncPage(page, plog, { dryRun: args.dryRun, mode }));
                ok++;
            } catch {
                /* đã log trong withJobRun — sang page tiếp theo */
            }
        }
        log.info(
            { ok, total: work.length, full: work.filter((w) => w.mode === "full").length },
            "SYNC xong"
        );
    });
}
