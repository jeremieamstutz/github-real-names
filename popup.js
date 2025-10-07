'use strict';

const toggleSwitch = document.getElementById('toggleSwitch');
const clearCacheBtn = document.getElementById('clearCache');
const statusContainer = document.getElementById('statusContainer');

// Load current state
async function loadState() {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  toggleSwitch.checked = enabled;
  updateStatus(enabled);
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

// Toggle the extension on/off
toggleSwitch.addEventListener('change', async () => {
  const enabled = toggleSwitch.checked;
  
  // Save to storage
  await chrome.storage.local.set({ enabled });
  
  // Send message to all GitHub tabs
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
  
  for (const tab of tabs) {
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: 'toggle',
        enabled,
      });
    } catch (error) {
      // Tab might not have content script loaded yet
      console.log('Could not send message to tab:', tab.id);
    }
  }
  
  updateStatus(enabled);
});

// Clear cached names
clearCacheBtn.addEventListener('click', async () => {
  const { enabled } = await chrome.storage.local.get('enabled');
  
  // Clear all storage except the enabled setting
  await chrome.storage.local.clear();
  await chrome.storage.local.set({ enabled });
  
  // Reload all GitHub tabs
  const tabs = await chrome.tabs.query({ url: 'https://github.com/*' });
  for (const tab of tabs) {
    chrome.tabs.reload(tab.id);
  }
  
  // Visual feedback
  clearCacheBtn.textContent = '✓ Cache Cleared';
  setTimeout(() => {
    clearCacheBtn.textContent = 'Clear Cache';
  }, 2000);
});

// Initialize
loadState();

