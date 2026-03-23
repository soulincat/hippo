import 'dotenv/config';
import * as yt from '../lib/youtube.js';
import * as db from '../db/database.js';
import { SEARCH_TERMS, REGIONS } from '../lib/config.js';

const DELAY_MS = 600;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Get search combos that haven't been crawled recently.
 * Returns only combos not crawled in the last `skipDays` days.
 */
function getUnvisitedCombos(terms, regions, skipDays = 7) {
  const combos = [];
  for (const term of terms) {
    for (const region of regions) {
      const lastRun = db.getLastRunDate(term, region.code);
      if (lastRun) {
        const daysSince = (Date.now() - new Date(lastRun).getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < skipDays) continue; // Already crawled this week
      }
      combos.push({ term, region });
    }
  }
  return combos;
}

/**
 * Smart crawl: prioritize finding outliers from small channels.
 *
 * Strategy:
 * 1. Only crawl term+region combos not visited in last 7 days (no overlap)
 * 2. For each combo, search by viewCount (last 7d) to find fast risers
 * 3. Also search by relevance (last 30d) to catch mid-tail content
 * 4. Budget-aware: stops when approaching quota limit
 *
 * The REAL outlier filtering happens in the analyzers — we just need
 * diverse raw data here. The key is not re-crawling the same combos.
 */
export async function run() {
  const combos = getUnvisitedCombos(SEARCH_TERMS, REGIONS);
  const today = new Date().toISOString().split('T')[0];
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const existingIds = new Set(db.getRecentVideoIds(60));
  const discovered = new Map(); // videoId -> { searchTerm, region, language }

  console.log(`[search] ${combos.length} unvisited combos (of ${SEARCH_TERMS.length * REGIONS.length} total)`);

  // Budget: leave room for video+channel detail calls later
  // Each combo = 2 search calls = 200 units
  const maxCombos = Math.min(combos.length, 35); // 35 combos * 200 = 7000 units

  for (let i = 0; i < maxCombos; i++) {
    const { term, region } = combos[i];
    try {
      // Pass 1: Last 7 days, medium length (4-20min), sorted by viewCount
      const recentMedium = await yt.search(term, {
        regionCode: region.code,
        language: region.language,
        order: 'viewCount',
        publishedAfter: sevenDaysAgo,
        videoDuration: 'medium',
        maxResults: 50,
      });
      await sleep(DELAY_MS);

      // Pass 2: Last 30 days, long videos (20+min), sorted by viewCount
      const recentLong = await yt.search(term, {
        regionCode: region.code,
        language: region.language,
        order: 'viewCount',
        publishedAfter: thirtyDaysAgo,
        videoDuration: 'long',
        maxResults: 25,
      });
      await sleep(DELAY_MS);

      const allResults = [...recentMedium, ...recentLong];
      let newCount = 0;

      for (const v of allResults) {
        if (!v.videoId || existingIds.has(v.videoId) || discovered.has(v.videoId)) continue;
        discovered.set(v.videoId, { searchTerm: term, region: region.code, language: region.language });
        newCount++;
      }

      db.logSearchRun({
        run_date: today,
        search_term: term,
        region: region.code,
        results_count: newCount,
        quota_used: 200,
      });

      console.log(`[search] "${term}" / ${region.code}: ${newCount} new (${discovered.size} total)`);
    } catch (err) {
      if (err.message.includes('Quota limit')) {
        console.log('[search] Quota limit reached, stopping');
        break;
      }
      console.error(`[search] Error "${term}" / ${region.code}:`, err.message);
    }
  }

  console.log(`[search] Done. ${discovered.size} new video IDs | Quota: ${yt.getQuotaUsed()}`);
  return discovered; // Map<videoId, { searchTerm, region, language }>
}

/**
 * Seed run: crawl MORE data for initial database population.
 * Spreads across multiple time windows to maximize coverage.
 * Call this multiple days in a row to build up the library.
 */
export async function seed() {
  const combos = getUnvisitedCombos(SEARCH_TERMS, REGIONS, 3); // 3-day overlap window
  const today = new Date().toISOString().split('T')[0];
  const existingIds = new Set(db.getRecentVideoIds(90));
  const discovered = new Map(); // videoId -> { searchTerm, region, language }

  // Time windows to search: recent first (most valuable)
  const windows = [
    { label: '7d', after: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
    { label: '30d', after: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
    { label: '90d', after: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString() },
  ];

  console.log(`[seed] ${combos.length} combos to crawl`);

  // 2 calls per window (medium + long) * 3 windows = 6 calls per combo * 100 units = 600/combo
  // Cap at ~13 combos = 7800 units
  const maxCombos = Math.min(combos.length, 13);

  for (let i = 0; i < maxCombos; i++) {
    const { term, region } = combos[i];
    for (const window of windows) {
      try {
        // Medium-length videos (4-20 min) — primary long-form
        const medium = await yt.search(term, {
          regionCode: region.code,
          language: region.language,
          order: 'viewCount',
          publishedAfter: window.after,
          videoDuration: 'medium',
          maxResults: 50,
        });
        await sleep(DELAY_MS);

        // Long videos (20+ min) — deep-dive content
        const long = await yt.search(term, {
          regionCode: region.code,
          language: region.language,
          order: 'viewCount',
          publishedAfter: window.after,
          videoDuration: 'long',
          maxResults: 25,
        });
        await sleep(DELAY_MS);

        for (const v of [...medium, ...long]) {
          if (!v.videoId || existingIds.has(v.videoId) || discovered.has(v.videoId)) continue;
          discovered.set(v.videoId, { searchTerm: term, region: region.code, language: region.language });
        }
      } catch (err) {
        if (err.message.includes('Quota limit')) {
          console.log(`[seed] Quota limit at combo ${i}, window ${window.label}`);
          db.logSearchRun({ run_date: today, search_term: term, region: region.code, results_count: discovered.size, quota_used: yt.getQuotaUsed() });
          console.log(`[seed] Returning ${discovered.size} IDs (quota capped)`);
          return discovered;
        }
        console.error(`[seed] Error:`, err.message);
      }
    }

    db.logSearchRun({
      run_date: today,
      search_term: term,
      region: region.code,
      results_count: discovered.size,
      quota_used: 600, // 3 windows * 2 calls each
    });

    console.log(`[seed] "${term}" / ${region.code}: ${discovered.size} total new`);
  }

  console.log(`[seed] Done. ${discovered.size} new IDs | Quota: ${yt.getQuotaUsed()}`);
  return discovered; // Map<videoId, { searchTerm, region, language }>
}
