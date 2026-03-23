import 'dotenv/config';
import * as db from '../db/database.js';

/**
 * Percentile rank within an array (0-100).
 */
function percentileRank(values, value) {
  const below = values.filter(v => v < value).length;
  return (below / Math.max(1, values.length - 1)) * 100;
}

/**
 * Calculate composite virality score (0-100) for all scored videos.
 */
export function run() {
  const videos = db.getDb().prepare(`
    SELECT v.id, v.title, v.views, v.likes, v.comments, v.search_term,
           s.outlier_score, s.view_velocity
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    WHERE s.outlier_score IS NOT NULL AND s.view_velocity IS NOT NULL
  `).all();

  if (!videos.length) {
    console.log('[virality] No videos ready for scoring');
    return;
  }

  console.log(`[virality] Scoring ${videos.length} videos`);

  // Collect all values for percentile ranking
  const outlierValues = videos.map(v => v.outlier_score);
  const velocityValues = videos.map(v => v.view_velocity);

  for (const v of videos) {
    // Engagement ratio (likes + comments) / views
    const engagement = v.views > 0 ? (v.likes + v.comments) / v.views : 0;
    const engagementScore = Math.min(100, engagement * 1000); // Scale up, cap at 100

    // Percentile-based scoring
    const outlierPct = percentileRank(outlierValues, v.outlier_score);
    const velocityPct = percentileRank(velocityValues, v.view_velocity);

    // Topic history bonus: check if similar titles scored well before
    let topicBonus = 0;
    if (v.search_term) {
      const historicalAvg = db.getDb().prepare(`
        SELECT AVG(s2.virality_score) as avg_score
        FROM videos v2
        JOIN scores s2 ON s2.video_id = v2.id
        WHERE v2.search_term = ? AND s2.virality_score IS NOT NULL AND v2.id != ?
      `).get(v.search_term, v.id);

      if (historicalAvg?.avg_score) {
        topicBonus = Math.min(100, historicalAvg.avg_score);
      }
    }

    // Composite: outlier(35%) + velocity(35%) + engagement(15%) + topic(15%)
    const viralityScore = Math.round(
      (outlierPct * 0.35) +
      (velocityPct * 0.35) +
      (engagementScore * 0.15) +
      (topicBonus * 0.15)
    );

    db.getDb().prepare(`
      UPDATE scores SET virality_score = ? WHERE video_id = ?
    `).run(Math.min(100, Math.max(0, viralityScore)), v.id);
  }

  // Log top 5
  const top = db.getTopScoredVideos(5);
  console.log('[virality] Top 5:');
  for (const t of top) {
    console.log(`  ${t.virality_score}/100 | ${t.views.toLocaleString()} views | ${t.title.slice(0, 60)}`);
  }
}
