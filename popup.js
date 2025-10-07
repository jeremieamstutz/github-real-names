'use strict';

const toggleSwitch = document.getElementById('toggleSwitch');
const refreshNamesBtn = document.getElementById('refreshNames');
const statusContainer = document.getElementById('statusContainer');
const settingsHeader = document.getElementById('settingsHeader');
const settingsContent = document.getElementById('settingsContent');
const tokenInput = document.getElementById('tokenInput');
const saveTokenBtn = document.getElementById('saveToken');
const removeTokenBtn = document.getElementById('removeToken');
const authStatus = document.getElementById('authStatus');
const rateLimit = document.getElementById('rateLimit');
const remaining = document.getElementById('remaining');
const resetTime = document.getElementById('resetTime');

// Load current state
async function loadState() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  toggleSwitch.checked = enabled;
  updateStatus(enabled);
  
  // Load token status
  await loadTokenStatus();
  
  // Load rate limit info
  await loadRateLimitInfo();
}

// Update status display
function updateStatus(enabled) {
  const statusClass = enabled ? 'enabled' : 'disabled';
  const statusText = enabled ? '✓ Active' : '○ Inactive';
  
  statusContainer.innerHTML = `
    <div class="status ${statusClass}">
      ${statusText}
    </div>
  `;
}

// Load token status
async function loadTokenStatus() {
  const { githubToken } = await chrome.storage.local.get('githubToken');
  
  if (githubToken) {
    tokenInput.value = '••••••••••••••••••••';
    tokenInput.setAttribute('data-has-token', 'true');
  } else {
    tokenInput.value = '';
    tokenInput.removeAttribute('data-has-token');
  }
}

// Load rate limit info
async function loadRateLimitInfo() {
  const { 
    rateLimitData,
    githubToken 
  } = await chrome.storage.local.get(['rateLimitData', 'githubToken']);
  
  const isAuthenticated = !!githubToken;
  
  // Update auth status
  authStatus.textContent = isAuthenticated ? 'Yes ✓' : 'No';
  authStatus.className = 'rate-limit-value ' + (isAuthenticated ? 'auth-yes' : 'auth-no');
  
  if (rateLimitData) {
    const { limit, remaining: rem, reset } = rateLimitData;
    
    // Update rate limit
    rateLimit.textContent = `${limit}/hour`;
    
    // Update remaining with color coding
    remaining.textContent = rem;
    if (rem < 10) {
      remaining.classList.add('auth-no');
    } else if (rem < 100) {
      remaining.classList.add('warning');
    }
    
    // Update reset time
    const resetDate = new Date(reset * 1000);
    const now = new Date();
    const diffMinutes = Math.round((resetDate - now) / 60000);
    
    if (diffMinutes > 60) {
      const hours = Math.round(diffMinutes / 60);
      resetTime.textContent = `in ${hours}h`;
    } else if (diffMinutes > 0) {
      resetTime.textContent = `in ${diffMinutes}m`;
    } else {
      resetTime.textContent = 'now';
    }
  } else {
    rateLimit.textContent = isAuthenticated ? '5,000/hour' : '60/hour';
    remaining.textContent = 'Unknown';
    resetTime.textContent = 'Unknown';
  }
}

// Toggle the extension on/off
toggleSwitch.addEventListener('change', async () => {
  const enabled = toggleSwitch.checked;
  
  console.log('[GitHub Real Names] Toggle switched to:', enabled);
  
  // Save to storage
  await chrome.storage.local.set({ enabled });
  
  // Send message to all GitHub tabs
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
  
  console.log('[GitHub Real Names] Found tabs:', tabs.length);
  
  for (const tab of tabs) {
    try {
      console.log('[GitHub Real Names] Sending message to tab:', tab.id, tab.url);
      const response = await chrome.tabs.sendMessage(tab.id, {
        action: 'toggle',
        enabled,
      });
      console.log('[GitHub Real Names] Response from tab:', tab.id, response);
    } catch (error) {
      // Tab might not have content script loaded yet
      console.error('[GitHub Real Names] Could not send message to tab:', tab.id, error);
    }
  }
  
  updateStatus(enabled);
});

// Refresh all names by clearing cache and re-fetching
refreshNamesBtn.addEventListener('click', async () => {
  const { enabled, githubToken } = await chrome.storage.local.get(['enabled', 'githubToken']);
  
  // Clear all cached names but keep settings
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ enabled, githubToken });
  
  // Notify all GitHub tabs to refresh
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'refreshCache' });
    } catch (error) {
      console.error('Could not notify tab:', tab.id, error);
    }
  }
  
  // Visual feedback
  refreshNamesBtn.textContent = '✓ Refreshed';
  setTimeout(() => {
    refreshNamesBtn.textContent = 'Refresh All Names';
  }, 2000);
});

// Settings section toggle
settingsHeader.addEventListener('click', () => {
  const arrow = settingsHeader.querySelector('.settings-arrow');
  arrow.classList.toggle('expanded');
  settingsContent.classList.toggle('expanded');
});

// Handle token input focus
tokenInput.addEventListener('focus', () => {
  if (tokenInput.getAttribute('data-has-token') === 'true') {
    tokenInput.value = '';
  }
});

// Save token
saveTokenBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  
  if (!token || token === '••••••••••••••••••••') {
    return;
  }
  
  // Validate token format (basic check)
  if (!token.startsWith('ghp_') && !token.startsWith('github_pat_')) {
    alert('Invalid token format. Token should start with "ghp_" or "github_pat_"');
    return;
  }
  
  // Save token
  await chrome.storage.local.set({ githubToken: token });
  
  // Clear all cached names and rate limit data to force re-fetch with new token
  const { enabled } = await chrome.storage.local.get('enabled');
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ enabled, githubToken: token });
  
  // Visual feedback
  saveTokenBtn.textContent = '✓ Saved';
  setTimeout(() => {
    saveTokenBtn.textContent = 'Save';
  }, 2000);
  
  // Reload status
  await loadTokenStatus();
  await loadRateLimitInfo();
  
  // Notify content scripts to clear cache and re-fetch
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'refreshCache' });
    } catch (error) {
      // Tab might not have content script loaded yet
      console.error('Could not notify tab:', tab.id, error);
    }
  }
});

// Remove token
removeTokenBtn.addEventListener('click', async () => {
  if (!confirm('Remove GitHub token? Rate limit will drop to 60 requests/hour.')) {
    return;
  }
  
  // Clear all cached names and token
  const { enabled } = await chrome.storage.local.get('enabled');
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ enabled });
  
  // Visual feedback
  removeTokenBtn.textContent = '✓ Removed';
  setTimeout(() => {
    removeTokenBtn.textContent = 'Remove';
  }, 2000);
  
  // Reload status
  await loadTokenStatus();
  await loadRateLimitInfo();
  
  // Notify content scripts to clear cache
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'refreshCache' });
    } catch (error) {
      // Tab might not have content script loaded yet
      console.error('Could not notify tab:', tab.id, error);
    }
  }
});

// Initialize
loadState();

