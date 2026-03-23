-- YouTube videos discovered by the bot
CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  youtube_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  published_at TEXT NOT NULL,
  channel_id INTEGER REFERENCES channels(id),
  views INTEGER DEFAULT 0,
  likes INTEGER DEFAULT 0,
  comments INTEGER DEFAULT 0,
  duration TEXT,
  language TEXT,
  country TEXT,
  thumbnail_path TEXT,
  search_term TEXT,
  discovered_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- YouTube channels
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  youtube_channel_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  subscribers INTEGER DEFAULT 0,
  avg_views INTEGER DEFAULT 0,
  total_videos INTEGER DEFAULT 0,
  country TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Scoring and analysis
CREATE TABLE IF NOT EXISTS scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL UNIQUE REFERENCES videos(id),
  outlier_score REAL,
  view_velocity REAL,
  virality_score REAL,
  content_type TEXT,
  freshness_window TEXT,
  thumbnail_analysis TEXT,
  categorization_notes TEXT,
  scored_at TEXT DEFAULT (datetime('now'))
);

-- Creator's own videos
CREATE TABLE IF NOT EXISTS own_videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  youtube_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  tags TEXT,
  published_at TEXT,
  views INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Similarity between discovered and own content
CREATE TABLE IF NOT EXISTS similarity_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id),
  own_video_id INTEGER NOT NULL REFERENCES own_videos(id),
  similarity_score REAL,
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(video_id, own_video_id)
);

-- Search run audit trail
CREATE TABLE IF NOT EXISTS search_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date TEXT NOT NULL,
  search_term TEXT NOT NULL,
  region TEXT,
  results_count INTEGER DEFAULT 0,
  quota_used INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Weekly reports
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date TEXT NOT NULL,
  report_json TEXT,
  summary TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_videos_youtube_id ON videos(youtube_id);
CREATE INDEX IF NOT EXISTS idx_videos_published ON videos(published_at);
CREATE INDEX IF NOT EXISTS idx_videos_channel ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_channels_yt_id ON channels(youtube_channel_id);
CREATE INDEX IF NOT EXISTS idx_scores_virality ON scores(virality_score DESC);
CREATE INDEX IF NOT EXISTS idx_scores_type ON scores(content_type);
CREATE INDEX IF NOT EXISTS idx_search_runs_date ON search_runs(run_date);
