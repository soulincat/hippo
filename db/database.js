import Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, '..', 'yt-scout.db');

let _db = null;

export function getDb() {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');

  // Auto-init schema
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  _db.exec(schema);

  return _db;
}

// --- Videos ---

export function upsertVideo(video) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO videos (youtube_id, title, description, tags, published_at, channel_id, views, likes, comments, duration, language, country, search_term)
    VALUES (@youtube_id, @title, @description, @tags, @published_at, @channel_id, @views, @likes, @comments, @duration, @language, @country, @search_term)
    ON CONFLICT(youtube_id) DO UPDATE SET
      views = @views, likes = @likes, comments = @comments,
      updated_at = datetime('now')
  `).run(video);
}

export function getVideoByYoutubeId(youtubeId) {
  return getDb().prepare('SELECT * FROM videos WHERE youtube_id = ?').get(youtubeId);
}

export function getVideosForScoring() {
  return getDb().prepare(`
    SELECT v.*, c.subscribers, c.avg_views, c.name as channel_name
    FROM videos v
    LEFT JOIN channels c ON v.channel_id = c.id
    WHERE v.channel_id IS NOT NULL
  `).all();
}

export function getUnscoredVideos() {
  return getDb().prepare(`
    SELECT v.*, c.subscribers, c.avg_views, c.name as channel_name
    FROM videos v
    LEFT JOIN channels c ON v.channel_id = c.id
    LEFT JOIN scores s ON s.video_id = v.id
    WHERE s.id IS NULL AND v.channel_id IS NOT NULL
  `).all();
}

export function getTopScoredVideos(limit = 50) {
  return getDb().prepare(`
    SELECT v.*, s.*, c.name as channel_name, c.subscribers, c.avg_views
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    LEFT JOIN channels c ON v.channel_id = c.id
    ORDER BY s.virality_score DESC
    LIMIT ?
  `).all(limit);
}

export function getRecentVideoIds(days = 30) {
  return getDb().prepare(`
    SELECT youtube_id FROM videos
    WHERE discovered_at >= datetime('now', '-' || ? || ' days')
  `).all(days).map(r => r.youtube_id);
}

// --- Channels ---

export function upsertChannel(channel) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO channels (youtube_channel_id, name, subscribers, avg_views, total_videos, country)
    VALUES (@youtube_channel_id, @name, @subscribers, @avg_views, @total_videos, @country)
    ON CONFLICT(youtube_channel_id) DO UPDATE SET
      name = @name, subscribers = @subscribers, avg_views = @avg_views,
      total_videos = @total_videos, updated_at = datetime('now')
  `).run(channel);
}

export function getChannelByYoutubeId(youtubeChannelId) {
  return getDb().prepare('SELECT * FROM channels WHERE youtube_channel_id = ?').get(youtubeChannelId);
}

export function getStaleChannelIds(days = 7) {
  return getDb().prepare(`
    SELECT youtube_channel_id FROM channels
    WHERE updated_at < datetime('now', '-' || ? || ' days')
  `).all(days).map(r => r.youtube_channel_id);
}

// --- Scores ---

export function upsertScore(score) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO scores (video_id, outlier_score, view_velocity, virality_score, content_type, freshness_window, thumbnail_analysis, categorization_notes)
    VALUES (@video_id, @outlier_score, @view_velocity, @virality_score, @content_type, @freshness_window, @thumbnail_analysis, @categorization_notes)
    ON CONFLICT(video_id) DO UPDATE SET
      outlier_score = @outlier_score, view_velocity = @view_velocity,
      virality_score = @virality_score, content_type = @content_type,
      freshness_window = @freshness_window, thumbnail_analysis = @thumbnail_analysis,
      categorization_notes = @categorization_notes, scored_at = datetime('now')
  `).run(score);
}

export function getScoreByVideoId(videoId) {
  return getDb().prepare('SELECT * FROM scores WHERE video_id = ?').get(videoId);
}

export function getUncategorizedVideos(limit = 50) {
  return getDb().prepare(`
    SELECT v.*, s.virality_score, s.view_velocity
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    WHERE s.content_type IS NULL
    ORDER BY s.virality_score DESC
    LIMIT ?
  `).all(limit);
}

export function getUnanalyzedThumbnails(limit = 25) {
  return getDb().prepare(`
    SELECT v.*, s.virality_score
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    WHERE s.thumbnail_analysis IS NULL AND v.thumbnail_path IS NOT NULL
    ORDER BY s.virality_score DESC
    LIMIT ?
  `).all(limit);
}

// --- Own Videos ---

export function upsertOwnVideo(video) {
  const db = getDb();
  return db.prepare(`
    INSERT INTO own_videos (youtube_id, title, description, tags, published_at, views)
    VALUES (@youtube_id, @title, @description, @tags, @published_at, @views)
    ON CONFLICT(youtube_id) DO UPDATE SET
      views = @views, updated_at = datetime('now')
  `).run(video);
}

export function getAllOwnVideos() {
  return getDb().prepare('SELECT * FROM own_videos ORDER BY published_at DESC').all();
}

export function getLatestOwnVideoDate() {
  const row = getDb().prepare('SELECT MAX(published_at) as latest FROM own_videos').get();
  return row?.latest || null;
}

// --- Similarity ---

export function insertSimilarity(flag) {
  const db = getDb();
  return db.prepare(`
    INSERT OR IGNORE INTO similarity_flags (video_id, own_video_id, similarity_score, notes)
    VALUES (@video_id, @own_video_id, @similarity_score, @notes)
  `).run(flag);
}

export function getSimilarities(videoId) {
  return getDb().prepare(`
    SELECT sf.*, ov.title as own_title
    FROM similarity_flags sf
    JOIN own_videos ov ON sf.own_video_id = ov.id
    WHERE sf.video_id = ?
  `).all(videoId);
}

// --- Search Runs ---

export function logSearchRun(run) {
  return getDb().prepare(`
    INSERT INTO search_runs (run_date, search_term, region, results_count, quota_used)
    VALUES (@run_date, @search_term, @region, @results_count, @quota_used)
  `).run(run);
}

export function getLastRunDate(searchTerm, region) {
  const row = getDb().prepare(`
    SELECT MAX(run_date) as last_run FROM search_runs
    WHERE search_term = ? AND region = ?
  `).get(searchTerm, region);
  return row?.last_run || null;
}

// --- Reports ---

export function saveReport(report) {
  return getDb().prepare(`
    INSERT INTO reports (run_date, report_json, summary)
    VALUES (@run_date, @report_json, @summary)
  `).run(report);
}

export function getLatestReport() {
  return getDb().prepare('SELECT * FROM reports ORDER BY created_at DESC LIMIT 1').get();
}

// --- Helpers ---

export function linkVideoToChannel(youtubeVideoId, channelDbId) {
  getDb().prepare('UPDATE videos SET channel_id = ? WHERE youtube_id = ?').run(channelDbId, youtubeVideoId);
}

export function setThumbnailPath(youtubeVideoId, path) {
  getDb().prepare('UPDATE videos SET thumbnail_path = ? WHERE youtube_id = ?').run(path, youtubeVideoId);
}
