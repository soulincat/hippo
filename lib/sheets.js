import { google } from 'googleapis';
import { readFileSync } from 'fs';

let _sheets = null;
let _spreadsheetId = null;

function getClient() {
  if (_sheets) return _sheets;

  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || './credentials.json';
  const credentials = JSON.parse(readFileSync(keyFile, 'utf-8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  _sheets = google.sheets({ version: 'v4', auth });
  _spreadsheetId = process.env.SPREADSHEET_ID;

  if (!_spreadsheetId) throw new Error('SPREADSHEET_ID not set in .env');
  return _sheets;
}

function getSpreadsheetId() {
  if (!_spreadsheetId) getClient();
  return _spreadsheetId;
}

/**
 * Append rows to a sheet tab.
 * @param {string} sheetName - Tab name (e.g., "Content Library")
 * @param {any[][]} rows - Array of row arrays
 */
export async function appendRows(sheetName, rows) {
  if (!rows.length) return;
  const sheets = getClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: getSpreadsheetId(),
    range: `'${sheetName}'!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows },
  });
}

/**
 * Read a range from a sheet.
 * @param {string} range - e.g., "'Content Library'!A:R"
 * @returns {any[][]}
 */
export async function readRange(range) {
  const sheets = getClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(),
    range,
  });
  return res.data.values || [];
}

/**
 * Update a specific cell or range.
 */
export async function updateRange(range, values) {
  const sheets = getClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: getSpreadsheetId(),
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values },
  });
}

/**
 * Clear a range.
 */
export async function clearRange(range) {
  const sheets = getClient();
  await sheets.spreadsheets.values.clear({
    spreadsheetId: getSpreadsheetId(),
    range,
  });
}

/**
 * Batch update (formatting, data validation, etc.)
 */
export async function batchUpdate(requests) {
  const sheets = getClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: { requests },
  });
}

/**
 * Get sheet metadata (tab names, IDs).
 */
export async function getSheetMeta() {
  const sheets = getClient();
  const res = await sheets.spreadsheets.get({
    spreadsheetId: getSpreadsheetId(),
    fields: 'sheets.properties',
  });
  return res.data.sheets.map(s => ({
    sheetId: s.properties.sheetId,
    title: s.properties.title,
  }));
}

/**
 * Create a new sheet tab if it doesn't exist.
 */
export async function ensureSheet(title) {
  const meta = await getSheetMeta();
  const exists = meta.find(s => s.title === title);
  if (exists) return exists.sheetId;

  const sheets = getClient();
  const res = await sheets.spreadsheets.batchUpdate({
    spreadsheetId: getSpreadsheetId(),
    requestBody: {
      requests: [{
        addSheet: { properties: { title } },
      }],
    },
  });
  return res.data.replies[0].addSheet.properties.sheetId;
}

/**
 * Get all video URLs already in the Content Library (for dedup).
 */
export async function getExistingVideoUrls() {
  const rows = await readRange("'Content Library'!J:J");
  return new Set(rows.flat().filter(Boolean));
}
