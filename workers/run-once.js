/**
 * Run the full pipeline once (for manual testing or first run).
 * Same as what the weekly cron does.
 */
import 'dotenv/config';
import { resetQuota, getQuotaUsed } from '../lib/youtube.js';

async function safeRun(jobName, fn) {
  const start = Date.now();
  try {
    console.log(`\n> ${jobName}`);
    await fn();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`  Done (${elapsed}s)`);
  } catch (err) {
    console.error(`  FAILED: ${err.message}`);
  }
}

async function main() {
  console.log('=== YT TREND SCOUT — FULL RUN ===');
  console.log(`Started: ${new Date().toISOString()}\n`);
  resetQuota();

  // Collect
  await safeRun('Own channel crawl', async () => {
    const { run } = await import('../collectors/own-channel.js');
    await run();
  });

  let discovered;
  await safeRun('YouTube search', async () => {
    const { run } = await import('../collectors/youtube-search.js');
    discovered = await run(); // Map<videoId, { searchTerm, region, language }>
  });

  let channelIds;
  await safeRun('Video details', async () => {
    const { run } = await import('../collectors/video-details.js');
    channelIds = await run(discovered);
  });

  await safeRun('Channel details', async () => {
    const { run } = await import('../collectors/channel-details.js');
    await run(channelIds);
  });

  console.log(`\nCollection quota used: ${getQuotaUsed()}`);

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

  // Claude analysis
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

  // Output
  await safeRun('Google Sheet sync', async () => {
    const { run } = await import('../sheets/sync.js');
    await run();
  });

  await safeRun('Weekly digest', async () => {
    const { run } = await import('../reporters/weekly-digest.js');
    await run();
  });

  console.log(`\n=== COMPLETE ===`);
  console.log(`Total quota used: ${getQuotaUsed()}`);
  console.log(`Finished: ${new Date().toISOString()}`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
