import 'dotenv/config';
import * as db from '../db/database.js';
import { analyzeJson } from '../lib/claude.js';
import { TOP_N_FOR_CATEGORIZATION } from '../lib/config.js';

/**
 * Use Claude to categorize top videos as evergreen vs trendy.
 * Batches 10-15 videos per Claude call to save tokens.
 */
export async function run() {
  const videos = db.getUncategorizedVideos(TOP_N_FOR_CATEGORIZATION);

  if (!videos.length) {
    console.log('[categorizer] No videos to categorize');
    return;
  }

  console.log(`[categorizer] Categorizing ${videos.length} videos`);
  const BATCH = 12;

  for (let i = 0; i < videos.length; i += BATCH) {
    const batch = videos.slice(i, i + BATCH);
    const videoList = batch.map((v, idx) => ({
      idx,
      youtube_id: v.youtube_id,
      title: v.title,
      description: (v.description || '').slice(0, 300),
      published_at: v.published_at,
      views: v.views,
      velocity: v.view_velocity,
    }));

    try {
      const result = await analyzeJson(`You are analyzing YouTube videos in the personal finance niche.

Classify each video as "evergreen" or "trendy" based on its title and description.

**Evergreen**: Timeless topics that always work — budgeting basics, investing fundamentals, savings tips, general money advice.
**Trendy**: Time-sensitive topics tied to current events — market crashes, specific policy changes, crypto hype cycles, recession fears.

For trendy topics, assign a freshness_window:
- "expired": the trend has already passed, topic is stale
- "1_week": must act within a week to ride the wave
- "1_month": usable within the next month
- "3_months": will stay relevant for a few months
- "6_months": longer-term trend, can wait

For evergreen topics, set freshness_window to "anytime".

Videos to classify:
${JSON.stringify(videoList, null, 2)}

Return a JSON array with one object per video:
[{ "youtube_id": "...", "content_type": "evergreen"|"trendy", "freshness_window": "...", "reasoning": "one sentence why" }]`);

      for (const item of result) {
        const video = batch.find(v => v.youtube_id === item.youtube_id);
        if (!video) continue;

        db.getDb().prepare(`
          UPDATE scores SET content_type = ?, freshness_window = ?, categorization_notes = ?
          WHERE video_id = ?
        `).run(item.content_type, item.freshness_window, item.reasoning, video.id);
      }

      console.log(`[categorizer] Batch ${Math.floor(i / BATCH) + 1}: ${batch.length} categorized`);
    } catch (err) {
      console.error(`[categorizer] Batch error:`, err.message);
    }
  }

  console.log('[categorizer] Done');
}
