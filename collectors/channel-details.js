import 'dotenv/config';
import * as yt from '../lib/youtube.js';
import * as db from '../db/database.js';

const BATCH_SIZE = 50;

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Calculate trimmed mean of views (exclude highest and lowest).
 */
function trimmedMean(views) {
  if (views.length <= 2) {
    return views.length ? Math.round(views.reduce((a, b) => a + b, 0) / views.length) : 0;
  }
  const sorted = [...views].sort((a, b) => a - b);
  const trimmed = sorted.slice(1, -1);
  return Math.round(trimmed.reduce((a, b) => a + b, 0) / trimmed.length);
}

/**
 * Fetch channel details and calculate avg views.
 * @param {string[]} channelIds - YouTube channel IDs to fetch
 */
export async function run(channelIds) {
  if (!channelIds) {
    // Get channels not updated in last 7 days
    channelIds = db.getStaleChannelIds(7);
    if (!channelIds.length) {
      // Get all channels with 0 subscribers (never fully fetched)
      const rows = db.getDb().prepare('SELECT youtube_channel_id FROM channels WHERE subscribers = 0').all();
      channelIds = rows.map(r => r.youtube_channel_id);
    }
  }

  if (!channelIds.length) {
    console.log('[channel-details] No channels to update');
    return;
  }

  console.log(`[channel-details] Fetching ${channelIds.length} channels`);

  for (let i = 0; i < channelIds.length; i += BATCH_SIZE) {
    const batch = channelIds.slice(i, i + BATCH_SIZE);
    try {
      const channels = await yt.getChannelDetails(batch);
      await sleep(300);

      for (const ch of channels) {
        let avgViews = 0;

        // Get recent uploads to calculate avg views
        if (ch.uploadsPlaylistId) {
          try {
            const uploads = await yt.getPlaylistItems(ch.uploadsPlaylistId, 10);
            await sleep(300);

            if (uploads.length) {
              const uploadIds = uploads.map(u => u.videoId);
              const videoStats = await yt.getVideoDetails(uploadIds);
              const viewCounts = videoStats.map(v => v.views);
              avgViews = trimmedMean(viewCounts);
              await sleep(300);
            }
          } catch (err) {
            console.error(`[channel-details] Avg views error for ${ch.name}:`, err.message);
          }
        }

        db.upsertChannel({
          youtube_channel_id: ch.channelId,
          name: ch.name,
          subscribers: ch.subscribers,
          avg_views: avgViews,
          total_videos: ch.totalVideos,
          country: ch.country,
        });
      }
    } catch (err) {
      if (err.message.includes('Quota limit')) {
        console.log('[channel-details] Quota limit reached');
        break;
      }
      console.error(`[channel-details] Batch error:`, err.message);
    }
  }

  console.log(`[channel-details] Done`);
}
