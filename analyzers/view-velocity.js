import 'dotenv/config';
import * as db from '../db/database.js';
import { VELOCITY_MULTIPLIERS } from '../lib/config.js';

/**
 * Calculate view velocity (views/day adjusted for recency) for all scored videos.
 */
export function run() {
  const videos = db.getDb().prepare(`
    SELECT v.id, v.views, v.published_at, s.id as score_id
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    WHERE s.view_velocity IS NULL
  `).all();

  if (!videos.length) {
    console.log('[velocity] No videos need velocity calculation');
    return;
  }

  console.log(`[velocity] Calculating velocity for ${videos.length} videos`);
  const now = Date.now();

  for (const v of videos) {
    const publishedMs = new Date(v.published_at).getTime();
    const hoursSincePublish = Math.max(1, (now - publishedMs) / (1000 * 60 * 60));
    const viewsPerDay = (v.views / hoursSincePublish) * 24;

    // Apply recency multiplier
    let multiplier = 0.4; // default for very old
    for (const tier of VELOCITY_MULTIPLIERS) {
      if (hoursSincePublish < tier.maxHours) {
        multiplier = tier.multiplier;
        break;
      }
    }

    const adjustedVelocity = Math.round(viewsPerDay * multiplier * 100) / 100;

    db.getDb().prepare(`
      UPDATE scores SET view_velocity = ? WHERE video_id = ?
    `).run(adjustedVelocity, v.id);
  }

  console.log(`[velocity] Done`);
}
