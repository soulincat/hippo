module.exports = {
  apps: [{
    name: 'yt-trend-scout',
    script: 'workers/scheduler-worker.js',
    cwd: __dirname,
    cron_restart: '0 4 * * *', // Fresh restart daily at 4 AM (before 5 AM crawl)
    autorestart: true,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
