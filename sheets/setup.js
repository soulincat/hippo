import 'dotenv/config';
import * as sheets from '../lib/sheets.js';

const TABS = [
  'Content Library',
  'Trending Topics',
  'Thumbnail Patterns',
  'Own Content',
  'Reminders',
];

const HEADERS = {
  'Content Library': [
    'Thumbnail', 'Title', 'Channel', 'Subs', 'Views',
    'Days Old', 'Views/Day', 'xChannel', 'Viral Score',
    'Video URL', 'Language', 'Status', 'Remind Date', 'Notes',
  ],
  'Trending Topics': [
    'Week', 'Topic/Theme', '# Videos Found', 'Avg Virality', 'Top Title Example', 'Trend Direction',
  ],
  'Thumbnail Patterns': [
    'Formula', 'Count', 'Avg Effectiveness', 'Example URL', 'Example Thumbnail',
  ],
  'Own Content': [
    'Title', 'Published', 'Views', 'Tags',
  ],
  'Reminders': [
    'Original Title', 'Video URL', 'Remind Date', 'Days Until', 'Notes', 'Status',
  ],
};

/**
 * One-time setup: create all tabs with headers and formatting.
 */
async function setup() {
  console.log('[setup] Setting up Google Sheet...');

  // Create all tabs
  const sheetIds = {};
  for (const tab of TABS) {
    const sheetId = await sheets.ensureSheet(tab);
    sheetIds[tab] = sheetId;
    console.log(`[setup] Tab "${tab}" ready (id: ${sheetId})`);
  }

  // Write headers to each tab
  for (const [tab, headers] of Object.entries(HEADERS)) {
    await sheets.updateRange(`'${tab}'!A1`, [headers]);
  }

  // Format Content Library
  const clId = sheetIds['Content Library'];
  if (clId !== undefined) {
    const requests = [];

    // Freeze header row
    requests.push({
      updateSheetProperties: {
        properties: { sheetId: clId, gridProperties: { frozenRowCount: 1 } },
        fields: 'gridProperties.frozenRowCount',
      },
    });

    // Bold header row
    requests.push({
      repeatCell: {
        range: { sheetId: clId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: 'userEnteredFormat.textFormat.bold',
      },
    });

    // Header background color (dark blue)
    requests.push({
      repeatCell: {
        range: { sheetId: clId, startRowIndex: 0, endRowIndex: 1 },
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.1, green: 0.2, blue: 0.4 },
            textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    });

    // Status column dropdown (col L = index 11)
    requests.push({
      setDataValidation: {
        range: { sheetId: clId, startRowIndex: 1, startColumnIndex: 11, endColumnIndex: 12 },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: [
              { userEnteredValue: 'New' },
              { userEnteredValue: 'Saved' },
              { userEnteredValue: 'Remind' },
              { userEnteredValue: 'Used' },
              { userEnteredValue: 'Skip' },
            ],
          },
          showCustomUi: true,
          strict: false,
        },
      },
    });

    // Remind Date column format (col M = index 12)
    requests.push({
      repeatCell: {
        range: { sheetId: clId, startRowIndex: 1, startColumnIndex: 12, endColumnIndex: 13 },
        cell: {
          userEnteredFormat: { numberFormat: { type: 'DATE', pattern: 'yyyy-mm-dd' } },
        },
        fields: 'userEnteredFormat.numberFormat',
      },
    });

    // Conditional formatting: virality score color gradient (col I = index 8)
    // Red for low, yellow for mid, green for high
    requests.push({
      addConditionalFormatRule: {
        rule: {
          ranges: [{ sheetId: clId, startRowIndex: 1, startColumnIndex: 8, endColumnIndex: 9 }],
          gradientRule: {
            minpoint: { color: { red: 1, green: 0.8, blue: 0.8 }, type: 'NUMBER', value: '0' },
            midpoint: { color: { red: 1, green: 1, blue: 0.7 }, type: 'NUMBER', value: '50' },
            maxpoint: { color: { red: 0.7, green: 1, blue: 0.7 }, type: 'NUMBER', value: '100' },
          },
        },
        index: 0,
      },
    });

    // Column widths
    const columnWidths = [
      { col: 0, width: 160 },  // Thumbnail
      { col: 1, width: 380 },  // Title
      { col: 2, width: 180 },  // Channel
      { col: 3, width: 80 },   // Subs
      { col: 4, width: 80 },   // Views
      { col: 5, width: 70 },   // Days Old
      { col: 6, width: 90 },   // Views/Day
      { col: 7, width: 80 },   // xChannel
      { col: 8, width: 85 },   // Viral Score
      { col: 9, width: 250 },  // URL
      { col: 10, width: 80 },  // Language
      { col: 11, width: 80 },  // Status
      { col: 12, width: 110 }, // Remind Date
      { col: 13, width: 250 }, // Notes
    ];

    for (const { col, width } of columnWidths) {
      requests.push({
        updateDimensionProperties: {
          range: { sheetId: clId, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 },
          properties: { pixelSize: width },
          fields: 'pixelSize',
        },
      });
    }

    // Set row height for thumbnail display
    requests.push({
      updateDimensionProperties: {
        range: { sheetId: clId, dimension: 'ROWS', startIndex: 1 },
        properties: { pixelSize: 80 },
        fields: 'pixelSize',
      },
    });

    await sheets.batchUpdate(requests);
  }

  // Format other tabs (freeze + bold headers)
  for (const tab of TABS.slice(1)) {
    const id = sheetIds[tab];
    if (id === undefined) continue;
    await sheets.batchUpdate([
      {
        updateSheetProperties: {
          properties: { sheetId: id, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      {
        repeatCell: {
          range: { sheetId: id, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.1, green: 0.2, blue: 0.4 },
              textFormat: { bold: true, foregroundColor: { red: 1, green: 1, blue: 1 } },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      },
    ]);
  }

  console.log('[setup] Done! Sheet is ready.');
  console.log('[setup] Remember to share the sheet with your team.');
}

setup().catch(err => {
  console.error('[setup] Error:', err.message);
  process.exit(1);
});
