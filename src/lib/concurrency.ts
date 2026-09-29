/**
 * Chạy `fn` cho từng phần tử, tối đa `limit` việc cùng lúc.
 *
 * Việc nào xong thì worker lấy ngay việc kế tiếp — không chờ cả nhóm xong như
 * chia lô cố định, nên một page nhiều khách không giữ chân các page ít khách.
 * `shouldContinue` trả false thì không nhận việc mới nữa (việc đang chạy vẫn
 * chạy cho xong) — dùng cho hạn giờ của lượt chạy và tín hiệu dừng từ pm2.
 */
export async function forEachConcurrent<T>(
    items: readonly T[],
    limit: number,
    fn: (item: T) => Promise<void>,
    shouldContinue: () => boolean = () => true
): Promise<void> {
    let next = 0;
    const worker = async (): Promise<void> => {
        while (next < items.length && shouldContinue()) {
            const item = items[next++] as T;
            await fn(item);
        }
    };
    const workers = Math.min(Math.max(1, Math.floor(limit)), items.length);
    await Promise.all(Array.from({ length: workers }, () => worker()));
}
