'use strict';

// State management
let isEnabled = true;
const nameCache = new Map();
const processedElements = new WeakSet();

// Selectors for different types of username elements on GitHub
// Note: We filter out elements with images in extractUsername()
const USERNAME_SELECTORS = [
  // Authors and contributors (text links only)
  'a.author:not([data-hovercard-type="organization"])',
  'a.commit-author',
  
  // User mentions
  'a.user-mention',
  
  // Issue/PR creators
  'a.author-link',
  
  // Assignees and reviewers (text only)
  'a.assignee .css-truncate-target',
  'span.assignee',
  
  // Profile links
  'a[itemprop="author"]',
  
  // Timeline items
  'a.Link--primary[href^="/"][href*="/commits?author="]',
  
  // Specific text-only username links
  'a[data-hovercard-type="user"]:not(:has(img)):not(:has(svg))',
  'a[data-hovercard-url*="/users/"]:not(:has(img)):not(:has(svg))',
  '.TimelineItem-body a[data-hovercard-type="user"]:not(:has(img)):not(:has(svg))',
  '.BorderGrid-cell a[data-hovercard-type="user"]:not(:has(img)):not(:has(svg))',
].join(', ');

// Extract username from various element types
function extractUsername(element) {
  // Skip elements that contain images (avatars)
  if (element.querySelector('img, svg')) {
    return null;
  }
  
  // Skip elements that are mostly empty or just whitespace
  const text = element.textContent?.trim();
  if (!text) {
    return null;
  }
  
  // Check for href attribute first
  const href = element.getAttribute('href');
  if (href) {
    const match = href.match(/^\/([^\/]+)(?:\/|$)/);
    if (match && match[1] && !['orgs', 'organizations'].includes(match[1])) {
      return match[1];
    }
  }
  
  // Check for data attributes
  const dataUser = element.getAttribute('data-user');
  if (dataUser) return dataUser;
  
  // Extract from text content (remove @ if present)
  return text.startsWith('@') ? text.slice(1) : text;
}

// Fetch real name from GitHub API with rate limiting awareness
async function fetchRealName(username) {
  if (!username || nameCache.has(username)) {
    return nameCache.get(username);
  }
  
  try {
    const response = await fetch(`https://api.github.com/users/${username}`);
    
    if (!response.ok) {
      // If rate limited or error, cache the username itself to avoid repeated failures
      if (response.status === 403 || response.status === 429) {
        console.warn('[GitHub Real Names] Rate limited. Consider adding a GitHub token.');
      }
      nameCache.set(username, username);
      await chrome.storage.local.set({ [username]: username });
      return username;
    }
    
    const data = await response.json();
    const realName = data.name || username;
    
    // Cache both in memory and storage
    nameCache.set(username, realName);
    await chrome.storage.local.set({ [username]: realName });
    
    return realName;
  } catch (error) {
    console.error('[GitHub Real Names] Error fetching name:', error);
    nameCache.set(username, username);
    return username;
  }
}

// Update a single element with real name
async function updateElement(element) {
  if (processedElements.has(element)) {
    // Element already processed, just update display based on current state
    const username = element.getAttribute('data-github-realnames-username');
    if (username) {
      const realName = nameCache.get(username) || username;
      updateElementDisplay(element, username, realName);
    }
    return;
  }
  
  const username = extractUsername(element);
  if (!username) return;
  
  // Mark as processed to avoid redundant work
  processedElements.add(element);
  element.setAttribute('data-github-realnames-username', username);
  
  // If disabled, just show username and don't fetch
  if (!isEnabled) {
    updateElementDisplay(element, username, username);
    return;
  }
  
  // Get real name from cache or fetch it
  let realName = nameCache.get(username);
  
  if (!realName) {
    // Check persistent storage first
    const stored = await chrome.storage.local.get(username);
    if (stored[username]) {
      realName = stored[username];
      nameCache.set(username, realName);
    } else {
      // Fetch from API
      realName = await fetchRealName(username);
    }
  }
  
  // Update the display
  updateElementDisplay(element, username, realName);
}

// Update the visual display of an element
function updateElementDisplay(element, username, realName) {
  if (!isEnabled || realName === username) {
    // Show username
    const isMention = element.classList.contains('user-mention');
    element.textContent = isMention ? `@${username}` : username;
  } else {
    // Show real name
    element.textContent = realName;
    element.title = `@${username}`;
  }
}

// Process all username elements on the page
async function processPage() {
  const elements = document.querySelectorAll(USERNAME_SELECTORS);
  
  // Process in batches to avoid blocking
  const batchSize = 20;
  for (let i = 0; i < elements.length; i += batchSize) {
    const batch = Array.from(elements).slice(i, i + batchSize);
    await Promise.all(batch.map(el => updateElement(el)));
    
    // Yield to browser between batches
    if (i + batchSize < elements.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }
}

// Toggle between real names and usernames
function toggleDisplay() {
  document.querySelectorAll('[data-github-realnames-username]').forEach(element => {
    const username = element.getAttribute('data-github-realnames-username');
    const realName = nameCache.get(username) || username;
    updateElementDisplay(element, username, realName);
  });
}

// Set up MutationObserver to watch for new content
function setupObserver() {
  const observer = new MutationObserver((mutations) => {
    // Skip processing if extension is disabled
    if (!isEnabled) return;
    
    const addedElements = [];
    
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if the node itself matches
          if (node.matches?.(USERNAME_SELECTORS)) {
            addedElements.push(node);
          }
          // Check for matching children
          const children = node.querySelectorAll?.(USERNAME_SELECTORS);
          if (children) {
            addedElements.push(...children);
          }
        }
      }
    }
    
    // Process new elements
    if (addedElements.length > 0) {
      Promise.all(addedElements.map(el => updateElement(el)));
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  
  return observer;
}

// Initialize the extension
async function init() {
  // Load enabled state from storage
  const { enabled = true } = await chrome.storage.local.get('enabled');
  isEnabled = enabled;
  
  // Process initial page content
  await processPage();
  
  // Set up observer for dynamic content
  setupObserver();
  
  console.log('[GitHub Real Names] Extension initialized');
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggle') {
    isEnabled = message.enabled;
    toggleDisplay();
    sendResponse({ success: true });
  } else if (message.action === 'getState') {
    sendResponse({ enabled: isEnabled });
  }
  return true;
});

// Start the extension
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

