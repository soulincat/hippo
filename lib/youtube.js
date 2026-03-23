import { google } from 'googleapis';
import { MAX_QUOTA_PER_RUN } from './config.js';

let _youtube = null;
let _quotaUsed = 0;

function getClient() {
  if (_youtube) return _youtube;
  _youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY,
  });
  return _youtube;
}

function checkQuota(cost) {
  if (_quotaUsed + cost > MAX_QUOTA_PER_RUN) {
    throw new Error(`Quota limit: ${_quotaUsed}/${MAX_QUOTA_PER_RUN} used, need ${cost} more`);
  }
  _quotaUsed += cost;
}

export function getQuotaUsed() {
  return _quotaUsed;
}

export function resetQuota() {
  _quotaUsed = 0;
}

/**
 * Search for videos. Cost: 100 units per call.
 */
export async function search(query, opts = {}) {
  checkQuota(100);
  const yt = getClient();
  const params = {
    part: 'snippet',
    q: query,
    type: 'video',
    maxResults: opts.maxResults || 50,
    order: opts.order || 'viewCount',
    videoCategoryId: opts.categoryId,
    regionCode: opts.regionCode,
    relevanceLanguage: opts.language,
    publishedAfter: opts.publishedAfter,
    publishedBefore: opts.publishedBefore,
    // videoDuration: 'medium' = 4-20min, 'long' = 20+min, 'short' = <4min
    // Default to 'medium' to focus on long-form and exclude YouTube Shorts
    videoDuration: opts.videoDuration || 'medium',
  };
  // Remove undefined
  Object.keys(params).forEach(k => params[k] === undefined && delete params[k]);

  const res = await yt.search.list(params);
  return (res.data.items || []).map(item => ({
    videoId: item.id.videoId,
    channelId: item.snippet.channelId,
    title: item.snippet.title,
    description: item.snippet.description,
    publishedAt: item.snippet.publishedAt,
    channelTitle: item.snippet.channelTitle,
  }));
}

/**
 * Get detailed stats for videos. Cost: 1 unit per call (batch up to 50).
 */
export async function getVideoDetails(videoIds) {
  if (!videoIds.length) return [];
  checkQuota(1);
  const yt = getClient();
  const res = await yt.videos.list({
    part: 'snippet,statistics,contentDetails',
    id: videoIds.join(','),
  });
  return (res.data.items || []).map(item => ({
    videoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    tags: item.snippet.tags || [],
    publishedAt: item.snippet.publishedAt,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    defaultLanguage: item.snippet.defaultLanguage || item.snippet.defaultAudioLanguage || null,
    views: parseInt(item.statistics.viewCount || '0'),
    likes: parseInt(item.statistics.likeCount || '0'),
    comments: parseInt(item.statistics.commentCount || '0'),
    duration: item.contentDetails.duration,
  }));
}

/**
 * Get channel details. Cost: 1 unit per call (batch up to 50).
 */
export async function getChannelDetails(channelIds) {
  if (!channelIds.length) return [];
  checkQuota(1);
  const yt = getClient();
  const res = await yt.channels.list({
    part: 'snippet,statistics,contentDetails',
    id: channelIds.join(','),
  });
  return (res.data.items || []).map(item => ({
    channelId: item.id,
    name: item.snippet.title,
    country: item.snippet.country || null,
    subscribers: parseInt(item.statistics.subscriberCount || '0'),
    totalVideos: parseInt(item.statistics.videoCount || '0'),
    totalViews: parseInt(item.statistics.viewCount || '0'),
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads || null,
  }));
}

/**
 * Get uploads from a channel's uploads playlist. Cost: 1 unit per call.
 */
export async function getPlaylistItems(playlistId, maxResults = 10) {
  if (!playlistId) return [];
  checkQuota(1);
  const yt = getClient();
  const res = await yt.playlistItems.list({
    part: 'snippet',
    playlistId,
    maxResults,
  });
  return (res.data.items || []).map(item => ({
    videoId: item.snippet.resourceId.videoId,
    title: item.snippet.title,
    publishedAt: item.snippet.publishedAt,
    channelId: item.snippet.channelId,
  }));
}

/**
 * Get all uploads from a playlist with pagination. Cost: 1 unit per page.
 */
export async function getAllPlaylistItems(playlistId) {
  const yt = getClient();
  const items = [];
  let pageToken = undefined;

  do {
    checkQuota(1);
    const res = await yt.playlistItems.list({
      part: 'snippet',
      playlistId,
      maxResults: 50,
      pageToken,
    });
    for (const item of (res.data.items || [])) {
      items.push({
        videoId: item.snippet.resourceId.videoId,
        title: item.snippet.title,
        publishedAt: item.snippet.publishedAt,
      });
    }
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  return items;
}
