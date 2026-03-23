# YT Trend Scout — User Guide

**What it does:** Automatically finds YouTube videos in personal finance that are going viral — especially from small channels where the *topic + title + thumbnail* carried the performance, not the audience size. Helps you discover proven content ideas before making your own videos.

**Live dashboard:** https://hippo-beryl-five.vercel.app
**Google Sheet:** https://docs.google.com/spreadsheets/d/1dIN4KQuY7W1TheMiHYngj7beXQfMCQwt1pDsFwjMr2E/edit
**GitHub repo:** https://github.com/soulincat/hippo

---

## How to Use the Dashboard

### 1. Understanding the Layout

When you open the dashboard, you see:

```
[Header]         — Total videos crawled, last crawl date, region coverage
[Title Checker]  — Test your video title ideas (type + press Enter)
[Crawl Info]     — Shows the automated schedule
[Long-form / Shorts tabs] — Toggle between regular videos and YouTube Shorts
[Stats Bar]      — Videos count, hot videos, outliers, avg score
[Quick Filters]  — One-click preset filters (blue buttons)
[View Tabs]      — Trend Topics | Outliers | All Videos | Saved | Favorites
[Content Area]   — The actual data (changes based on selected view)
```

### 2. Start with Trend Topics (Default View)

Each topic card shows:
- **Topic name** (e.g., "Save Money", "Invest", "Frugal")
- **Video count** — how many videos we found for this topic
- **Avg score** — average virality score across all videos in this topic
- **Top score** — the highest-scoring video
- **Avg views** — average view count
- **Your channel: X videos** — how many videos YOU have on this topic
- **Opportunity badge:**
  - 🟢 **Untapped** = You have 0 videos + market score is high → GO MAKE THIS
  - 🟠 **Underexplored** = You have 1-2 videos → room for more
  - ⚪ **Well covered** = You have 5+ videos → maybe skip

**Click any topic card** to see all videos in that topic.

### 3. Outlier View — The Gold Mine

Click **"Outliers"** tab. This shows thumbnail cards sorted by how much a video outperformed its channel. A video from a 5K subscriber channel getting 2M views = massive outlier. The topic/thumbnail *carried* that video.

- **Score badge** (top-left of thumbnail) = Virality score (0-100)
- **xChannel badge** (top-right) = How many times this outperformed the channel average
- Filter by channel size using the **"Min subs"** dropdown

### 4. Quick Filter Buttons

| Button | What it finds |
|--------|--------------|
| **Micro Outliers** | Small channels (<50K subs) with disproportionate views |
| **Rising Fast** | Videos published in last 7 days, sorted by velocity |
| **Proven Hits (70+)** | Videos with virality score 70+ (top tier) |
| **Hidden Gems** | Tiny channels (<10K subs) with unexpectedly high views |
| **Reset Filters** | Back to default Trend Topics view |

### 5. All Videos View

Full searchable/filterable list. Controls:
- **Search box** — filter by title keywords
- **Sort** — Viral Score, Outliers, Velocity, Views, Newest
- **Score** — Minimum virality score (30+, 50+, 70+)
- **Channel** — Max subscriber count (to focus on small channels)
- **Age** — Video age (7 days, 14 days, 30 days, 90 days)
- **Language** — Filter by content language

### 6. Save & Favorite Videos

Hover over any video card to see action buttons:
- ⭐ **Star** = Add to Favorites (your top picks for content inspiration)
- 🔗 **Save** = Bookmark for later review
- ✕ **Dismiss** = Remove from results (won't show again)

Access your saved content via the **"Saved"** and **"Favorites"** tabs.

### 7. Title Virality Checker

The orange bar at the top lets you test title ideas:
1. Type a video title idea (e.g., "How I Saved $50K in 2 Years")
2. Press Enter or click "Check Score"
3. It shows:
   - **Predicted score** based on similar titles in the database
   - **Confidence level** (high/medium/low based on how many similar titles exist)
   - **Top similar videos** that already performed well

### 8. Manual Crawl

Click **"+ Manual Crawl"** button to:
1. Enter a keyword you want to research
2. Select a region
3. Click "Check DB Coverage" to see how much data we have
4. If not enough data, the tool tells you to run more crawls

---

## Understanding the Numbers

### Virality Score (0-100)

A composite score predicting how likely a content topic/format is to go viral. Calculated from:

| Component | Weight | What it means |
|-----------|--------|---------------|
| Outlier ratio | 35% | How much the video outperforms its channel |
| View velocity | 35% | Views per day, adjusted for video age |
| Engagement | 15% | Likes + comments relative to views |
| Topic history | 15% | Have similar topics scored well before? |

**Guide:** 70+ = Hot, 50-69 = Strong, 30-49 = Average, <30 = Weak

### xChannel

How many times a video outperformed its channel's average views. Example:
- Channel usually gets 10K views per video
- This video got 500K views
- xChannel = **50x**

Higher = the topic/thumbnail carried the video, not the channel's existing audience. This is the most important metric for finding content ideas.

### Views/Day

Raw views divided by days since publish. A video with 1M views in 3 days (333K/day) is more impressive than 1M views in 300 days (3.3K/day).

The score applies a **recency bonus**:
- Published < 2 days ago: 2x multiplier (still accelerating)
- < 7 days: 1.5x
- < 30 days: 1x (baseline)
- < 90 days: 0.7x (slowing)
- > 90 days: 0.4x (old, natural accumulation)

---

## How the Data is Collected

### Weekly Automated Crawl (Every Monday)

```
5:00 AM  — Crawl creator's own channel (for comparison)
5:15 AM  — Search YouTube: 20 keywords × 10 regions
6:00 AM  — Fetch detailed stats for all discovered videos
6:30 AM  — Fetch channel subscriber counts + avg views
7:00 AM  — Score: outlier detection + view velocity + virality
8:00 AM  — AI analysis: evergreen vs trendy (optional, uses Claude)
8:30 AM  — Download + analyze thumbnails (optional, uses Claude)
9:30 AM  — Sync top 500 results to Google Sheet
10:00 AM — Generate weekly digest report
```

### What Gets Searched

**20 keywords:**
budget, invest, passive income, save money, credit card, debt, side hustle, financial independence, retirement, real estate, stock market, crypto, money management, wealth, tax, ETF, index fund, frugal, emergency fund, mortgage

**10 regions (priority order):**
1. 🇺🇸 US, 🇬🇧 UK, 🇨🇦 Canada, 🇦🇺 Australia (English-first)
2. 🇮🇳 India (large English-speaking audience)
3. 🇩🇪 Germany (Finanzfluss home market)
4. 🇧🇷 Brazil, 🇯🇵 Japan, 🇪🇸 Spain, 🇰🇷 Korea

### YouTube API Quota

The YouTube Data API is **free** — 10,000 quota units per day, resets at midnight Pacific time. Each weekly crawl uses ~4,100 units. No credit card needed.

To build up the initial library faster, run `npm run seed` once per day for a week (uses ~7,000 units per run).

---

## Google Sheet

The Google Sheet is a **shared team workspace**. The bot writes data to it weekly, and the team can:

| Tab | What's in it |
|-----|-------------|
| **Content Library** | Top 500 videos by virality score with thumbnails, stats, and team columns |
| **Trending Topics** | Weekly topic aggregation — what's hot this week |
| **Thumbnail Patterns** | Common winning thumbnail formulas |
| **Own Content** | Your channel's published videos (for comparison) |
| **Reminders** | Topics you flagged to revisit later |

### Team Columns (you edit these)

- **Status** dropdown: New / Saved / Remind / Used / Skip
- **Remind Date**: Set a future date → bot will surface it when due
- **Notes**: Free text for your team's comments

---

## Two Ways to Access

| | Web Dashboard | Google Sheet |
|---|---|---|
| **URL** | https://hippo-beryl-five.vercel.app | [Google Sheet link](https://docs.google.com/spreadsheets/d/1dIN4KQuY7W1TheMiHYngj7beXQfMCQwt1pDsFwjMr2E/edit) |
| **Best for** | Exploring, filtering, discovering trends | Team collaboration, flagging, reminders |
| **Interactive** | Search, filter, quick presets, outlier grid | Edit status, set remind dates, add notes |
| **Updates** | Snapshot (refreshed after crawls) | Live (bot writes directly) |
| **Favorites/Save** | Works locally, read-only on Vercel | Use Status dropdown |

---

## For Developers

See **[HANDOVER.md](HANDOVER.md)** for the full technical documentation:
- Architecture and data pipeline
- Scoring formulas
- Database schema
- API endpoints
- Deployment and PM2 setup
- Known limitations

### Quick Commands

```bash
npm run dashboard       # Local dashboard with full features (http://localhost:3456)
npm run seed            # Crawl more data (run daily to build library)
npm run full-run        # Full pipeline: crawl + score + sheet sync
npm run build-static    # Export DB snapshot for Vercel
npm run analyze         # Re-run scoring on existing data
npm run sync            # Push latest data to Google Sheet
npm run refresh-sheet   # Clear + rewrite entire Google Sheet
npm run report:latest   # Print latest weekly digest to terminal
```

---

*A gift from cat* 🐱💝
