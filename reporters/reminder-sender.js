import 'dotenv/config';
import { getDueReminders, markReminded } from '../sheets/read-flags.js';

/**
 * Check for due reminders and log them.
 * Later: send via email/Telegram.
 */
export async function run() {
  console.log('[reminders] Checking for due reminders...');

  const due = await getDueReminders();

  if (!due.length) {
    console.log('[reminders] No reminders due today');
    return;
  }

  console.log(`[reminders] ${due.length} reminder(s) due:`);
  console.log('');

  for (const r of due) {
    console.log(`  REMINDER: "${r.title}"`);
    console.log(`    Channel: ${r.channel} | Virality: ${r.viralityScore}/100 | Type: ${r.contentType}`);
    console.log(`    URL: ${r.videoUrl}`);
    if (r.notes) console.log(`    Notes: ${r.notes}`);
    console.log(`    Remind date: ${r.remindDate}`);
    console.log('');

    // Mark as reminded in the sheet
    try {
      await markReminded(r.rowIndex);
    } catch (err) {
      console.error(`[reminders] Failed to mark row ${r.rowIndex}:`, err.message);
    }
  }

  // TODO: Send via email when Resend is configured
  // TODO: Send via Telegram when bot is configured
}
