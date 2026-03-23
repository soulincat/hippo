import 'dotenv/config';
import * as yt from '../lib/youtube.js';
import * as db from '../db/database.js';

const BATCH_SIZE = 50;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Parse ISO 8601 duration to seconds.
 */
function parseDuration(iso) {
  if (!iso) return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

/**
 * Detect if a video is a YouTube Short.
 */
function detectShort(title, tags, durationSeconds) {
  const titleLower = (title || '').toLowerCase();
  const tagsLower = (tags || []).map(t => t.toLowerCase());
  return (
    titleLower.includes('#shorts') || titleLower.includes('#short') ||
    tagsLower.includes('shorts') || tagsLower.includes('short') ||
    (durationSeconds > 0 && durationSeconds < 180)
  );
}

/**
 * Fetch full details for discovered videos and store in DB.
 * @param {Map|string[]} discoveredVideos - Map<videoId, { searchTerm, region, language }> or array of IDs
 */
export async function run(discoveredVideos) {
  let videoIds;
  let metadataMap = new Map();

  if (discoveredVideos instanceof Map) {
    videoIds = [...discoveredVideos.keys()];
    metadataMap = discoveredVideos;
  } else if (Array.isArray(discoveredVideos)) {
    videoIds = discoveredVideos;
  } else {
    // Fallback: get videos without channel_id (not yet detailed)
    const rows = db.getDb().prepare('SELECT youtube_id FROM videos WHERE channel_id IS NULL').all();
    videoIds = rows.map(r => r.youtube_id);
  }

  if (!videoIds.length) {
    console.log('[video-details] No videos to fetch');
    return [];
  }

  // Ensure duration_seconds and is_short columns exist
  try { db.getDb().exec("ALTER TABLE videos ADD COLUMN duration_seconds INTEGER DEFAULT 0"); } catch(e) {}
  try { db.getDb().exec("ALTER TABLE videos ADD COLUMN is_short INTEGER DEFAULT 0"); } catch(e) {}

  console.log(`[video-details] Fetching details for ${videoIds.length} videos`);
  const channelIds = new Set();

  for (let i = 0; i < videoIds.length; i += BATCH_SIZE) {
    const batch = videoIds.slice(i, i + BATCH_SIZE);
    try {
      const details = await yt.getVideoDetails(batch);

      for (const v of details) {
        // Ensure channel exists in DB first
        let channel = db.getChannelByYoutubeId(v.channelId);
        if (!channel) {
          db.upsertChannel({
            youtube_channel_id: v.channelId,
            name: v.channelTitle || 'Unknown',
            subscribers: 0,
            avg_views: 0,
            total_videos: 0,
            country: null,
          });
          channel = db.getChannelByYoutubeId(v.channelId);
        }
        channelIds.add(v.channelId);

        // Get metadata from search (if available)
        const meta = metadataMap.get(v.videoId) || {};

        // Parse duration and detect shorts
        const durationSeconds = parseDuration(v.duration);
        const isShort = detectShort(v.title, v.tags, durationSeconds) ? 1 : 0;

        db.upsertVideo({
          youtube_id: v.videoId,
          title: v.title,
          description: (v.description || '').slice(0, 2000),
          tags: JSON.stringify(v.tags),
          published_at: v.publishedAt,
          channel_id: channel.id,
          views: v.views,
          likes: v.likes,
          comments: v.comments,
          duration: v.duration,
          language: v.defaultLanguage || meta.language || null,
          country: meta.region || null,
          search_term: meta.searchTerm || null,
        });

        // Update computed columns
        db.getDb().prepare(
          'UPDATE videos SET duration_seconds = ?, is_short = ? WHERE youtube_id = ?'
        ).run(durationSeconds, isShort, v.videoId);
      }

      await sleep(300);
    } catch (err) {
      if (err.message.includes('Quota limit')) {
        console.log('[video-details] Quota limit reached');
        break;
      }
      console.error(`[video-details] Batch error:`, err.message);
    }
  }

  console.log(`[video-details] Done. Channels to update: ${channelIds.size}`);
  return [...channelIds];
}
