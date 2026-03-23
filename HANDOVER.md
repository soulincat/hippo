# YT Trend Scout — Developer Handover

## What This Is

A weekly automated YouTube market research bot for **personal finance content creators**. It crawls YouTube globally, finds winning title + thumbnail combinations, and builds a scored content library with virality predictions. Built as a gift for Finanzfluss.

**Live dashboard**: `npm run dashboard` → http://localhost:3456
**Google Sheet**: https://docs.google.com/spreadsheets/d/1dIN4KQuY7W1TheMiHYngj7beXQfMCQwt1pDsFwjMr2E/edit

---

## Quick Start

```bash
cd yt-trend-scout
cp .env.template .env     # Fill in your keys (see below)
npm install
npm run dashboard          # Start the web dashboard
npm run seed               # Run a seed crawl (uses YouTube API quota)
npm run full-run           # Full pipeline: crawl + score + sheet sync
pm2 start ecosystem.config.cjs  # Start weekly cron
```

---

## Environment Variables (.env)

```
YOUTUBE_API_KEY=AIzaSy...           # YouTube Data API v3 (free, 10K units/day)
ANTHROPIC_API_KEY=sk-ant-...        # Claude API (for thumbnail + content analysis)
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./credentials.json  # Google Sheets service account
SPREADSHEET_ID=1dIN4KQuY7W1TheMiHYngj7beXQfMCQwt1pDsFwjMr2E
OWN_CHANNEL_ID=                     # Finanzfluss YouTube channel ID (UC...)
```

**YouTube API Key**: Free tier, 10,000 quota units/day. Not tied to any channel. Get one at [Google Cloud Console](https://console.cloud.google.com/) → Enable "YouTube Data API v3" → Create API Key.

**Google Service Account**: Robot Google account for Sheet read/write. Created in Google Cloud Console → IAM → Service Accounts. The Sheet must be shared (Editor) with the service account email. Credentials JSON file lives at `./credentials.json` (gitignored).

**OWN_CHANNEL_ID**: The creator's YouTube channel ID. Find it at youtube.com/@finanzfluss → View Page Source → search for `channelId`. Starts with `UC...`.

---

## Architecture

```
yt-trend-scout/
├── lib/                    # Shared wrappers
│   ├── youtube.js          # YouTube Data API v3 + quota tracker
│   ├── claude.js           # Claude text + vision analysis
│   ├── sheets.js           # Google Sheets API
│   └── config.js           # Search terms, regions, thresholds
├── collectors/             # Data ingestion from YouTube
│   ├── youtube-search.js   # Search API (returns Map with metadata)
│   ├── video-details.js    # Batch video stats (sets duration, is_short)
│   ├── channel-details.js  # Channel stats + avg views
│   ├── thumbnail-downloader.js
│   └── own-channel.js      # Creator's own channel crawl
├── analyzers/              # Scoring and classification
│   ├── outlier-detector.js # views vs channel size ratio
│   ├── view-velocity.js    # views/day with recency decay
│   ├── virality-scorer.js  # composite 0-100 score
│   ├── content-categorizer.js  # evergreen vs trendy (Claude)
│   ├── thumbnail-analyzer.js   # visual analysis (Claude Vision)
│   └── similarity-checker.js   # compare vs own content (Claude)
├── sheets/                 # Google Sheet integration
│   ├── setup.js            # One-time sheet formatting
│   ├── sync.js             # Write results to sheet
│   └── read-flags.js       # Read team flags/reminders from sheet
├── reporters/
│   ├── weekly-digest.js    # Generate summary report
│   └── reminder-sender.js  # Check due reminders
├── dashboard/              # Web UI
│   ├── server.js           # Express-like HTTP server
│   └── index.html          # Single-page dashboard
├── workers/                # Scheduling
│   ├── scheduler-worker.js # Weekly cron (PM2)
│   ├── run-once.js         # Full pipeline, one shot
│   └── seed-once.js        # Seed crawl for initial data
├── db/
│   ├── database.js         # SQLite init + all queries
│   └── schema.sql          # Table definitions
└── ecosystem.config.cjs    # PM2 config
```

---

## Data Pipeline

```
youtube-search.js     →  video-details.js    →  channel-details.js
(search API, returns     (batch stats, stores    (subs, avg views,
 Map<id, metadata>)       to videos table,        trimmed mean from
                          sets duration_seconds,   last 10 uploads)
                          is_short, search_term,
                          country)

         ↓                        ↓                       ↓

outlier-detector.js  →  view-velocity.js  →  virality-scorer.js
(views/channel ratio,   (views/day with      (composite 0-100:
 small channel bonus)    recency multiplier)   outlier 35% +
                                               velocity 35% +
                                               engagement 15% +
                                               topic history 15%)

         ↓

content-categorizer.js    thumbnail-analyzer.js    similarity-checker.js
(Claude: evergreen vs      (Claude Vision: text,    (Claude: compare vs
 trendy + freshness)        face, colors, formula)    own channel content)

         ↓

sheets/sync.js  →  reporters/weekly-digest.js
(write to Google     (generate summary, save to DB)
 Sheet, sorted by
 virality score)
```

### Key Data Flow Detail

`youtube-search.js` returns a `Map<videoId, { searchTerm, region, language }>` — not just an array of IDs. This metadata flows through `video-details.js` which stores `search_term`, `country`, `language` on each video row. The `virality-scorer.js` uses `search_term` for topic bonus calculation.

---

## Database (SQLite)

File: `yt-scout.db` (auto-created on first run)

### Tables

| Table | Purpose |
|-------|---------|
| `videos` | All discovered YouTube videos with stats, duration_seconds, is_short |
| `channels` | Channel info: subscribers, avg_views (trimmed mean) |
| `scores` | Outlier score, view velocity, virality score, content type, thumbnail analysis |
| `own_videos` | Creator's own channel videos (for similarity detection) |
| `similarity_flags` | Videos similar to own content (>60% match) |
| `search_runs` | Audit trail: which term+region combos were crawled and when |
| `reports` | Weekly digest reports (JSON + summary text) |
| `user_flags` | Dashboard favorites/saved/dismissed (created by dashboard server) |

### Key Columns on `videos`

- `duration_seconds` — parsed from ISO 8601 duration, set by video-details.js
- `is_short` — 1 if YouTube Short (detected by #shorts tag OR duration < 180s)
- `search_term` — which search keyword found this video
- `country` — which region it was found in

---

## Scoring Formulas

### Outlier Score
```
subscriber_ratio = views / channel_subscribers
avg_ratio = views / channel_avg_views
outlier_score = (subscriber_ratio * 0.4) + (avg_ratio * 0.6)
```
- Minimum 3.0 to qualify as outlier
- 1.5x bonus for channels < 50K subscribers

### View Velocity
```
views_per_day = views / days_since_publish
adjusted = views_per_day * recency_multiplier
```
Recency multipliers: <48h = 2x, <7d = 1.5x, <30d = 1x, <90d = 0.7x, >90d = 0.4x

### Virality Score (0-100)
```
virality = outlier_percentile(35%) + velocity_percentile(35%)
         + engagement_ratio(15%) + topic_history_bonus(15%)
```
Percentile-ranked within the current batch.

---

## Shorts vs Long-form Detection

YouTube Shorts are detected by:
1. Title or tags contain `#shorts` or `#short`
2. Duration under 180 seconds (3 minutes)

During crawling, the YouTube API `videoDuration` parameter is set to `medium` (4-20 min) and `long` (20+ min) to exclude Shorts at the API level. The `is_short` column is set during `video-details.js` collection.

---

## YouTube API Quota

**Free tier: 10,000 units/day. Resets at midnight Pacific.**

| API Call | Cost | Typical per run |
|----------|------|----------------|
| search.list | 100 units | ~40 calls = 4,000 |
| videos.list (batch 50) | 1 unit | ~50 calls = 50 |
| channels.list (batch 50) | 1 unit | ~50 calls = 50 |
| playlistItems.list | 1 unit | ~20 calls = 20 |
| **Total** | | **~4,100 units** |

Budget cap: 8,000 units/run (lib/youtube.js tracks internally and throws if exceeded).

### Crawl Strategy
- 20 search terms x 10 regions = 200 possible combos
- Each combo = 2 API calls (medium + long duration)
- Crawl dedup: `search_runs` table tracks which term+region was crawled and when
- Only crawls combos not visited in the last 7 days (3 days for seed)
- **Priority order**: US → GB → CA → AU → IN → DE → BR → JP → ES → KR

---

## Google Sheet Structure

| Tab | Purpose | Updated by |
|-----|---------|-----------|
| Content Library | Main database: thumbnail, title, stats, virality score | Bot (sync.js) |
| Trending Topics | Weekly topic aggregation | Bot (sync.js) |
| Thumbnail Patterns | Common winning thumbnail formulas | Bot (sync.js) |
| Own Content | Creator's published videos | Bot (sync.js) |
| Reminders | Auto-populated from Status=Remind rows | Bot (sync.js) |

### Team Interaction (Content Library)
- **Status column** (dropdown): New / Saved / Remind / Used / Skip
- **Remind Date**: Set a date → bot checks daily and logs reminders
- **Notes**: Free text

---

## Web Dashboard

`npm run dashboard` → http://localhost:3456

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Summary stats (filtered by format) |
| `/api/topics` | GET | Trending topics with own channel overlay |
| `/api/videos` | GET | Videos with filters (sort, score, subs, age, language, flag) |
| `/api/flag` | POST | Set favorite/saved/dismissed on a video |
| `/api/predict` | POST | Title virality checker (based on DB similarity) |
| `/api/crawl-estimate` | GET | Check DB coverage for a topic |
| `/api/languages` | GET | Available languages in DB |

### Dashboard Features
- **Long-form / Shorts tabs** — separate views, defaults to long-form
- **Trend Topics** — topic cards with own channel opportunity overlay
- **Outlier Grid** — 4-card grid sorted by xChannel ratio
- **Quick Filters** — Micro Outliers, Rising Fast, Proven Hits, Hidden Gems
- **Title Virality Checker** — test title ideas against DB
- **Manual Crawl** — check DB coverage, shows crawl recommendation
- **Favorite/Save/Dismiss** — per-video actions, persisted in DB

---

## npm Scripts

| Script | Purpose |
|--------|---------|
| `npm run dashboard` | Start web dashboard on port 3456 |
| `npm run seed` | Seed crawl (multi-window, uses ~7K quota) |
| `npm run full-run` | Full pipeline: crawl + score + analyze + sheet sync |
| `npm run search` | Just YouTube search |
| `npm run details` | Just video detail fetch |
| `npm run channels` | Just channel detail fetch |
| `npm run own-channel` | Crawl creator's own channel |
| `npm run analyze` | Run outlier + velocity + virality scoring |
| `npm run categorize` | Claude: evergreen vs trendy classification |
| `npm run analyze-thumbs` | Claude Vision: thumbnail analysis |
| `npm run similarity` | Claude: check similarity to own content |
| `npm run sync` | Push to Google Sheet |
| `npm run refresh-sheet` | Clear + rewrite entire sheet |
| `npm run report` | Generate weekly digest |
| `npm run report:latest` | Print latest report to terminal |
| `npm run check-reminders` | Check due reminders from sheet |
| `npm start` | Start cron scheduler (PM2 entry point) |

---

## PM2 Deployment

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Auto-start on boot
```

Schedule: Monday 5 AM (weekly crawl), Daily 9 AM (reminders).
PM2 auto-restarts the process every Monday at 4 AM.

---

## Initial Data Seeding

The DB currently has **829 videos** from the first seed. To build up to 10K+:

```bash
# Run once per day (quota resets midnight Pacific)
npm run seed

# Check progress
node -e "import('./db/database.js').then(m => console.log(m.getDb().prepare('SELECT COUNT(*) as c FROM videos').get()))"
```

Each seed run adds ~300-800 new videos depending on how many combos haven't been crawled yet. After 5-7 days of daily seeding, you'll have 3-5K videos.

---

## Claude API Usage

Used for 3 optional features (bot works without it, just skips AI analysis):

1. **Content categorization** — classifies videos as evergreen vs trendy. Batches 12 videos per call. ~4 calls per run.
2. **Thumbnail analysis** — Claude Vision analyzes top 25 thumbnails. 25 calls per run.
3. **Similarity check** — compares top 30 videos against own channel. ~6 calls per run.

Estimated cost per weekly run: ~$0.50-1.00 (Sonnet).

---

## Known Limitations

1. **312 channels missing subscriber counts** — YouTube API quota ran out during initial seed before all channels could be detailed. Fix: run `npm run channels` after quota resets.

2. **OWN_CHANNEL_ID not set** — The Finanzfluss channel hasn't been crawled yet. Once set, `npm run own-channel` will populate the own_videos table and the "Your channel: X videos" overlay will show real data.

3. **Shorts detection is heuristic** — YouTube API doesn't expose an `isShort` field. We detect by `#shorts` tag + duration < 3 min. Some 2-3 min horizontal videos may be misclassified.

4. **Virality score is relative** — Scores are percentile-ranked within the current batch. As the DB grows, scores will shift. A video scoring 70 today might score 60 with more data.

5. **Google Sheet limited to 500 rows** — Sheet shows top 500 by virality. Full data is in SQLite (queryable via dashboard).

---

## Future Enhancements

- [ ] Email digest via Resend (infrastructure ready, just needs API key)
- [ ] Telegram notifications (pattern exists in other projects)
- [ ] Vercel deployment for dashboard (currently local only)
- [ ] Manual crawl button in dashboard (currently shows coverage, crawl requires CLI)
- [ ] Multi-channel support (crawl competitor channels too)
- [ ] Historical tracking (re-fetch video stats weekly to track growth curves)
- [ ] Thumbnail A/B testing suggestions based on pattern analysis

---

## File-by-File Reference

### lib/youtube.js
YouTube API wrapper. Internal quota counter. Throws `"Quota limit"` error when approaching 8K. `resetQuota()` must be called at start of each run.

### lib/claude.js
Three functions: `analyze()` (text), `analyzeJson()` (structured), `analyzeImage()` (vision). Auto-extracts JSON from markdown code blocks.

### lib/config.js
All tunable constants: search terms, regions (priority-ordered), thresholds, multipliers. Change `SEARCH_TERMS` to customize for different niches.

### db/database.js
SQLite singleton with WAL mode. Named exports for every table operation. Schema auto-inits from `schema.sql` on first connection.

### collectors/youtube-search.js
Two modes: `run()` (weekly, 35 combos max) and `seed()` (initial, 13 combos x 3 time windows). Both return `Map<videoId, metadata>`. Tracks crawled combos in `search_runs` to avoid overlap.

### analyzers/virality-scorer.js
The core scoring algorithm. Percentile-ranked composite of outlier ratio, view velocity, engagement, and topic history. Writes to `scores.virality_score`.

### dashboard/server.js
Single-file HTTP server. No Express. Serves `index.html` and JSON APIs. Backfills legacy data on startup (duration_seconds, is_short). Port 3456.

---

*A gift from cat* 🐱💝
