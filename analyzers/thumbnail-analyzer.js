import 'dotenv/config';
import { existsSync } from 'fs';
import * as db from '../db/database.js';
import { analyzeImage } from '../lib/claude.js';
import { TOP_N_FOR_THUMBNAIL_ANALYSIS } from '../lib/config.js';

/**
 * Use Claude Vision to analyze thumbnails of top-scoring videos.
 */
export async function run() {
  const videos = db.getUnanalyzedThumbnails(TOP_N_FOR_THUMBNAIL_ANALYSIS);

  if (!videos.length) {
    console.log('[thumbnail-analyzer] No thumbnails to analyze');
    return;
  }

  console.log(`[thumbnail-analyzer] Analyzing ${videos.length} thumbnails`);
  let analyzed = 0;

  for (const v of videos) {
    if (!v.thumbnail_path || !existsSync(v.thumbnail_path)) {
      console.log(`[thumbnail-analyzer] Missing thumbnail for ${v.youtube_id}`);
      continue;
    }

    try {
      const result = await analyzeImage(
        v.thumbnail_path,
        `Analyze this YouTube thumbnail for a personal finance video titled "${v.title}" (${v.views?.toLocaleString()} views).

Evaluate and return JSON:
{
  "has_text_overlay": true/false,
  "text_content": "text visible on thumbnail or null",
  "has_face": true/false,
  "face_expression": "e.g. shocked, confident, serious, smiling, or null",
  "dominant_colors": ["color1", "color2"],
  "composition_style": "e.g. split screen, centered face, before/after, listicle",
  "thumbnail_formula": "short label like shocked_face_with_number, money_stack, chart_going_up, lifestyle_flex",
  "effectiveness_score": 1-10,
  "key_insight": "one sentence about why this thumbnail works or doesn't"
}`
      );

      const analysis = typeof result === 'string' ? { raw: result } : result;

      db.getDb().prepare(`
        UPDATE scores SET thumbnail_analysis = ? WHERE video_id = ?
      `).run(JSON.stringify(analysis), v.id);

      analyzed++;
      console.log(`[thumbnail-analyzer] ${v.youtube_id}: ${analysis.thumbnail_formula || 'analyzed'}`);
    } catch (err) {
      console.error(`[thumbnail-analyzer] Error for ${v.youtube_id}:`, err.message);
    }
  }

  console.log(`[thumbnail-analyzer] Done. ${analyzed}/${videos.length} analyzed`);
}
