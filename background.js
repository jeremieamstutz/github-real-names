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
// So we cache aggressively but clear old entries
chrome.alarms.create('clearOldCache', { periodInMinutes: 1440 }); // Once per day

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'clearOldCache') {
    const items = await chrome.storage.local.get(null);
    const keysToRemove = [];
    
    // Keep 'enabled' setting, remove user cache entries older than 7 days
    for (const key in items) {
      if (key !== 'enabled' && Math.random() < 0.1) {
        // Randomly remove ~10% of entries each day
        keysToRemove.push(key);
      }
    }
    
    if (keysToRemove.length > 0) {
      await chrome.storage.local.remove(keysToRemove);
      console.log(`[GitHub Real Names] Cleared ${keysToRemove.length} cached entries`);
    }
  }
});

