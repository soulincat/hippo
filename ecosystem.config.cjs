module.exports = {
  apps: [{
    name: 'yt-trend-scout',
    script: 'workers/scheduler-worker.js',
    cwd: __dirname,
    cron_restart: '0 4 * * 1', // Fresh restart every Monday 4 AM
    autorestart: true,
    max_restarts: 10,
    env: {
      NODE_ENV: 'production',
    },
  }],
};
