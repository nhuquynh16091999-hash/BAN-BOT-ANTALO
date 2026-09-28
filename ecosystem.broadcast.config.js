// Cấu hình pm2 cho web broadcast (cổng 3001) — DỰ ÁN "Bắn bot AI", KHÔNG phải TALPHA.
// Chạy thẳng binary `next` (KHÔNG qua `npm start`) để tránh lỗi
// `EPERM uv_cwd` của npm khi pm2 resurrect lúc máy khởi động lại.
//
// 03/08/2026 (TALPHA F3): đổi tên app khỏi tiền tố `talpha-*` — trước đây
// `talpha-broadcast` / `talpha-cron` nằm chung namespace với app của dự án
// TALPHA (`talpha-dashboard`), lệnh kiểu `pm2 restart talpha-*` bắn nhầm sang
// đây. Nay app dự án này là `broadcast-*` (namespace pm2 `broadcast`), app
// TALPHA là `talpha-*` (namespace `talpha`).
const APP = '/Users/syanh/Desktop/Bắn bot AI/app';
const NODE = '/Users/syanh/.nvm/versions/node/v20.20.2/bin/node';

module.exports = {
  apps: [
    {
      name: 'broadcast-web',
      namespace: 'broadcast',
      script: './node_modules/next/dist/bin/next',
      args: 'start -p 3001',
      cwd: APP,
      interpreter: NODE,
      autorestart: true,
      max_restarts: 20,
      // Tên log cố định, không dính số id pm2 (đổi mỗi lần delete/start).
      out_file: '/Users/syanh/.pm2/logs/broadcast-web-out.log',
      error_file: '/Users/syanh/.pm2/logs/broadcast-web-error.log',
    },
    {
      // Cron runner gọi /api/broadcast/cron mỗi 15' — BẮN TIN THẬT ngay tick đầu.
      // Trước đây tên `talpha-cron` và đang ở trạng thái stopped. Chỉ start khi
      // thực sự muốn lịch broadcast chạy:
      //   pm2 start ecosystem.broadcast.config.js --only broadcast-cron
      name: 'broadcast-cron',
      namespace: 'broadcast',
      script: './cron-runner.mjs',
      cwd: APP,
      interpreter: NODE,
      autorestart: true,
      max_restarts: 20,
      out_file: '/Users/syanh/.pm2/logs/broadcast-cron-out.log',
      error_file: '/Users/syanh/.pm2/logs/broadcast-cron-error.log',
    },
  ],
};
