'use strict';

// Constants
const MAX_USERNAME_LENGTH = 39; // GitHub's username length limit
const BATCH_SIZE = 50;
const DEBOUNCE_DELAY = 100;
const IDLE_TIMEOUT = 2000;
const INITIAL_DELAY = 100;

const EXCLUDED_PATHS = new Set([
  'orgs', 'organizations', 'packages', 'projects', 'teams',
  'settings', 'notifications', 'issues', 'pulls',
  'explore', 'topics', 'trending', 'collections', 'events', 'marketplace',
  'sponsors', 'about', 'pricing', 'team', 'enterprise', 'customer-stories',
  'security', 'features', 'codespaces', 'copilot', 'search', 'watching',
  'stars', 'new', 'login', 'logout', 'signup', 'join', 'sessions'
]);

const NAVIGATION_PATTERNS = /^(open|view|edit|delete|close|save|cancel|submit|packages|settings|notifications|explore|search|issues|pull requests|discussions|actions|projects|wiki|security|insights|new|create|fork|star|watch|code|commit|branch|tag|release)($|\s)/i;

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
  if (element.querySelector('img, svg')) return false;
  if (!text) return false;
  if (isExcludedPath(href)) return false;
  if (isButtonElement(element)) return false;
  if (text.length > MAX_USERNAME_LENGTH + 1) return false;
  if (isNavigationText(text)) return false;
  
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
async function fetchRealName(username) {
  if (!username || nameCache.has(username)) {
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
    if (stored[username]?.name) {
      realName = stored[username].name;
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
  const isMention = element.classList.contains('user-mention');
  
  // Show username if disabled or no real name available
  if (!isEnabled || realName === username) {
    element.textContent = isMention ? `@${username}` : username;
    element.removeAttribute('title');
    return;
  }
  
  // Show real name with username in tooltip
  element.textContent = realName;
  element.title = `@${username}`;
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
function toggleDisplay() {
  const elementsToToggle = document.querySelectorAll('[data-github-realnames-username]');
  console.log(`[GitHub Real Names] Toggling ${elementsToToggle.length} elements. Enabled: ${isEnabled}`);
  
  elementsToToggle.forEach(element => {
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
    debounceTimer = setTimeout(processPendingElements, DEBOUNCE_DELAY);
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
    requestIdleCallback(() => processPage(), { timeout: IDLE_TIMEOUT });
  } else {
    setTimeout(() => processPage(), INITIAL_DELAY);
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
  } else if (message.action === 'refreshCache') {
    console.log(`[GitHub Real Names] Refreshing cache and re-fetching all names`);
    // Clear in-memory name cache to force re-fetch
    nameCache.clear();
    // Clear processed elements to re-process everything
    processedElements = new WeakSet();
    // Re-process the page
    processPage();
    sendResponse({ success: true });
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

