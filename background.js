'use strict';

// Background service worker for GitHub Real Names extension
// Handles installation and updates

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    console.log('[GitHub Real Names] Extension installed');
    
    // Set default state
    chrome.storage.local.set({
      enabled: true,
    });
  } else if (details.reason === 'update') {
    console.log('[GitHub Real Names] Extension updated to', chrome.runtime.getManifest().version);
  }
});

// Clear old cache periodically (keep cache fresh)
// GitHub API rate limit is 60 requests/hour for unauthenticated requests
// and 5,000 requests/hour for authenticated requests with a token
// Cache entries expire after 7 days maximum
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

chrome.alarms.create('clearOldCache', { periodInMinutes: 1440 }); // Once per day

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'clearOldCache') {
    const items = await chrome.storage.local.get(null);
    const keysToRemove = [];
    const now = Date.now();
    
    // Keep 'enabled', 'githubToken', and 'rateLimitData' settings
    // Remove cache entries older than 7 days
    const protectedKeys = new Set(['enabled', 'githubToken', 'rateLimitData']);
    
    for (const key in items) {
      if (!protectedKeys.has(key)) {
        const entry = items[key];
        
        // Check if entry has timestamp and is older than 7 days
        if (typeof entry === 'object' && entry.timestamp) {
          if (now - entry.timestamp > CACHE_MAX_AGE_MS) {
            keysToRemove.push(key);
          }
        }
      }
    }
    
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`[GitHub Real Names] Cleared ${keysToRemove.length} cached entries older than 7 days`);
    }
  }
});

