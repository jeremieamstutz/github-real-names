# GitHub Real Names

A modern Chrome extension that replaces GitHub usernames with real names (display names) throughout the GitHub interface.

![Extension Icon](icons/icon128.png)

## Features

✨ **Modern & Efficient**
- Built with Manifest V3 (latest Chrome extension standard)
- Uses MutationObserver for real-time updates (no polling)
- Smart caching to minimize API requests
- Async/await for clean, modern JavaScript

🎯 **Comprehensive Coverage**
- Profile links and author names
- Issue and PR creators
- Commit authors
- User mentions (@username)
- Assignees and reviewers
- Discussion participants
- Timeline items

⚡ **Performance Optimized**
- WeakSet for tracking processed elements
- Batch processing to avoid UI blocking
- Persistent cache using chrome.storage
- Rate limit awareness

🎨 **User Friendly**
- Clean, modern popup interface
- Toggle on/off with one click
- Clear cache functionality
- Hover to see username when showing real names

## Installation

### From Source (Development)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/jeremieamstutz/github-real-names.git
   cd github-real-names
   ```

2. Open Chrome and navigate to `chrome://extensions/`

3. Enable "Developer mode" (toggle in top-right corner)

4. Click "Load unpacked" button

5. Select the `github-real-names` directory

6. The extension is now installed! You should see the 👤 icon in your extensions toolbar

## Usage

1. **Navigate to GitHub**: Visit any GitHub page (github.com)

2. **Automatic Replacement**: Usernames will automatically be replaced with real names

3. **Toggle Feature**: Click the extension icon in your toolbar to:
   - Turn real names on/off
   - Clear the cache
   - View current status

4. **Hover for Username**: When real names are shown, hover over any name to see the original username in a tooltip

## How It Works

1. **Detection**: The extension uses MutationObserver to detect username elements as they appear on the page

2. **Extraction**: Usernames are extracted from various element types (links, mentions, etc.)

3. **Fetching**: Real names are fetched from the GitHub API (`https://api.github.com/users/[username]`)

4. **Caching**: Names are cached in both memory and chrome.storage to minimize API calls

5. **Display**: Elements are updated with real names, with original usernames available on hover

## Configuration

The extension works out of the box with no configuration needed. However, you can:

- **Toggle the feature**: Use the popup to turn real names on/off
- **Clear cache**: Force refresh of all cached names
- **Rate limiting**: GitHub API allows 60 requests/hour for unauthenticated requests. The extension caches aggressively to stay within limits.

### Optional: GitHub Personal Access Token

To increase API rate limits from 60 to 5,000 requests per hour:

1. Create a Personal Access Token at https://github.com/settings/tokens (no scopes needed)
2. You would need to modify `content.js` to include the token in API requests

*Note: We don't include this by default for security reasons*

## Browser Compatibility

- ✅ Chrome 88+
- ✅ Edge 88+
- ✅ Brave
- ✅ Any Chromium-based browser with Manifest V3 support

## Privacy & Security

- **No data collection**: This extension doesn't collect or transmit any personal data
- **Local storage only**: All caching is done locally on your machine
- **Open source**: All code is available for inspection
- **Minimal permissions**: Only requests necessary permissions (storage, github.com access)

## Development

### Project Structure

```
github-real-names/
├── manifest.json       # Extension manifest (Manifest V3)
├── content.js          # Content script (runs on GitHub pages)
├── background.js       # Service worker (background tasks)
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic
├── icons/              # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md           # This file
```

### Making Changes

1. Edit the relevant files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension card
4. Reload any GitHub pages to see changes

### Testing

Test on various GitHub pages:
- User profiles
- Repository pages
- Issues and Pull Requests
- Commit history
- Discussion threads
- Search results

## Troubleshooting

**Names not showing?**
- Check that the extension is enabled (green toggle in popup)
- Clear cache and reload the page
- Check browser console for any errors

**Rate limited?**
- The extension caches names to avoid repeated API calls
- You may see `403` errors in the console if rate limited
- Wait an hour or add a personal access token (see Configuration)

**Extension not loading?**
- Ensure Developer mode is enabled
- Check for errors in `chrome://extensions/`
- Try removing and re-adding the extension

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT License - feel free to use and modify as needed.

## Credits

Based on the original concept, modernized with current best practices and Chrome extension standards.

---

Made with ❤️ for the GitHub community

