import 'dotenv/config';
import * as db from '../db/database.js';
import { analyzeJson } from '../lib/claude.js';
import { TOP_N_FOR_SIMILARITY } from '../lib/config.js';

/**
 * Compare top-scoring discovered videos against the creator's own content.
 */
export async function run() {
  const ownVideos = db.getAllOwnVideos();
  if (!ownVideos.length) {
    console.log('[similarity] No own videos to compare against. Run own-channel first.');
    return;
  }

  // Get top scored videos not yet checked for similarity
  const discovered = db.getDb().prepare(`
    SELECT v.id, v.youtube_id, v.title, v.description, v.tags
    FROM videos v
    JOIN scores s ON s.video_id = v.id
    WHERE s.virality_score IS NOT NULL
      AND v.id NOT IN (SELECT DISTINCT video_id FROM similarity_flags)
    ORDER BY s.virality_score DESC
    LIMIT ?
  `).all(TOP_N_FOR_SIMILARITY);

  if (!discovered.length) {
    console.log('[similarity] No new videos to check');
    return;
  }

  console.log(`[similarity] Checking ${discovered.length} videos against ${ownVideos.length} own videos`);

  // Build own content summary (just titles + tags for context)
  const ownSummary = ownVideos.map(ov => ({
    id: ov.id,
    title: ov.title,
    tags: ov.tags ? JSON.parse(ov.tags).slice(0, 5) : [],
  }));

  // Batch discovered videos (5 at a time to keep Claude responses manageable)
  const BATCH = 5;
  for (let i = 0; i < discovered.length; i += BATCH) {
    const batch = discovered.slice(i, i + BATCH);
    const batchData = batch.map(v => ({
      id: v.id,
      youtube_id: v.youtube_id,
      title: v.title,
      description: (v.description || '').slice(0, 200),
      tags: v.tags ? JSON.parse(v.tags).slice(0, 5) : [],
    }));

    try {
      const result = await analyzeJson(`Compare these discovered YouTube videos to the creator's existing content library.

Creator's existing videos:
${JSON.stringify(ownSummary.slice(0, 50), null, 2)}

Discovered videos to check:
${JSON.stringify(batchData, null, 2)}

For each discovered video, check if it covers a topic the creator has ALREADY published about.

Return a JSON array (one object per discovered video):
[{
  "id": <discovered video db id>,
  "youtube_id": "...",
  "similar": true/false,
  "most_similar_own_id": <own video db id or null>,
  "similarity_score": 0.0-1.0,
  "notes": "brief explanation"
}]`);

      for (const item of result) {
        if (item.similar && item.similarity_score > 0.6 && item.most_similar_own_id) {
          db.insertSimilarity({
            video_id: item.id,
            own_video_id: item.most_similar_own_id,
            similarity_score: item.similarity_score,
            notes: item.notes || '',
          });
          console.log(`[similarity] Flag: "${batch.find(b => b.id === item.id)?.title?.slice(0, 40)}" ~ own (${Math.round(item.similarity_score * 100)}%)`);
        }
      }
    } catch (err) {
      console.error(`[similarity] Batch error:`, err.message);
    }
  }

  console.log('[similarity] Done');
}
