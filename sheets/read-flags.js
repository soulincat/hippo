import 'dotenv/config';
import * as sheets from '../lib/sheets.js';

/**
 * Read team flags from Content Library sheet.
 * Returns rows where Status = "Remind" and Remind Date <= today.
 */
export async function getDueReminders() {
  const data = await sheets.readRange("'Content Library'!A2:R");
  if (!data.length) return [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const due = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const status = row[14]; // col O
    const remindDate = row[15]; // col P

    if (status !== 'Remind' || !remindDate) continue;

    const remindMs = new Date(remindDate).getTime();
    if (isNaN(remindMs) || remindMs > today.getTime()) continue;

    due.push({
      rowIndex: i + 2, // 1-indexed, skip header
      title: row[2] || '',
      channel: row[3] || '',
      views: row[5] || 0,
      viralityScore: row[7] || 0,
      contentType: row[9] || '',
      videoUrl: row[12] || '',
      remindDate,
      notes: row[16] || '',
    });
  }

  return due;
}

/**
 * Get all flagged items (Saved, Remind, Used).
 */
export async function getFlaggedItems() {
  const data = await sheets.readRange("'Content Library'!A2:R");
  if (!data.length) return { saved: [], remind: [], used: [] };

  const result = { saved: [], remind: [], used: [] };

  for (const row of data) {
    const status = (row[14] || '').toLowerCase();
    const item = {
      title: row[2] || '',
      videoUrl: row[12] || '',
      viralityScore: row[7] || 0,
      contentType: row[9] || '',
      remindDate: row[15] || '',
      notes: row[16] || '',
    };

    if (status === 'saved') result.saved.push(item);
    else if (status === 'remind') result.remind.push(item);
    else if (status === 'used') result.used.push(item);
  }

  return result;
}

/**
 * Mark a reminder as processed by changing status to "Reminded".
 */
export async function markReminded(rowIndex) {
  await sheets.updateRange(
    `'Content Library'!O${rowIndex}`,
    [['Reminded']],
  );
}
