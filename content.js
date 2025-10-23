'use strict';

// Constants
const MAX_USERNAME_LENGTH = 39; // GitHub's username length limit
const BATCH_SIZE = 50;
const DEBOUNCE_DELAY = 100;
const INITIAL_DELAY = 0; // Process immediately after cache is loaded

const EXCLUDED_PATHS = new Set([
  'orgs', 'organizations', 'packages', 'projects', 'teams',
  'settings', 'notifications', 'issues', 'pulls',
  'explore', 'topics', 'trending', 'collections', 'events', 'marketplace',
  'sponsors', 'about', 'pricing', 'team', 'enterprise', 'customer-stories',
  'security', 'features', 'codespaces', 'copilot', 'search', 'watching',
  'stars', 'new', 'login', 'logout', 'signup', 'join', 'sessions', 'community'
]);

const NAVIGATION_PATTERNS = /^(open|view|edit|delete|close|save|cancel|submit|packages|settings|notifications|explore|search|issues|pull requests|discussions|actions|projects|wiki|security|insights|new|create|fork|star|watch|code|commit|branch|tag|release)($|\s)/i;

// State management
let isEnabled = true;
const nameCache = new Map();
let processedElements = new WeakSet();

// Selectors for different types of username elements on GitHub
// We use simple selectors and filter out images in isValidUsernameElement()
const USERNAME_SELECTORS = [
  // User-specific links (most reliable)
  'a[data-hovercard-type="user"]',
  'a[data-hovercard-url*="/users/"]',
  
  // User mentions
  'a.user-mention',
  
  // Common author/contributor classes
  'a.author',
  'a.commit-author',
  'a.author-link',
  
  // Profile links
  'a[itemprop="author"]',
  
  // General GitHub user links - will be filtered by validation logic
  'a[href^="/"]',
].join(', ');

// Helper functions
function textMatchesUsername(text, username) {
  return text.toLowerCase() === username.toLowerCase();
}

function isNavigationText(text) {
  return NAVIGATION_PATTERNS.test(text) || /\s\d+$/.test(text);
}

function isExcludedPath(href) {
  if (!href) return false;
  
  return href.startsWith('/orgs/') || 
         href.startsWith('/organizations/') ||
         href.includes('/packages') ||
         href.includes('/projects') ||
         href.includes('/teams');
}

function isButtonElement(element) {
  return element.tagName === 'BUTTON' || 
         element.getAttribute('role') === 'button' ||
         element.classList.contains('btn') ||
         element.classList.contains('Button') ||
         element.closest('button');
}

function isCommitUrl(href) {
  if (!href) return false;
  return href.includes('/commit/') || 
         href.includes('/commits/') || 
         /\/[a-f0-9]{40}/.test(href);
}

function isValidUsernameElement(element, text, href) {
  // Skip if element itself is an image or SVG
  if (element.tagName === 'IMG' || element.tagName === 'SVG') return false;
  
  // Skip if no text content
  if (!text) return false;
  
  // Skip excluded paths (orgs, packages, etc.)
  if (isExcludedPath(href)) return false;
  
  // Skip buttons and interactive elements
  if (isButtonElement(element)) return false;
  
  // Skip if text is too long to be a username
  if (text.length > MAX_USERNAME_LENGTH + 1) return false;
  
  // Skip navigation text
  if (isNavigationText(text)) return false;
  
  // Skip if element has an avatar or profile image class (the container itself)
  if (element.classList.contains('avatar') || 
      element.classList.contains('avatar-user') ||
      element.closest('.avatar, .avatar-user')) return false;
  
  return true;
}

function extractUsernameFromHref(href, text, element) {
  if (!href) return null;
  
  if (isCommitUrl(href)) return null;
  
  const decodedHref = decodeURIComponent(href);
  
  // Check for author in query (supports both author=username and author:username)
  const authorMatch = decodedHref.match(/author[=:]([^+&\s]+)/);
  if (authorMatch && authorMatch[1]) {
    const username = authorMatch[1];
    if (textMatchesUsername(text, username)) {
      return username;
    }
  }
  
  // Check for standard user path (e.g., /username or /username/repo)
  const pathMatch = href.match(/^\/([^\/\?#]+)(?:\/|$|\?|#)/);
  if (pathMatch && pathMatch[1]) {
    const segment = pathMatch[1];
    
    if (!EXCLUDED_PATHS.has(segment.toLowerCase())) {
      if (textMatchesUsername(text, segment)) {
        return segment;
      }
    }
  }
  
  return null;
}

function extractUsernameFromTimelineCommit(element, text, timelineItem) {
  if (!element.classList.contains('commit-author')) {
    return null;
  }
  
  const avatarLink = timelineItem.querySelector('a[data-hovercard-type="user"]');
  if (!avatarLink) return null;
  
  const avatarHref = avatarLink.getAttribute('href');
  if (!avatarHref) return null;
  
  const match = avatarHref.match(/^\/([^\/\?#]+)$/);
  if (!match || !match[1]) return null;
  
  const username = match[1];
  if (textMatchesUsername(text, username)) {
    return username;
  }
  
  return null;
}

function extractUsernameFromAttributes(element, text) {
  const dataUser = element.getAttribute('data-user');
  if (dataUser) return dataUser;
  
  // Only extract from text content for specific elements
  if (element.classList.contains('user-mention') || 
      element.classList.contains('assignee') ||
      element.getAttribute('itemprop') === 'author') {
    return text.startsWith('@') ? text.slice(1) : text;
  }
  
  return null;
}

// Extract username from various element types
function extractUsername(element) {
  const text = element.textContent?.trim();
  const href = element.getAttribute('href');
  
  // Early validation checks
  if (!isValidUsernameElement(element, text, href)) {
    return null;
  }
  
  // Special case: Timeline items (commits in PRs, etc.)
  const timelineItem = element.closest('.TimelineItem');
  if (timelineItem) {
    if (isCommitUrl(href)) {
      return null;
    }
    
    const timelineUsername = extractUsernameFromTimelineCommit(element, text, timelineItem);
    if (timelineUsername) {
      return timelineUsername;
    }
  }
  
  // Try to extract from href
  const hrefUsername = extractUsernameFromHref(href, text, element);
  if (hrefUsername) {
    return hrefUsername;
  }
  
  // Try to extract from data attributes or text content
  return extractUsernameFromAttributes(element, text);
}

// Fetch real name from GitHub API with rate limiting awareness
async function fetchRealName(username, skipCache = false) {
  if (!username) return null;
  
  if (!skipCache && nameCache.has(username)) {
    return nameCache.get(username);
  }
  
  try {
    // Get token from storage if available
    const { githubToken } = await chrome.storage.local.get('githubToken');
    
    // Build headers
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
    };
    
    if (githubToken) {
      // Use correct auth format based on token type
      // Classic tokens (ghp_): use "token" prefix
      // Fine-grained tokens (github_pat_): use "Bearer" prefix
      if (githubToken.startsWith('github_pat_')) {
        headers['Authorization'] = `Bearer ${githubToken}`;
      } else {
        headers['Authorization'] = `token ${githubToken}`;
      }
    }
    
    const response = await fetch(`https://api.github.com/users/${username}`, { headers });
    
    // Track rate limit info from response headers
    const rateLimitLimit = response.headers.get('X-RateLimit-Limit');
    const rateLimitRemaining = response.headers.get('X-RateLimit-Remaining');
    const rateLimitReset = response.headers.get('X-RateLimit-Reset');
    
    if (rateLimitLimit && rateLimitRemaining && rateLimitReset) {
      await chrome.storage.local.set({
        rateLimitData: {
          limit: parseInt(rateLimitLimit, 10),
          remaining: parseInt(rateLimitRemaining, 10),
          reset: parseInt(rateLimitReset, 10),
        }
      });
    }
    
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        const hasToken = !!githubToken;
        console.warn(`[GitHub Real Names] Rate limited. ${hasToken ? 'Token may be invalid or expired.' : 'Consider adding a GitHub token.'}`);
      } else if (response.status === 401) {
        console.warn(`[GitHub Real Names] Authentication failed. Token may be invalid.`);
      }
      // Cache the username itself to avoid repeated failures
      nameCache.set(username, username);
      await chrome.storage.local.set({ 
        [username]: { name: username, timestamp: Date.now() }
      });
      return username;
    }
    
    const data = await response.json();
    const realName = data.name || username;
    
    // Cache both in memory and storage with timestamp
    nameCache.set(username, realName);
    await chrome.storage.local.set({ 
      [username]: { name: realName, timestamp: Date.now() }
    });
    
    return realName;
  } catch (error) {
    console.error(`[GitHub Real Names] Error fetching name:`, error);
    // Cache the username itself to avoid repeated failures
    nameCache.set(username, username);
    await chrome.storage.local.set({ 
      [username]: { name: username, timestamp: Date.now() }
    });
    return username;
  }
}

// Stale-while-revalidate: Check if cache entry should be revalidated
// Revalidate entries older than 24 hours
const REVALIDATE_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

async function revalidateIfStale(username, timestamp) {
  const now = Date.now();
  const age = now - timestamp;
  
  // If entry is older than 24 hours, revalidate in background
  if (age > REVALIDATE_AGE_MS) {
    // Fire and forget - don't await
    fetchRealName(username, true).catch(err => {
      console.error(`[GitHub Real Names] Background revalidation failed for ${username}:`, err);
    });
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
  
  // Get real name from memory cache first (instant for pre-loaded values)
  let realName = nameCache.get(username);
  
  if (realName) {
    // Cache hit - update immediately (no delay)
    updateElementDisplay(element, username, realName);
    
    // Check if we should revalidate in background (stale-while-revalidate)
    const stored = await chrome.storage.local.get(username);
    if (stored[username]?.timestamp) {
      revalidateIfStale(username, stored[username].timestamp);
    }
  } else {
    // Cache miss - show username temporarily, then fetch
    updateElementDisplay(element, username, username);
    
    // Check persistent storage first
    const stored = await chrome.storage.local.get(username);
    if (stored[username]?.name) {
      realName = stored[username].name;
      nameCache.set(username, realName);
      updateElementDisplay(element, username, realName);
      
      // Revalidate if stale
      if (stored[username].timestamp) {
        revalidateIfStale(username, stored[username].timestamp);
      }
    } else {
      // Fetch from API
      realName = await fetchRealName(username);
      updateElementDisplay(element, username, realName);
    }
  }
}

// Find and return all text nodes in an element (excluding nested images/svgs)
function getTextNodes(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip empty text nodes
        if (!node.textContent.trim()) {
          return NodeFilter.FILTER_REJECT;
        }
        // Skip text nodes inside SVG elements
        if (node.parentElement?.closest('svg')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );
  
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }
  
  return textNodes;
}

// Update the visual display of an element by replacing text nodes only
function updateElementDisplay(element, username, realName) {
  const isMention = element.classList.contains('user-mention');
  
  // Find all text nodes in the element
  const textNodes = getTextNodes(element);
  
  if (textNodes.length === 0) {
    // Fallback: if no text nodes found, update the whole element
    if (!isEnabled || realName === username) {
      element.textContent = isMention ? `@${username}` : username;
      element.removeAttribute('title');
    } else {
      element.textContent = realName;
      element.title = `@${username}`;
    }
    return;
  }
  
  // Update each text node that contains the username or real name
  textNodes.forEach(textNode => {
    const text = textNode.textContent.trim();
    const textLower = text.toLowerCase();
    const usernameLower = username.toLowerCase();
    const realNameLower = realName.toLowerCase();
    
    // Check if this text node contains the username OR real name (with or without @)
    // We need to check both because we might be toggling from real name back to username
    const isMatch = textLower === usernameLower || 
                    textLower === `@${usernameLower}` ||
                    textLower === realNameLower ||
                    (isMention && textLower === usernameLower);
    
    if (isMatch) {
      // Preserve leading/trailing whitespace
      const leadingSpace = textNode.textContent.match(/^\s*/)[0];
      const trailingSpace = textNode.textContent.match(/\s*$/)[0];
      
      if (!isEnabled || realName === username) {
        // Show username
        const displayText = isMention ? `@${username}` : username;
        textNode.textContent = leadingSpace + displayText + trailingSpace;
        element.removeAttribute('title');
      } else {
        // Show real name with username in tooltip
        textNode.textContent = leadingSpace + realName + trailingSpace;
        element.title = `@${username}`;
      }
    }
  });
}

// Process all username elements on the page
async function processPage() {
  const elements = document.querySelectorAll(USERNAME_SELECTORS);
  
  if (elements.length === 0) return;
  
  console.log(`[GitHub Real Names] Processing ${elements.length} elements`);
  
  const elementsArray = Array.from(elements);
  
  for (let i = 0; i < elementsArray.length; i += BATCH_SIZE) {
    const batch = elementsArray.slice(i, i + BATCH_SIZE);
    
    // Process batch without awaiting - let them run in parallel
    batch.forEach(el => updateElement(el));
    
    // Yield to browser between batches using requestIdleCallback if available
    if (i + BATCH_SIZE < elementsArray.length) {
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
async function toggleDisplay() {
  // First, update all already-tracked elements
  const elementsToToggle = document.querySelectorAll('[data-github-realnames-username]');
  console.log(`[GitHub Real Names] Toggling ${elementsToToggle.length} elements. Enabled: ${isEnabled}`);
  
  elementsToToggle.forEach(element => {
    const username = element.getAttribute('data-github-realnames-username');
    const realName = nameCache.get(username) || username;
    updateElementDisplay(element, username, realName);
  });
  
  // Then re-process the entire page to catch any elements that weren't tracked
  // (This ensures any dynamically loaded content is also toggled)
  await processPage();
}

// Set up MutationObserver to watch for new content
function setupObserver() {
  let debounceTimer = null;
  let pendingElements = new Set();
  
  const processPendingElements = () => {
    if (pendingElements.size === 0) return;
    
    const elements = Array.from(pendingElements);
    pendingElements.clear();
    
    // Process elements asynchronously - they will respect isEnabled state
    elements.forEach(el => updateElement(el));
  };
  
  const observer = new MutationObserver((mutations) => {
    // Always track elements, but updateElement() will respect isEnabled state
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
    debounceTimer = setTimeout(processPendingElements, DEBOUNCE_DELAY);
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  
  return observer;
}

// Pre-load cache from storage into memory for instant lookups
async function preloadCache() {
  try {
    const items = await chrome.storage.local.get(null);
    const protectedKeys = new Set(['enabled', 'githubToken', 'rateLimitData']);
    
    for (const key in items) {
      if (!protectedKeys.has(key) && items[key]?.name) {
        nameCache.set(key, items[key].name);
      }
    }
    
    console.log(`[GitHub Real Names] Pre-loaded ${nameCache.size} cached names into memory`);
  } catch (error) {
    console.error('[GitHub Real Names] Error pre-loading cache:', error);
  }
}

// Initialize the extension
async function init() {
  // Load enabled state from storage
  const { enabled = true } = await chrome.storage.local.get('enabled');
  isEnabled = enabled;
  
  // Pre-load all cached names into memory for instant updates
  await preloadCache();
  
  // Wait for body to exist before setting up observer
  const startProcessing = () => {
    // Set up observer for dynamic content
    setupObserver();
    
    // Process page immediately (cache is already loaded)
    setTimeout(() => processPage(), INITIAL_DELAY);
  };
  
  if (document.body) {
    startProcessing();
  } else {
    // Wait for body to be available
    const bodyObserver = new MutationObserver(() => {
      if (document.body) {
        bodyObserver.disconnect();
        startProcessing();
      }
    });
    bodyObserver.observe(document.documentElement, { childList: true });
  }
  
  console.log('[GitHub Real Names] Extension initialized');
}

// Listen for messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'toggle') {
    console.log(`[GitHub Real Names] Received toggle message. New state: ${message.enabled}`);
    isEnabled = message.enabled;
    // Call toggleDisplay and send response when done
    toggleDisplay().then(() => {
      sendResponse({ success: true });
    }).catch((error) => {
      console.error('[GitHub Real Names] Error toggling display:', error);
      sendResponse({ success: false, error: error.message });
    });
    return true; // Keep message channel open for async response
  } else if (message.action === 'getState') {
    sendResponse({ enabled: isEnabled });
  } else if (message.action === 'refreshCache') {
    console.log(`[GitHub Real Names] Refreshing cache and re-fetching all names`);
    // Clear in-memory name cache to force re-fetch
    nameCache.clear();
    // Clear processed elements to re-process everything
    processedElements = new WeakSet();
    // Re-process the page
    processPage().then(() => {
      sendResponse({ success: true });
    });
    return true; // Keep message channel open for async response
  }
  return false;
});

// Start the extension immediately to pre-load cache ASAP
console.log('[GitHub Real Names] Content script loaded');
init();

