import 'dotenv/config';
import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import * as db from '../db/database.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const THUMBS_DIR = join(__dirname, '..', 'thumbnails');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Download thumbnails for top-scoring videos.
 * @param {number} limit - Max thumbnails to download
 */
export async function run(limit = 30) {
  // Get top scored videos without thumbnails
  const videos = db.getDb().prepare(`
    SELECT v.youtube_id, v.title, s.virality_score
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    WHERE v.thumbnail_path IS NULL
    ORDER BY s.virality_score DESC
    LIMIT ?
  `).all(limit);

  if (!videos.length) {
    // Fallback: get videos by raw views if no scores yet
    const unscoredVideos = db.getDb().prepare(`
      SELECT youtube_id, title, views
      FROM videos
      WHERE thumbnail_path IS NULL
      ORDER BY views DESC
      LIMIT ?
    `).all(limit);
    videos.push(...unscoredVideos);
  }

  if (!videos.length) {
    console.log('[thumbnails] No videos need thumbnails');
    return;
  }

  console.log(`[thumbnails] Downloading ${videos.length} thumbnails`);
  let downloaded = 0;

  for (const video of videos) {
    const filename = `${video.youtube_id}.jpg`;
    const filepath = join(THUMBS_DIR, filename);

    if (existsSync(filepath)) {
      db.setThumbnailPath(video.youtube_id, filepath);
      downloaded++;
      continue;
    }

    try {
      // Try maxresdefault first, fall back to hqdefault
      let url = `https://img.youtube.com/vi/${video.youtube_id}/maxresdefault.jpg`;
      let res = await fetch(url);

      if (!res.ok) {
        url = `https://img.youtube.com/vi/${video.youtube_id}/hqdefault.jpg`;
        res = await fetch(url);
      }

      if (!res.ok) {
        console.error(`[thumbnails] Failed to download ${video.youtube_id}: ${res.status}`);
        continue;
      }

      const buffer = Buffer.from(await res.arrayBuffer());

      // Resize to 800px wide for Claude Vision (saves tokens)
      const resized = await sharp(buffer)
        .resize(800, null, { withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      writeFileSync(filepath, resized);
      db.setThumbnailPath(video.youtube_id, filepath);
      downloaded++;

      await sleep(200);
    } catch (err) {
      console.error(`[thumbnails] Error for ${video.youtube_id}:`, err.message);
    }
  }

  console.log(`[thumbnails] Downloaded ${downloaded}/${videos.length}`);
}
