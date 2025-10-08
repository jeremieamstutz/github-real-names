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

