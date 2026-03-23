import 'dotenv/config';
import * as db from '../db/database.js';

/**
 * Generate weekly digest report and save to DB.
 */
export async function run() {
  console.log('[digest] Generating weekly report...');
  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Top viral opportunities
  const topViral = db.getDb().prepare(`
    SELECT v.title, v.views, v.youtube_id, s.virality_score, s.outlier_score,
           s.content_type, s.freshness_window, s.view_velocity,
           c.name as channel_name, c.subscribers
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    LEFT JOIN channels c ON v.channel_id = c.id
    WHERE v.discovered_at >= ?
    ORDER BY s.virality_score DESC
    LIMIT 10
  `).all(weekStart);

  // Fastest risers
  const fastRisers = db.getDb().prepare(`
    SELECT v.title, v.views, v.youtube_id, s.view_velocity, s.virality_score,
           c.name as channel_name, c.subscribers
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    LEFT JOIN channels c ON v.channel_id = c.id
    WHERE v.discovered_at >= ?
    ORDER BY s.view_velocity DESC
    LIMIT 5
  `).all(weekStart);

  // Small channel breakouts
  const breakouts = db.getDb().prepare(`
    SELECT v.title, v.views, v.youtube_id, s.outlier_score, s.virality_score,
           c.name as channel_name, c.subscribers
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    JOIN channels c ON v.channel_id = c.id
    WHERE v.discovered_at >= ? AND c.subscribers < 50000
    ORDER BY s.outlier_score DESC
    LIMIT 5
  `).all(weekStart);

  // Trending topics
  const topics = db.getDb().prepare(`
    SELECT v.search_term, COUNT(*) as count, ROUND(AVG(s.virality_score), 1) as avg_score
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    WHERE v.discovered_at >= ? AND v.search_term IS NOT NULL
    GROUP BY v.search_term
    ORDER BY avg_score DESC
    LIMIT 8
  `).all(weekStart);

  // Thumbnail patterns
  const thumbPatterns = {};
  const thumbRows = db.getDb().prepare(`
    SELECT s.thumbnail_analysis FROM scores s
    JOIN videos v ON s.video_id = v.id
    WHERE v.discovered_at >= ? AND s.thumbnail_analysis IS NOT NULL
  `).all(weekStart);

  for (const row of thumbRows) {
    try {
      const a = JSON.parse(row.thumbnail_analysis);
      const formula = a.thumbnail_formula || 'unknown';
      thumbPatterns[formula] = (thumbPatterns[formula] || 0) + 1;
    } catch {}
  }

  // Stats
  const stats = db.getDb().prepare(`
    SELECT COUNT(*) as total,
           COUNT(CASE WHEN s.virality_score >= 70 THEN 1 END) as high_viral,
           COUNT(CASE WHEN s.content_type = 'evergreen' THEN 1 END) as evergreen,
           COUNT(CASE WHEN s.content_type = 'trendy' THEN 1 END) as trendy
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    WHERE v.discovered_at >= ?
  `).get(weekStart);

  // Build report
  const report = {
    generated_at: new Date().toISOString(),
    week_start: weekStart,
    stats,
    top_viral: topViral,
    fast_risers: fastRisers,
    small_channel_breakouts: breakouts,
    trending_topics: topics,
    thumbnail_patterns: Object.entries(thumbPatterns)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([formula, count]) => ({ formula, count })),
  };

  // Generate text summary
  const summary = formatSummary(report);

  // Save to DB
  db.saveReport({
    run_date: new Date().toISOString().split('T')[0],
    report_json: JSON.stringify(report),
    summary,
  });

  console.log('[digest] Report saved.');
  console.log(summary);
}

function formatSummary(report) {
  const lines = [];
  lines.push(`=== YT TREND SCOUT — WEEKLY DIGEST ===`);
  lines.push(`Week: ${report.week_start.split('T')[0]} — ${new Date().toISOString().split('T')[0]}`);
  lines.push(`Videos analyzed: ${report.stats.total} | High viral (70+): ${report.stats.high_viral} | Evergreen: ${report.stats.evergreen} | Trendy: ${report.stats.trendy}`);
  lines.push('');

  if (report.top_viral.length) {
    lines.push('--- TOP VIRAL OPPORTUNITIES ---');
    for (const v of report.top_viral.slice(0, 5)) {
      lines.push(`  [${v.virality_score}/100] ${v.title.slice(0, 70)}`);
      lines.push(`    ${v.views?.toLocaleString()} views | ${v.channel_name} (${v.subscribers?.toLocaleString()} subs) | ${v.content_type || '?'}`);
      lines.push(`    https://youtube.com/watch?v=${v.youtube_id}`);
    }
    lines.push('');
  }

  if (report.fast_risers.length) {
    lines.push('--- FASTEST RISERS ---');
    for (const v of report.fast_risers) {
      lines.push(`  ${Math.round(v.view_velocity).toLocaleString()} views/day | ${v.title.slice(0, 60)}`);
    }
    lines.push('');
  }

  if (report.small_channel_breakouts.length) {
    lines.push('--- SMALL CHANNEL BREAKOUTS (<50K subs) ---');
    for (const v of report.small_channel_breakouts) {
      lines.push(`  ${v.outlier_score?.toFixed(1)}x outlier | ${v.channel_name} (${v.subscribers?.toLocaleString()} subs)`);
      lines.push(`    ${v.title.slice(0, 70)}`);
    }
    lines.push('');
  }

  if (report.trending_topics.length) {
    lines.push('--- TRENDING TOPICS ---');
    for (const t of report.trending_topics) {
      lines.push(`  "${t.search_term}" — ${t.count} videos, avg virality: ${t.avg_score}`);
    }
    lines.push('');
  }

  if (report.thumbnail_patterns.length) {
    lines.push('--- THUMBNAIL PATTERNS ---');
    for (const p of report.thumbnail_patterns.slice(0, 5)) {
      lines.push(`  ${p.formula}: ${p.count} videos`);
    }
  }

  return lines.join('\n');
}

/**
 * Print the most recent report to console.
 */
export function printLatest() {
  const report = db.getLatestReport();
  if (!report) {
    console.log('No reports yet. Run `npm run full-run` first.');
    return;
  }
  console.log(report.summary);
}
