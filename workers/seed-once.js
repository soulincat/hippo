/**
 * Seed run: crawl a big batch of data, score it, push to sheet.
 * Run this daily for a few days to build up the initial library.
 * Each run avoids re-crawling combos from the last 3 days.
 */
import 'dotenv/config';
import { resetQuota, getQuotaUsed } from '../lib/youtube.js';

async function safeRun(name, fn) {
  const start = Date.now();
  try {
    console.log(`\n> ${name}`);
    await fn();
    console.log(`  Done (${((Date.now() - start) / 1000).toFixed(1)}s)`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
  }
}

async function main() {
  console.log('=== YT TREND SCOUT — SEED RUN ===');
  console.log(`Started: ${new Date().toISOString()}\n`);
  resetQuota();

  // Crawl
  let discovered;
  await safeRun('Seed crawl (multi-window)', async () => {
    const { seed } = await import('../collectors/youtube-search.js');
    discovered = await seed(); // Map<videoId, { searchTerm, region, language }>
  });

  if (!discovered?.size) {
    console.log('\nNo new videos found. Try again tomorrow (quota resets daily).');
    return;
  }

  // Fetch details
  let channelIds;
  await safeRun('Video details', async () => {
    const { run } = await import('../collectors/video-details.js');
    channelIds = await run(discovered);
  });

  await safeRun('Channel details', async () => {
    const { run } = await import('../collectors/channel-details.js');
    await run(channelIds);
  });

  console.log(`\nCollection quota: ${getQuotaUsed()}`);

  // Score
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

  // Sync to sheet (full refresh — replaces all rows sorted by score)
  await safeRun('Sheet sync', async () => {
    const { fullRefresh } = await import('../sheets/sync.js');
    await fullRefresh();
  });

  // Stats
  const db = (await import('../db/database.js'));
  const total = db.getDb().prepare('SELECT COUNT(*) as c FROM videos').get().c;
  const scored = db.getDb().prepare('SELECT COUNT(*) as c FROM scores WHERE virality_score IS NOT NULL').get().c;

  console.log(`\n=== SEED COMPLETE ===`);
  console.log(`Quota used: ${getQuotaUsed()}`);
  console.log(`DB total: ${total} videos | ${scored} scored`);
  console.log(`Sheet: top 500 by viral score`);
  console.log(`Run again tomorrow to keep building the library.`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
