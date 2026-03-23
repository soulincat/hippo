import 'dotenv/config';
import { createServer } from 'http';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as db from '../db/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.DASHBOARD_PORT || 3456;

function getDb() { return db.getDb(); }
function json(res, data) {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}
function html(res, file) {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end(readFileSync(join(__dirname, file), 'utf-8'));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString());
}

// Ensure tables
getDb().exec(`CREATE TABLE IF NOT EXISTS user_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  youtube_id TEXT NOT NULL UNIQUE,
  flag TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
)`);

// Ensure columns exist (for legacy data before collectors set these)
try { getDb().exec("ALTER TABLE videos ADD COLUMN duration_seconds INTEGER DEFAULT 0"); } catch(e) {}
try { getDb().exec("ALTER TABLE videos ADD COLUMN is_short INTEGER DEFAULT 0"); } catch(e) {}

// Backfill: parse duration + detect shorts for legacy rows (only runs on unparsed rows)
function parseDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1]||0)*3600) + (parseInt(m[2]||0)*60) + parseInt(m[3]||0);
}
{
  const unparsed = getDb().prepare("SELECT id, title, tags, duration FROM videos WHERE duration_seconds = 0 AND duration IS NOT NULL").all();
  if (unparsed.length) {
    const upd = getDb().prepare("UPDATE videos SET duration_seconds = ?, is_short = ? WHERE id = ?");
    let shorts = 0;
    for (const v of unparsed) {
      const secs = parseDuration(v.duration);
      const tl = (v.title||'').toLowerCase(), tg = (v.tags||'').toLowerCase();
      const isShort = (tl.includes('#shorts') || tl.includes('#short') || tg.includes('"shorts"') || (secs > 0 && secs < 180)) ? 1 : 0;
      upd.run(secs, isShort, v.id);
      if (isShort) shorts++;
    }
    console.log(`Backfilled ${unparsed.length} legacy videos (${shorts} Shorts)`);
  }
  // Fix any videos with duration_seconds set but is_short missed (< 3 min = Short)
  const misclassified = getDb().prepare("SELECT COUNT(*) as c FROM videos WHERE duration_seconds > 0 AND duration_seconds < 180 AND is_short = 0").get().c;
  if (misclassified > 0) {
    getDb().exec("UPDATE videos SET is_short = 1 WHERE duration_seconds > 0 AND duration_seconds < 180 AND is_short = 0");
    console.log(`Reclassified ${misclassified} videos as Shorts (<3min)`);
  }
}

const SHORT_WHERE = "(v.is_short = 1)";
const LONG_WHERE = "(v.is_short = 0)";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST', 'Access-Control-Allow-Headers': 'Content-Type' });
    return res.end();
  }

  if (path === '/' || path === '/index.html') return html(res, 'index.html');

  // Stats
  if (path === '/api/stats') {
    const fmt = url.searchParams.get('format') || 'long';
    const durWhere = fmt === 'short' ? SHORT_WHERE : fmt === 'long' ? LONG_WHERE : '1=1';

    const stats = getDb().prepare(`
      SELECT
        (SELECT COUNT(*) FROM videos v WHERE ${durWhere}) as total_videos,
        (SELECT COUNT(*) FROM channels) as total_channels,
        (SELECT COUNT(*) FROM videos v JOIN scores s ON s.video_id=v.id WHERE s.virality_score >= 70 AND ${durWhere}) as high_viral,
        (SELECT COUNT(*) FROM videos v JOIN scores s ON s.video_id=v.id LEFT JOIN channels c ON v.channel_id=c.id WHERE s.outlier_score >= 10 AND c.subscribers > 0 AND ${durWhere}) as big_outliers,
        (SELECT ROUND(AVG(s.virality_score),1) FROM videos v JOIN scores s ON s.video_id=v.id WHERE s.virality_score IS NOT NULL AND ${durWhere}) as avg_score,
        (SELECT MAX(s.virality_score) FROM videos v JOIN scores s ON s.video_id=v.id WHERE ${durWhere}) as top_score,
        (SELECT MAX(discovered_at) FROM videos) as last_crawled,
        (SELECT COUNT(DISTINCT language) FROM videos WHERE language IS NOT NULL AND language != '') as languages_covered,
        (SELECT COUNT(*) FROM user_flags WHERE flag='saved') as saved_count,
        (SELECT COUNT(*) FROM user_flags WHERE flag='favorite') as fav_count,
        (SELECT COUNT(*) FROM videos v WHERE ${LONG_WHERE}) as longform_count,
        (SELECT COUNT(*) FROM videos v WHERE ${SHORT_WHERE}) as shorts_count,
        (SELECT COUNT(*) FROM channels WHERE subscribers > 0) as channels_with_subs,
        (SELECT COUNT(*) FROM channels WHERE subscribers = 0) as channels_missing_subs
    `).get();
    const regions = getDb().prepare("SELECT DISTINCT region FROM search_runs WHERE region IS NOT NULL").all();
    stats.regions = regions.map(r => r.region).filter(Boolean);
    return json(res, stats);
  }

  // Topics/trends overview
  if (path === '/api/topics') {
    const fmt = url.searchParams.get('format') || 'long';
    const durWhere = fmt === 'short' ? SHORT_WHERE : fmt === 'long' ? LONG_WHERE : '1=1';

    const keywords = ['budget','invest','passive income','save money','credit card','debt',
      'side hustle','financial independence','retirement','real estate','stock market','crypto',
      'money management','wealth','tax','ETF','index fund','frugal','emergency fund','mortgage'];

    const topics = [];
    for (const kw of keywords) {
      const row = getDb().prepare(
        `SELECT COUNT(*) as cnt, ROUND(AVG(s.virality_score),1) as avg_v, MAX(s.virality_score) as max_v,
                ROUND(AVG(v.views),0) as avg_views, SUM(v.views) as total_views
         FROM videos v JOIN scores s ON s.video_id=v.id
         WHERE LOWER(v.title) LIKE ? AND s.virality_score IS NOT NULL AND ${durWhere}`
      ).get(`%${kw.toLowerCase()}%`);
      if (row.cnt > 0) {
        // Get top video for this topic
        const top = getDb().prepare(
          `SELECT v.youtube_id, v.title, v.views, s.virality_score, c.name as channel_name, c.subscribers
           FROM videos v JOIN scores s ON s.video_id=v.id LEFT JOIN channels c ON v.channel_id=c.id
           WHERE LOWER(v.title) LIKE ? AND s.virality_score IS NOT NULL AND ${durWhere}
           ORDER BY s.virality_score DESC LIMIT 1`
        ).get(`%${kw.toLowerCase()}%`);

        // Own channel coverage for this topic
        const ownCount = getDb().prepare(
          `SELECT COUNT(*) as cnt, ROUND(AVG(views),0) as avg_views
           FROM own_videos WHERE LOWER(title) LIKE ?`
        ).get(`%${kw.toLowerCase()}%`);

        topics.push({
          topic: kw, count: row.cnt, avg_score: row.avg_v, max_score: row.max_v,
          avg_views: row.avg_views, total_views: row.total_views,
          top_video: top,
          heat: row.avg_v >= 50 ? 'hot' : row.avg_v >= 35 ? 'warm' : 'steady',
          // Own channel analysis
          own_count: ownCount.cnt || 0,
          own_avg_views: ownCount.avg_views || 0,
          // Gap = high market demand + low own coverage = opportunity
          opportunity: (ownCount.cnt === 0 && row.avg_v >= 40) ? 'untapped'
            : (ownCount.cnt <= 2 && row.avg_v >= 35) ? 'underexplored'
            : (ownCount.cnt >= 5) ? 'well-covered' : 'normal',
        });
      }
    }
    topics.sort((a, b) => b.avg_score - a.avg_score);
    return json(res, topics);
  }

  // Videos with filters
  if (path === '/api/videos') {
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = parseInt(url.searchParams.get('offset') || '0');
    const sort = url.searchParams.get('sort') || 'virality';
    const minScore = parseInt(url.searchParams.get('minScore') || '0');
    const maxSubs = url.searchParams.get('maxSubs');
    const maxDays = url.searchParams.get('maxDays');
    const search = url.searchParams.get('q');
    const fmt = url.searchParams.get('format') || 'long';
    const flag = url.searchParams.get('flag');
    const topic = url.searchParams.get('topic');

    let where = ['s.virality_score IS NOT NULL', `s.virality_score >= ${minScore}`];

    // Format filter
    if (fmt === 'short') where.push(SHORT_WHERE);
    else if (fmt === 'long') where.push(LONG_WHERE);

    if (maxSubs) where.push(`c.subscribers <= ${parseInt(maxSubs)}`);
    if (maxDays) where.push(`julianday('now') - julianday(v.published_at) <= ${parseInt(maxDays)}`);
    if (search) where.push(`v.title LIKE '%${search.replace(/'/g, "''")}%'`);
    if (topic) where.push(`LOWER(v.title) LIKE '%${topic.toLowerCase().replace(/'/g, "''")}%'`);
    if (flag === 'saved') where.push("v.youtube_id IN (SELECT youtube_id FROM user_flags WHERE flag='saved')");
    if (flag === 'favorite') where.push("v.youtube_id IN (SELECT youtube_id FROM user_flags WHERE flag='favorite')");
    if (!flag) where.push("v.youtube_id NOT IN (SELECT youtube_id FROM user_flags WHERE flag='dismissed')");

    const sortMap = { virality: 's.virality_score DESC', views: 'v.views DESC', velocity: 's.view_velocity DESC', outlier: 's.outlier_score DESC', newest: 'v.published_at DESC' };
    const orderBy = sortMap[sort] || sortMap.virality;

    const rows = getDb().prepare(`
      SELECT v.youtube_id, v.title, v.views, v.likes, v.comments,
             v.published_at, v.language, v.duration,
             c.name as channel_name, c.subscribers, c.avg_views,
             s.virality_score, s.outlier_score, s.view_velocity,
             uf.flag as user_flag
      FROM videos v
      JOIN scores s ON s.video_id = v.id
      LEFT JOIN channels c ON v.channel_id = c.id
      LEFT JOIN user_flags uf ON uf.youtube_id = v.youtube_id
      WHERE ${where.join(' AND ')}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = getDb().prepare(`
      SELECT COUNT(*) as count FROM videos v
      JOIN scores s ON s.video_id = v.id
      LEFT JOIN channels c ON v.channel_id = c.id
      WHERE ${where.join(' AND ')}
    `).get().count;

    return json(res, { videos: rows, total, limit, offset });
  }

  // Flag
  if (path === '/api/flag' && req.method === 'POST') {
    const { youtube_id, flag } = await readBody(req);
    if (!youtube_id) return json(res, { error: 'youtube_id required' });
    if (!flag) getDb().prepare('DELETE FROM user_flags WHERE youtube_id = ?').run(youtube_id);
    else getDb().prepare('INSERT OR REPLACE INTO user_flags (youtube_id, flag) VALUES (?, ?)').run(youtube_id, flag);
    return json(res, { ok: true });
  }

  // Virality predictor
  if (path === '/api/predict' && req.method === 'POST') {
    const { title } = await readBody(req);
    if (!title) return json(res, { error: 'title required' });
    const words = title.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    let matches = [];
    for (const w of words) {
      const m = getDb().prepare(`
        SELECT v.title, s.virality_score, v.views, c.subscribers, c.name as channel_name
        FROM videos v JOIN scores s ON s.video_id=v.id LEFT JOIN channels c ON v.channel_id=c.id
        WHERE LOWER(v.title) LIKE ? AND s.virality_score IS NOT NULL
        ORDER BY s.virality_score DESC LIMIT 5
      `).all(`%${w}%`);
      matches.push(...m);
    }
    const seen = new Set();
    const unique = matches.filter(m => { if (seen.has(m.title)) return false; seen.add(m.title); return true; });
    unique.sort((a, b) => b.virality_score - a.virality_score);
    const top = unique.slice(0, 10);
    const avg = top.length ? Math.round(top.reduce((s, m) => s + m.virality_score, 0) / top.length) : 0;

    return json(res, {
      predicted_score: avg,
      max_similar_score: top.length ? Math.max(...top.map(m => m.virality_score)) : 0,
      confidence: top.length >= 5 ? 'high' : top.length >= 2 ? 'medium' : 'low',
      similar_videos: top.slice(0, 5).map(m => ({ title: m.title, score: m.virality_score, views: m.views, channel: m.channel_name })),
    });
  }

  // DB count for manual crawl estimation
  if (path === '/api/crawl-estimate') {
    const topic = url.searchParams.get('topic') || '';
    const fmt = url.searchParams.get('format') || 'long';
    const durWhere = fmt === 'short' ? SHORT_WHERE : fmt === 'long' ? LONG_WHERE : '1=1';

    let where = `s.virality_score IS NOT NULL AND ${durWhere}`;
    if (topic) where += ` AND LOWER(v.title) LIKE '%${topic.toLowerCase().replace(/'/g, "''")}%'`;

    const count = getDb().prepare(`
      SELECT COUNT(*) as c FROM videos v JOIN scores s ON s.video_id=v.id WHERE ${where}
    `).get().c;

    return json(res, { topic: topic || 'all', format: fmt, db_count: count, suggestion: count < 20 ? 'Crawl recommended' : count < 50 ? 'More data would help' : 'Good coverage' });
  }

  // Languages
  if (path === '/api/languages') {
    const langs = getDb().prepare(`
      SELECT language, COUNT(*) as count FROM videos
      WHERE language IS NOT NULL AND language != ''
      GROUP BY language ORDER BY count DESC
    `).all();
    return json(res, langs);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => console.log(`Dashboard: http://localhost:${PORT}`));
