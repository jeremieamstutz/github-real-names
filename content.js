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
  
  // Timeline items - author names and commit links
  'a.Link--primary[href^="/"][href*="/commits?author="]',
  '.TimelineItem .commit-author',
  
  // Review requests and mentions in timeline
  '.TimelineItem a.Link--primary:not(:has(img)):not(:has(svg))',
  '.TimelineItem a.Link--secondary:not(:has(img)):not(:has(svg))',
  '.TimelineItem a.author:not(:has(img)):not(:has(svg))',
  
  // Specific text-only username links
  'a[data-hovercard-type="user"]:not(:has(img)):not(:has(svg))',
  'a[data-hovercard-url*="/users/"]:not(:has(img)):not(:has(svg))',
  '.TimelineItem-body a[data-hovercard-type="user"]:not(:has(img)):not(:has(svg))',
  '.BorderGrid-cell a[data-hovercard-type="user"]:not(:has(img)):not(:has(svg))',
  
  // Simple profile links (e.g., /username) - filtered by extractUsername to avoid false positives
  'a[href^="/"]:not(:has(img)):not(:has(svg))',
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
  
  // Special case: Timeline items (commits in PRs, etc.)
  const timelineItem = element.closest('.TimelineItem');
  if (timelineItem) {
    const href = element.getAttribute('href');
    
    // Skip commit messages (these point to commit SHAs)
    if (href && (href.includes('/commit/') || href.includes('/commits/') || /\/[a-f0-9]{40}/.test(href))) {
      return null;
    }
    
    // For commit authors, try to match against the avatar
    if (element.classList.contains('commit-author')) {
      const avatarLink = timelineItem.querySelector('a[data-hovercard-type="user"]');
      if (avatarLink) {
        const avatarHref = avatarLink.getAttribute('href');
        if (avatarHref) {
          const match = avatarHref.match(/^\/([^\/\?#]+)$/);
          if (match && match[1]) {
            const username = match[1];
            if (text.toLowerCase() === username.toLowerCase()) {
              return username;
            }
          }
        }
      }
    }
    
    // For other links (review requests, etc.), continue with normal processing
  }
  
  // Check for href attribute
  const href = element.getAttribute('href');
  if (href) {
    // Skip commit SHAs and other non-user URLs
    if (href.includes('/commit/') || href.includes('/commits/') || /\/[a-f0-9]{40}$/.test(href)) {
      return null;
    }
    
    // Decode the URL to handle encoded characters
    const decodedHref = decodeURIComponent(href);
    
    // Check for author in query (supports both author=username and author:username)
    const authorMatch = decodedHref.match(/author[=:]([^+&\s]+)/);
    if (authorMatch && authorMatch[1]) {
      return authorMatch[1];
    }
    
    // Check for standard user path (e.g., /username or /username/repo)
    const pathMatch = href.match(/^\/([^\/\?#]+)(?:\/|$|\?|#)/);
    if (pathMatch && pathMatch[1]) {
      const segment = pathMatch[1];
      
      // Exclude common GitHub system paths
      const excludedPaths = [
        'orgs', 'organizations', 'settings', 'notifications', 'issues', 'pulls',
        'explore', 'topics', 'trending', 'collections', 'events', 'marketplace',
        'sponsors', 'about', 'pricing', 'team', 'enterprise', 'customer-stories',
        'security', 'features', 'codespaces', 'copilot', 'search', 'watching',
        'stars', 'new', 'login', 'logout', 'signup', 'join', 'sessions'
      ];
      
      if (!excludedPaths.includes(segment.toLowerCase())) {
        return segment;
      }
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
    element.removeAttribute('title'); // Clear tooltip when showing username
  } else {
    // Show real name
    element.textContent = realName;
    element.title = `@${username}`; // Show username in tooltip
  }
}

// Process all username elements on the page
async function processPage() {
  const elements = document.querySelectorAll(USERNAME_SELECTORS);
  
  if (elements.length === 0) return;
  
  console.log(`[GitHub Real Names] Processing ${elements.length} elements`);
  
  // Process in larger batches and use requestIdleCallback for better performance
  const batchSize = 50;
  const elementsArray = Array.from(elements);
  
  for (let i = 0; i < elementsArray.length; i += batchSize) {
    const batch = elementsArray.slice(i, i + batchSize);
    
    // Process batch without awaiting - let them run in parallel
    batch.forEach(el => updateElement(el));
    
    // Yield to browser between batches using requestIdleCallback if available
    if (i + batchSize < elementsArray.length) {
      await new Promise(resolve => {
        if ('requestIdleCallback' in window) {
          requestIdleCallback(resolve);
        } else {
          setTimeout(resolve, 0);
        }
      });
    }
  }
}

// Toggle between real names and usernames
function toggleDisplay() {
  // Update all processed elements
  const processedElements = document.querySelectorAll('[data-github-realnames-username]');
  console.log(`[GitHub Real Names] Toggling ${processedElements.length} elements. Enabled: ${isEnabled}`);
  
  processedElements.forEach(element => {
    const username = element.getAttribute('data-github-realnames-username');
    const realName = nameCache.get(username) || username;
    updateElementDisplay(element, username, realName);
  });
}

// Set up MutationObserver to watch for new content
function setupObserver() {
  let debounceTimer = null;
  let pendingElements = new Set();
  
  const processPendingElements = () => {
    if (pendingElements.size === 0) return;
    
    const elements = Array.from(pendingElements);
    pendingElements.clear();
    
    // Process elements asynchronously
    elements.forEach(el => updateElement(el));
  };
  
  const observer = new MutationObserver((mutations) => {
    // Skip processing if extension is disabled
    if (!isEnabled) return;
    
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if the node itself matches
          if (node.matches?.(USERNAME_SELECTORS)) {
            pendingElements.add(node);
          }
          // Check for matching children
          const children = node.querySelectorAll?.(USERNAME_SELECTORS);
          if (children) {
            children.forEach(child => pendingElements.add(child));
          }
        }
      }
    }
    
    // Debounce processing to avoid excessive updates
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(processPendingElements, 100);
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
  
  // Set up observer for dynamic content immediately
  setupObserver();
  
  // Process initial page content after a short delay to not block page load
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => processPage(), { timeout: 2000 });
  } else {
    setTimeout(() => processPage(), 100);
  }
  
  console.log('[GitHub Real Names] Extension initialized');
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggle') {
    console.log(`[GitHub Real Names] Received toggle message. New state: ${message.enabled}`);
    isEnabled = message.enabled;
    toggleDisplay();
    sendResponse({ success: true });
  } else if (message.action === 'getState') {
    sendResponse({ enabled: isEnabled });
  }
  return true;
});

// Start the extension
console.log('[GitHub Real Names] Content script loaded');

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

