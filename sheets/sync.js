import 'dotenv/config';
import * as sheets from '../lib/sheets.js';
import * as db from '../db/database.js';
import { TOP_N_FOR_SHEET_SYNC } from '../lib/config.js';

/**
 * Format number as K/M for readability.
 */
function fmt(n) {
  if (!n || n === 0) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

/**
 * Sync top scored videos to Google Sheet.
 */
export async function run() {
  console.log('[sync] Syncing to Google Sheet...');

  await syncContentLibrary();
  await syncTrendingTopics();
  await syncThumbnailPatterns();
  await syncOwnContent();
  await syncReminders();

  console.log('[sync] Done');
}

/**
 * Full refresh of Content Library — clears and rewrites sorted by virality.
 */
export async function fullRefresh() {
  console.log('[sync] Full refresh of Content Library...');
  await sheets.clearRange("'Content Library'!A2:N");
  await syncContentLibrary(true);
  console.log('[sync] Full refresh done');
}

async function syncContentLibrary(forceAll = false) {
  let existingUrls = new Set();
  if (!forceAll) {
    existingUrls = await sheets.getExistingVideoUrls();
  }
  const videos = db.getTopScoredVideos(TOP_N_FOR_SHEET_SYNC);

  const now = Date.now();
  const newRows = [];

  for (const v of videos) {
    const url = `https://youtube.com/watch?v=${v.youtube_id}`;
    if (!forceAll && existingUrls.has(url)) continue;

    const thumbUrl = `https://img.youtube.com/vi/${v.youtube_id}/hqdefault.jpg`;

    // Days since published
    const publishedMs = new Date(v.published_at).getTime();
    const daysOld = Math.max(1, Math.round((now - publishedMs) / (1000 * 60 * 60 * 24)));

    // xChannel: how many times this video outperforms channel average
    const channelAvg = v.avg_views || 1;
    const xChannel = v.views / channelAvg;
    const xChannelStr = xChannel >= 100 ? Math.round(xChannel) + 'x' : xChannel.toFixed(1) + 'x';

    // Views per day
    const viewsPerDay = Math.round(v.views / daysOld);

    newRows.push([
      `=IMAGE("${thumbUrl}")`,           // A: Thumbnail
      v.title,                            // B: Title
      v.channel_name || '',               // C: Channel
      fmt(v.subscribers),                 // D: Subs (K/M)
      fmt(v.views),                       // E: Views (K/M)
      daysOld,                            // F: Days Old
      fmt(viewsPerDay),                   // G: Views/Day (K/M)
      xChannelStr,                        // H: xChannel
      Math.round(v.virality_score || 0),  // I: Viral Score
      url,                                // J: Video URL
      v.language || '',                   // K: Language
      'New',                              // L: Status
      '',                                 // M: Remind Date
      '',                                 // N: Notes
    ]);
  }

  if (newRows.length) {
    // Sort by viral score descending (col index 8)
    newRows.sort((a, b) => b[8] - a[8]);
    await sheets.appendRows('Content Library', newRows);
    console.log(`[sync] Added ${newRows.length} videos to Content Library`);
  } else {
    console.log('[sync] No new videos to add');
  }
}

async function syncTrendingTopics() {
  const today = new Date().toISOString().split('T')[0];
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const topics = db.getDb().prepare(`
    SELECT v.search_term,
           COUNT(*) as video_count,
           ROUND(AVG(s.virality_score), 1) as avg_virality,
           MAX(v.title) as top_title
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    WHERE v.discovered_at >= ? AND s.virality_score IS NOT NULL AND v.search_term IS NOT NULL
    GROUP BY v.search_term
    HAVING COUNT(*) >= 2
    ORDER BY avg_virality DESC
    LIMIT 10
  `).all(weekStart);

  if (!topics.length) return;

  const rows = topics.map(t => [
    today,
    t.search_term,
    t.video_count,
    t.avg_virality,
    t.top_title,
    t.avg_virality > 60 ? 'Hot' : t.avg_virality > 40 ? 'Rising' : 'Steady',
  ]);

  await sheets.appendRows('Trending Topics', rows);
  console.log(`[sync] Added ${rows.length} trending topics`);
}

async function syncThumbnailPatterns() {
  const patterns = db.getDb().prepare(`
    SELECT s.thumbnail_analysis
    FROM scores s
    WHERE s.thumbnail_analysis IS NOT NULL
    ORDER BY s.virality_score DESC
    LIMIT 100
  `).all();

  if (!patterns.length) return;

  // Aggregate formulas
  const formulaCounts = {};
  for (const p of patterns) {
    try {
      const analysis = JSON.parse(p.thumbnail_analysis);
      const formula = analysis.thumbnail_formula || 'unknown';
      if (!formulaCounts[formula]) {
        formulaCounts[formula] = { count: 0, effectivenessSum: 0, exampleUrl: '' };
      }
      formulaCounts[formula].count++;
      formulaCounts[formula].effectivenessSum += (analysis.effectiveness_score || 5);
    } catch {}
  }

  // Clear and rewrite (patterns are aggregated, not appended)
  await sheets.clearRange("'Thumbnail Patterns'!A2:E");

  const rows = Object.entries(formulaCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([formula, data]) => [
      formula,
      data.count,
      Math.round((data.effectivenessSum / data.count) * 10) / 10,
      '', // example URL (could be populated)
      '', // example thumbnail
    ]);

  if (rows.length) {
    await sheets.appendRows('Thumbnail Patterns', rows);
    console.log(`[sync] Updated ${rows.length} thumbnail patterns`);
  }
}

async function syncOwnContent() {
  // Check if Own Content tab is empty
  const existing = await sheets.readRange("'Own Content'!A2:A3");
  if (existing.length > 0) return; // Already populated

  const ownVideos = db.getAllOwnVideos();
  if (!ownVideos.length) return;

  const rows = ownVideos.map(v => [
    v.title,
    v.published_at?.split('T')[0] || '',
    v.views || 0,
    v.tags ? JSON.parse(v.tags).join(', ') : '',
  ]);

  await sheets.appendRows('Own Content', rows);
  console.log(`[sync] Added ${rows.length} own videos`);
}

async function syncReminders() {
  // Clear and rebuild from Content Library flags
  await sheets.clearRange("'Reminders'!A2:F");

  // Read Status and Remind Date from Content Library
  const data = await sheets.readRange("'Content Library'!A2:R");
  if (!data.length) return;

  const today = new Date();
  const reminderRows = [];

  for (const row of data) {
    const status = row[14]; // col O (0-indexed: 14)
    const remindDate = row[15]; // col P
    if (status !== 'Remind' || !remindDate) continue;

    const remindMs = new Date(remindDate).getTime();
    const daysUntil = Math.ceil((remindMs - today.getTime()) / (1000 * 60 * 60 * 24));

    reminderRows.push([
      row[2] || '',                                          // Title (col C)
      row[12] || '',                                         // Video URL (col M)
      remindDate,                                            // Remind Date
      daysUntil,                                             // Days Until
      row[16] || '',                                         // Notes (col Q)
      daysUntil <= 0 ? 'DUE NOW' : daysUntil <= 7 ? 'Soon' : 'Upcoming',
    ]);
  }

  if (reminderRows.length) {
    reminderRows.sort((a, b) => a[3] - b[3]); // Sort by days until
    await sheets.appendRows('Reminders', reminderRows);
    console.log(`[sync] ${reminderRows.length} reminders synced`);
  }
}
