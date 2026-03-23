import 'dotenv/config';
import cron from 'node-cron';
import { resetQuota, getQuotaUsed } from '../lib/youtube.js';

async function safeRun(jobName, fn) {
  const start = Date.now();
  try {
    console.log(`[scheduler] Starting: ${jobName}`);
    await fn();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[scheduler] Done: ${jobName} (${elapsed}s)`);
  } catch (err) {
    console.error(`[scheduler] FAILED: ${jobName} —`, err.message);
    // TODO: Telegram/email alert when configured
  }
}

async function weeklyRun() {
  console.log('='.repeat(60));
  console.log(`[scheduler] Weekly run starting — ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  resetQuota();

  // Phase 1: Collect data
  await safeRun('Own channel crawl', async () => {
    const { run } = await import('../collectors/own-channel.js');
    await run();
  });

  await safeRun('YouTube search', async () => {
    const { run } = await import('../collectors/youtube-search.js');
    const discovered = await run(); // Map<videoId, { searchTerm, region, language }>
    globalThis._discoveredVideos = discovered;
  });

  await safeRun('Video details', async () => {
    const { run } = await import('../collectors/video-details.js');
    const channelIds = await run(globalThis._discoveredVideos);
    globalThis._channelIds = channelIds;
  });

  await safeRun('Channel details', async () => {
    const { run } = await import('../collectors/channel-details.js');
    await run(globalThis._channelIds);
  });

  console.log(`[scheduler] Collection done. Quota used: ${getQuotaUsed()}`);

  // Phase 2: Score and analyze
  await safeRun('Outlier detection', async () => {
    const { run } = await import('../analyzers/outlier-detector.js');
    run();
  });

  await safeRun('View velocity', async () => {
    const { run } = await import('../analyzers/view-velocity.js');
    run();
  });

  await safeRun('Virality scoring', async () => {
    const { run } = await import('../analyzers/virality-scorer.js');
    run();
  });

  // Phase 3: Claude analysis (batched, costs money)
  await safeRun('Content categorization', async () => {
    const { run } = await import('../analyzers/content-categorizer.js');
    await run();
  });

  await safeRun('Thumbnail download', async () => {
    const { run } = await import('../collectors/thumbnail-downloader.js');
    await run();
  });

  await safeRun('Thumbnail analysis', async () => {
    const { run } = await import('../analyzers/thumbnail-analyzer.js');
    await run();
  });

  await safeRun('Similarity check', async () => {
    const { run } = await import('../analyzers/similarity-checker.js');
    await run();
  });

  // Phase 4: Output
  await safeRun('Google Sheet sync', async () => {
    const { run } = await import('../sheets/sync.js');
    await run();
  });

  await safeRun('Weekly digest', async () => {
    const { run } = await import('../reporters/weekly-digest.js');
    await run();
  });

  console.log('='.repeat(60));
  console.log(`[scheduler] Weekly run complete — ${new Date().toISOString()}`);
  console.log(`[scheduler] Total quota used: ${getQuotaUsed()}`);
  console.log('='.repeat(60));
}

async function dailyReminderCheck() {
  await safeRun('Reminder check', async () => {
    const { run } = await import('../reporters/reminder-sender.js');
    await run();
  });
}

// --- Cron schedules ---

// Weekly: Monday 5:00 AM
cron.schedule('0 5 * * 1', () => {
  weeklyRun().catch(err => {
    console.error('[scheduler] Weekly run crashed:', err);
  });
});

// Daily: 9:00 AM — check reminders
cron.schedule('0 9 * * *', () => {
  safeRun('Daily reminder check', async () => {
    const { run } = await import('../reporters/reminder-sender.js');
    await run();
  }).catch(err => {
    console.error('[scheduler] Daily reminder check crashed:', err);
  });
});

console.log('[scheduler] YT Trend Scout started');
console.log('[scheduler] Weekly run: Monday 5:00 AM');
console.log('[scheduler] Daily reminders: 9:00 AM');
console.log('[scheduler] Waiting for next scheduled run...');
