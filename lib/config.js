export const SEARCH_TERMS = [
  'how to budget',
  'index fund investing',
  'passive income ideas',
  'how to save money',
  'credit card tips',
  'debt payoff strategy',
  'side hustle ideas',
  'financial independence',
  'retirement planning',
  'real estate investing',
  'stock market for beginners',
  'crypto investing',
  'personal finance tips',
  'money management',
  'frugal living',
  'how to invest',
  'build wealth',
  'financial freedom',
  'tax saving tips',
  'emergency fund',
];

// Priority order: English-speaking regions first, then others
// Crawling processes in order, so if quota runs out, English data is already in
export const REGIONS = [
  // Tier 1: English-speaking (highest priority)
  { code: 'US', language: 'en', tier: 1 },
  { code: 'GB', language: 'en', tier: 1 },
  { code: 'CA', language: 'en', tier: 1 },
  { code: 'AU', language: 'en', tier: 1 },
  // Tier 2: Large English-speaking audiences
  { code: 'IN', language: 'en', tier: 2 },
  // Tier 3: German (Finanzfluss home market)
  { code: 'DE', language: 'de', tier: 3 },
  // Tier 4: Other languages (bonus data)
  { code: 'BR', language: 'pt', tier: 4 },
  { code: 'JP', language: 'ja', tier: 4 },
  { code: 'ES', language: 'es', tier: 4 },
  { code: 'KR', language: 'ko', tier: 4 },
];

// Quota management
export const MAX_QUOTA_PER_RUN = 8000;

// Scoring thresholds
export const MIN_VIEWS_FOR_OUTLIER = 10000;
export const MIN_OUTLIER_RATIO = 3.0;
export const SMALL_CHANNEL_THRESHOLD = 50000;  // subscribers
export const SMALL_CHANNEL_BONUS = 1.5;

// Analysis limits
export const TOP_N_FOR_THUMBNAIL_ANALYSIS = 25;
export const TOP_N_FOR_CATEGORIZATION = 50;
export const TOP_N_FOR_SIMILARITY = 30;
export const TOP_N_FOR_SHEET_SYNC = 500;

// View velocity recency multipliers
export const VELOCITY_MULTIPLIERS = [
  { maxHours: 48, multiplier: 2.0 },
  { maxHours: 168, multiplier: 1.5 },     // 7 days
  { maxHours: 720, multiplier: 1.0 },     // 30 days
  { maxHours: 2160, multiplier: 0.7 },    // 90 days
  { maxHours: Infinity, multiplier: 0.4 },
];
