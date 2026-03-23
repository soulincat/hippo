/**
 * Export SQLite data to static JSON files for Vercel deployment.
 * Run: npm run build-static
 *
 * The local dashboard (npm run dashboard) keeps full interactivity.
 * The Vercel deployment is a read-only snapshot anyone can view.
 */
import 'dotenv/config';
import { writeFileSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as db from '../db/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, '..', 'public');
const API = join(PUBLIC, 'api');

function fmt(n) {
  if (!n) return '0';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

function write(file, data) {
  writeFileSync(join(API, file), JSON.stringify(data));
  console.log(`  ${file} (${JSON.stringify(data).length} bytes)`);
}

async function main() {
  console.log('Building static export for Vercel...\n');
  const d = db.getDb();

  // Ensure columns exist
  try { d.exec("ALTER TABLE videos ADD COLUMN duration_seconds INTEGER DEFAULT 0"); } catch(e) {}
  try { d.exec("ALTER TABLE videos ADD COLUMN is_short INTEGER DEFAULT 0"); } catch(e) {}

  // --- Stats ---
  for (const fmt of ['long', 'short', 'all']) {
    const durWhere = fmt === 'short' ? '(v.is_short = 1)' : fmt === 'long' ? '(v.is_short = 0)' : '1=1';
    const stats = d.prepare(`
      SELECT
        (SELECT COUNT(*) FROM videos v WHERE ${durWhere}) as total_videos,
        (SELECT COUNT(*) FROM channels) as total_channels,
        (SELECT COUNT(*) FROM videos v JOIN scores s ON s.video_id=v.id WHERE s.virality_score >= 70 AND ${durWhere}) as high_viral,
        (SELECT COUNT(*) FROM videos v JOIN scores s ON s.video_id=v.id LEFT JOIN channels c ON v.channel_id=c.id WHERE s.outlier_score >= 10 AND c.subscribers > 0 AND ${durWhere}) as big_outliers,
        (SELECT ROUND(AVG(s.virality_score),1) FROM videos v JOIN scores s ON s.video_id=v.id WHERE s.virality_score IS NOT NULL AND ${durWhere}) as avg_score,
        (SELECT MAX(s.virality_score) FROM videos v JOIN scores s ON s.video_id=v.id WHERE ${durWhere}) as top_score,
        (SELECT MAX(discovered_at) FROM videos) as last_crawled,
        (SELECT COUNT(DISTINCT language) FROM videos WHERE language IS NOT NULL AND language != '') as languages_covered,
        0 as saved_count, 0 as fav_count,
        (SELECT COUNT(*) FROM videos v WHERE v.is_short = 0) as longform_count,
        (SELECT COUNT(*) FROM videos v WHERE v.is_short = 1) as shorts_count,
        (SELECT COUNT(*) FROM channels WHERE subscribers > 0) as channels_with_subs,
        (SELECT COUNT(*) FROM channels WHERE subscribers = 0) as channels_missing_subs
    `).get();
    const regions = d.prepare("SELECT DISTINCT region FROM search_runs WHERE region IS NOT NULL").all();
    stats.regions = regions.map(r => r.region).filter(Boolean);
    write(`stats-${fmt}.json`, stats);
  }

  // --- Topics ---
  for (const fmt of ['long', 'short', 'all']) {
    const durWhere = fmt === 'short' ? '(v.is_short = 1)' : fmt === 'long' ? '(v.is_short = 0)' : '1=1';
    const keywords = ['budget','invest','passive income','save money','credit card','debt',
      'side hustle','financial independence','retirement','real estate','stock market','crypto',
      'money management','wealth','tax','ETF','index fund','frugal','emergency fund','mortgage'];

    const topics = [];
    for (const kw of keywords) {
      const row = d.prepare(
        `SELECT COUNT(*) as cnt, ROUND(AVG(s.virality_score),1) as avg_v, MAX(s.virality_score) as max_v,
                ROUND(AVG(v.views),0) as avg_views, SUM(v.views) as total_views
         FROM videos v JOIN scores s ON s.video_id=v.id
         WHERE LOWER(v.title) LIKE ? AND s.virality_score IS NOT NULL AND ${durWhere}`
      ).get(`%${kw.toLowerCase()}%`);
      if (row.cnt > 0) {
        const top = d.prepare(
          `SELECT v.youtube_id, v.title, v.views, s.virality_score, c.name as channel_name, c.subscribers
           FROM videos v JOIN scores s ON s.video_id=v.id LEFT JOIN channels c ON v.channel_id=c.id
           WHERE LOWER(v.title) LIKE ? AND s.virality_score IS NOT NULL AND ${durWhere}
           ORDER BY s.virality_score DESC LIMIT 1`
        ).get(`%${kw.toLowerCase()}%`);
        const ownCount = d.prepare(
          `SELECT COUNT(*) as cnt, ROUND(AVG(views),0) as avg_views FROM own_videos WHERE LOWER(title) LIKE ?`
        ).get(`%${kw.toLowerCase()}%`);
        topics.push({
          topic: kw, count: row.cnt, avg_score: row.avg_v, max_score: row.max_v,
          avg_views: row.avg_views, total_views: row.total_views, top_video: top,
          heat: row.avg_v >= 50 ? 'hot' : row.avg_v >= 35 ? 'warm' : 'steady',
          own_count: ownCount.cnt || 0, own_avg_views: ownCount.avg_views || 0,
          opportunity: (ownCount.cnt === 0 && row.avg_v >= 40) ? 'untapped'
            : (ownCount.cnt <= 2 && row.avg_v >= 35) ? 'underexplored'
            : (ownCount.cnt >= 5) ? 'well-covered' : 'normal',
        });
      }
    }
    topics.sort((a, b) => b.avg_score - a.avg_score);
    write(`topics-${fmt}.json`, topics);
  }

  // --- Videos (multiple views) ---
  const sorts = { virality: 's.virality_score DESC', outlier: 's.outlier_score DESC', velocity: 's.view_velocity DESC', views: 'v.views DESC', newest: 'v.published_at DESC' };

  for (const fmt of ['long', 'short', 'all']) {
    const durWhere = fmt === 'short' ? '(v.is_short = 1)' : fmt === 'long' ? '(v.is_short = 0)' : '1=1';

    for (const [sortKey, orderBy] of Object.entries(sorts)) {
      const rows = d.prepare(`
        SELECT v.youtube_id, v.title, v.views, v.likes, v.comments,
               v.published_at, v.language, v.duration,
               c.name as channel_name, c.subscribers, c.avg_views,
               s.virality_score, s.outlier_score, s.view_velocity
        FROM videos v
        JOIN scores s ON s.video_id = v.id
        LEFT JOIN channels c ON v.channel_id = c.id
        WHERE s.virality_score IS NOT NULL AND ${durWhere}
        ORDER BY ${orderBy}
        LIMIT 200
      `).all();

      write(`videos-${fmt}-${sortKey}.json`, { videos: rows, total: rows.length, limit: 200, offset: 0 });
    }
  }

  // --- Languages ---
  const langs = d.prepare(`
    SELECT language, COUNT(*) as count FROM videos
    WHERE language IS NOT NULL AND language != ''
    GROUP BY language ORDER BY count DESC
  `).all();
  write('languages.json', langs);

  // --- Copy dashboard HTML ---
  console.log('\nCopying dashboard HTML...');
  copyFileSync(join(__dirname, '..', 'dashboard', 'index.html'), join(PUBLIC, 'index.html'));

  console.log('\nDone! Static files ready in public/');
  console.log('Deploy with: vercel --prod');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
