import 'dotenv/config';
import * as yt from '../lib/youtube.js';
import * as db from '../db/database.js';

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Crawl the creator's own channel and populate own_videos table.
 * Full crawl on first run, incremental after.
 */
export async function run() {
  const channelId = process.env.OWN_CHANNEL_ID;
  if (!channelId) {
    console.log('[own-channel] OWN_CHANNEL_ID not set, skipping');
    return;
  }

  console.log(`[own-channel] Crawling channel ${channelId}`);

  // Get the uploads playlist ID
  const channels = await yt.getChannelDetails([channelId]);
  if (!channels.length) {
    console.error('[own-channel] Channel not found');
    return;
  }

  const uploadsPlaylistId = channels[0].uploadsPlaylistId;
  if (!uploadsPlaylistId) {
    console.error('[own-channel] No uploads playlist found');
    return;
  }

  // Check if first run or incremental
  const latestDate = db.getLatestOwnVideoDate();
  let items;

  if (!latestDate) {
    // First run: get all uploads
    console.log('[own-channel] First run — fetching all uploads');
    items = await yt.getAllPlaylistItems(uploadsPlaylistId);
  } else {
    // Incremental: just get recent
    console.log(`[own-channel] Incremental — fetching since ${latestDate}`);
    items = await yt.getPlaylistItems(uploadsPlaylistId, 50);
    // Filter to only new ones
    items = items.filter(i => i.publishedAt > latestDate);
  }

  if (!items.length) {
    console.log('[own-channel] No new videos');
    return;
  }

  // Fetch full details for all items
  const BATCH = 50;
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    const videoIds = batch.map(b => b.videoId);

    try {
      const details = await yt.getVideoDetails(videoIds);
      for (const v of details) {
        db.upsertOwnVideo({
          youtube_id: v.videoId,
          title: v.title,
          description: (v.description || '').slice(0, 2000),
          tags: JSON.stringify(v.tags),
          published_at: v.publishedAt,
          views: v.views,
        });
      }
      await sleep(300);
    } catch (err) {
      console.error(`[own-channel] Batch error:`, err.message);
    }
  }

  const total = db.getAllOwnVideos().length;
  console.log(`[own-channel] Done. Total own videos: ${total}`);
}
