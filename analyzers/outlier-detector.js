import 'dotenv/config';
import * as db from '../db/database.js';
import { MIN_VIEWS_FOR_OUTLIER, MIN_OUTLIER_RATIO, SMALL_CHANNEL_THRESHOLD, SMALL_CHANNEL_BONUS } from '../lib/config.js';

/**
 * Calculate outlier scores for all unscored videos.
 * Outlier = video performing way above its channel's average.
 */
export function run() {
  const videos = db.getUnscoredVideos();

  if (!videos.length) {
    console.log('[outlier] No unscored videos');
    return;
  }

  console.log(`[outlier] Scoring ${videos.length} videos`);
  let outliers = 0;

  for (const v of videos) {
    if (v.views < MIN_VIEWS_FOR_OUTLIER) {
      // Still create a score row with low outlier
      db.upsertScore({
        video_id: v.id,
        outlier_score: 0,
        view_velocity: null,
        virality_score: null,
        content_type: null,
        freshness_window: null,
        thumbnail_analysis: null,
        categorization_notes: null,
      });
      continue;
    }

    const subs = v.subscribers || 1;
    const avgViews = v.avg_views || 1;

    const subscriberRatio = v.views / subs;
    const avgRatio = v.views / avgViews;

    let outlierScore = (subscriberRatio * 0.4) + (avgRatio * 0.6);

    // Bonus for small channels — format/topic carried the performance
    if (subs < SMALL_CHANNEL_THRESHOLD) {
      outlierScore *= SMALL_CHANNEL_BONUS;
    }

    if (outlierScore >= MIN_OUTLIER_RATIO) outliers++;

    db.upsertScore({
      video_id: v.id,
      outlier_score: Math.round(outlierScore * 100) / 100,
      view_velocity: null,
      virality_score: null,
      content_type: null,
      freshness_window: null,
      thumbnail_analysis: null,
      categorization_notes: null,
    });
  }

  console.log(`[outlier] Done. ${outliers}/${videos.length} qualify as outliers (>= ${MIN_OUTLIER_RATIO}x)`);
}
