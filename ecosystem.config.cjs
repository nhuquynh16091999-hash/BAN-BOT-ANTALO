/**
 * pm2 — một công cụ chạy cả 4 job, không cần crontab riêng.
 *
 *   npm run build            # biên dịch ra dist/ trước
 *   pm2 start ecosystem.config.cjs
 *   pm2 save && pm2 startup  # tự chạy lại khi VPS khởi động
 *
 * Job theo lịch dùng cron_restart + autorestart:false: pm2 khởi động tiến trình
 * đúng giờ, tiến trình chạy xong tự thoát, pm2 không kéo lại cho tới mốc sau.
 */
const cwd = __dirname;

module.exports = {
    apps: [
        {
            // Nhận webhook: chạy liên tục, sập thì kéo lại
            name: "banbot-webhook",
            script: "dist/jobs/webhook.js",
            cwd,
            autorestart: true,
            max_restarts: 50,
            restart_delay: 3000,
            env: { NODE_ENV: "production" },
        },
        {
            // Giao diện chính (Next.js, kế thừa từ v1): chạy liên tục
            name: "banbot-ui",
            script: "node_modules/next/dist/bin/next",
            args: "start -p 3112 -H 127.0.0.1",   // chỉ nghe localhost — nginx là cửa duy nhất
            cwd: `${cwd}/web`,
            autorestart: true,
            max_restarts: 50,
            restart_delay: 3000,
            env: { NODE_ENV: "production" },
        },
        {
            // Dashboard chỉ đọc: chạy liên tục
            name: "banbot-web",
            script: "dist/web/server.js",
            cwd,
            autorestart: true,
            max_restarts: 50,
            restart_delay: 3000,
            env: { NODE_ENV: "production" },
        },
        {
            // Gửi: mỗi 5 phút một lượt, mỗi lượt tự giới hạn 4,5 phút
            name: "banbot-send",
            script: "dist/jobs/send.js",
            cwd,
            autorestart: false,
            cron_restart: "* * * * *",
            env: { NODE_ENV: "production" },
        },
        {
            // Đồng bộ tệp khách: mỗi 15 phút. Page tới 3h sáng giờ địa phương → quét
            // đầy đủ; page khác → quét nhanh hội thoại mới để khách vừa nhắn vào chuỗi ngay.
            // kill_timeout: lượt sau tới mà lượt này còn quét đầy đủ dở thì cho 10 phút
            // làm xong page đang dở (job tự dừng giữa các page, page còn lại để lượt sau).
            name: "banbot-sync",
            script: "dist/jobs/sync.js",
            cwd,
            autorestart: false,
            cron_restart: "5,20,35,50 * * * *",
            kill_timeout: 600000,
            env: { NODE_ENV: "production" },
        },
        {
            // Đối chiếu đơn POS: mỗi 15 phút, lệch pha với health cho đỡ dồn tải
            name: "banbot-pos",
            script: "dist/jobs/pos.js",
            cwd,
            autorestart: false,
            cron_restart: "8,23,38,53 * * * *",
            env: { NODE_ENV: "production" },
        },
        {
            // Giám sát sức khoẻ page: mỗi 15 phút
            name: "banbot-health",
            script: "dist/jobs/health.js",
            cwd,
            autorestart: false,
            cron_restart: "2,17,32,47 * * * *",
            env: { NODE_ENV: "production" },
        },
    ],
};
