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

// Check if we've hit 10K videos → switch from daily seeding to weekly maintenance
async function dailySeed() {
  const { getDb } = await import('../db/database.js');
  const { seed } = await import('../collectors/youtube-search.js');
  const { run: fetchDetails } = await import('../collectors/video-details.js');
  const { run: fetchChannels } = await import('../collectors/channel-details.js');
  const { run: runOutlier } = await import('../analyzers/outlier-detector.js');
  const { run: runVelocity } = await import('../analyzers/view-velocity.js');
  const { run: runVirality } = await import('../analyzers/virality-scorer.js');

  const total = getDb().prepare('SELECT COUNT(*) as c FROM videos').get().c;
  console.log(`[scheduler] DB has ${total} videos`);

  if (total >= 10000) {
    console.log('[scheduler] 10K+ reached — skipping daily seed, weekly run handles it now');
    return;
  }

  console.log('[scheduler] Under 10K — running daily seed crawl');
  resetQuota();

  await safeRun('Daily seed', async () => {
    const discovered = await seed();
    if (discovered?.size) {
      const channelIds = await fetchDetails(discovered);
      await fetchChannels(channelIds);
    }
  });

  await safeRun('Score', () => { runOutlier(); runVelocity(); runVirality(); });

  await safeRun('Deploy to Vercel', async () => {
    await import('./deploy-static.js');
  });

  const newTotal = getDb().prepare('SELECT COUNT(*) as c FROM videos').get().c;
  console.log(`[scheduler] Daily seed done. ${total} → ${newTotal} videos | Quota: ${getQuotaUsed()}`);
}

// Daily: 5:00 AM — seed crawl (until 10K), then only weekly
cron.schedule('0 5 * * *', () => {
  dailySeed().catch(err => {
    console.error('[scheduler] Daily seed crashed:', err);
  });
});

// Weekly: Monday 7:00 AM — full analysis + sheet sync (runs after daily seed)
cron.schedule('0 7 * * 1', () => {
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

// --- Startup info ---
const { getDb: db2 } = await import('../db/database.js');
const startTotal = db2().prepare('SELECT COUNT(*) as c FROM videos').get().c;
console.log('[scheduler] YT Trend Scout started');
console.log(`[scheduler] DB: ${startTotal} videos (${startTotal >= 10000 ? 'seeding complete' : `seeding daily until 10K`})`);
console.log('[scheduler] Daily seed: 5:00 AM (auto-stops at 10K)');
console.log('[scheduler] Weekly full run: Monday 7:00 AM');
console.log('[scheduler] Daily reminders: 9:00 AM');
