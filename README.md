# Open WebUI Chrome Extension

> **Note**: This is an enhanced fork of the [Open WebUI Extension](https://github.com/open-webui/extension) with additional security features and improvements. All credit goes to the amazing [Open WebUI](https://github.com/open-webui/open-webui) team for building this incredible ecosystem!

A Chrome extension that provides quick access to Open WebUI with a spotlight-style search interface. Select text on any webpage and get AI-powered responses directly in your input fields, or open searches in Open WebUI.

![Extension Demo](./demo.gif)

## 🎉 Credits & Acknowledgments

This extension is built on top of the excellent work by the [Open WebUI](https://github.com/open-webui/open-webui) project. Open WebUI is an extensible, feature-rich, and user-friendly self-hosted WebUI designed to operate entirely offline. It supports various LLM runners, including Ollama, OpenAI, and more.

**Original Project**: [open-webui/extension](https://github.com/open-webui/extension)  
**Open WebUI**: [open-webui/open-webui](https://github.com/open-webui/open-webui)  
**Main Developer**: [Tim J. Baek](https://github.com/timjbaek) - Original extension developer

## ✨ Enhancements in This Fork

This fork includes several security and feature enhancements:

### 🔐 Security Enhancements

- **API Key Encryption**: API keys are encrypted using AES-256-GCM before storage, providing an additional layer of security beyond Chrome's built-in storage encryption
- **Rate Limiting**: Implemented sensible rate limits to prevent API abuse:
  - Chat completions: 10 requests per minute
  - Model fetching: 5 requests per minute
  - General API calls: 20 requests per minute
- **SSRF Protection**: URL validation prevents Server-Side Request Forgery attacks
- **Input Validation & Sanitization**: All user inputs are validated and sanitized before being sent to APIs
- **Content Security Policy (CSP)**: CSP configured and validated for secure content loading
- **Message Action Validation**: Strict validation of all messages between content scripts and background worker
- **Comprehensive Security Documentation**: See [SECURITY.md](./SECURITY.md) for detailed security information

### 🚀 Feature Enhancements

- **Conversation History**: Full conversation history with context preservation for multi-turn interactions
- **Follow-up Questions**: Ask follow-up questions directly in the response popup without starting a new conversation
- **Response Popup**: Dedicated popup modal for AI responses with streaming display
- **Copy Conversation**: One-click copy of entire conversation history
- **Sidebar with Page Context**: Side panel chat that can include the current tab’s content as optional context on your first message, so you can ask about the page or have any conversation
- **Explain This**: Right-click on selected text to get AI-powered explanations with definitions, examples, and related concepts
- **Summarize Page**: Right-click on any page to get an AI-generated summary of the page content
- **Improved Error Handling**: User-friendly error messages, especially for rate limit violations
- **Better UX**: Auto-focus on input fields, improved keyboard shortcuts, and smoother interactions

### 📋 Technical Improvements

- **Better Error Recovery**: Graceful handling of extension context invalidation
- **Improved DOM Timing**: Better handling of DOM readiness for content script injection
- **Enhanced Keyboard Shortcuts**: More reliable shortcut handling using Chrome's Commands API
- **Streaming Response Improvements**: Better handling of streaming AI responses with proper cleanup

For a complete list of security features and implementation details, see [SECURITY.md](./SECURITY.md).

## Features

### Core Features (from Original Project)

- **Spotlight Search**: Press `Cmd/Ctrl + Shift + K` to open a quick search interface
- **Text Selection**: Automatically captures selected text when opening the search
- **Direct AI Responses**: Use `Cmd/Ctrl + Shift + Enter` to get AI responses written directly into active input/textarea fields
- **Open WebUI Integration**: Seamlessly connects to your Open WebUI instance
- **Model Selection**: Choose from available models in your Open WebUI setup
- **Streaming Responses**: Real-time streaming of AI responses

### Enhanced Features (This Fork)

- **Conversation History**: Maintains full conversation context across multiple interactions
- **Follow-up Questions**: Ask follow-up questions in the response popup
- **Response Popup**: Dedicated modal for viewing AI responses with conversation history
- **Sidebar Panel**: Open the same AI chat in Chrome’s side panel (`Cmd/Ctrl + Shift + L`) or via context menu. On your first message, the current tab’s page content is included as optional context so you can ask about the page or have any conversation
- **Explain This**: Context menu option to explain selected text with AI-powered explanations
- **Summarize Page**: Context menu option to summarize entire web pages
- **Encrypted Storage**: API keys encrypted with AES-256-GCM
- **Rate Limiting**: Protection against API abuse
- **Enhanced Security**: Multiple layers of security validation and protection

## Prerequisites

- **Node.js** (v16 or higher) and **npm**
- **Chrome/Chromium-based browser** (Manifest V3 compatible)
- **Open WebUI instance** with API access

## Installation

### 1. Clone the Repository

```bash
git clone <repository-url>
cd extension
```

### 2. Install Dependencies

Navigate to the `extension` directory and install the required packages:

```bash
cd extension
npm install
```

### 3. Build the Extension

Build the Svelte application:

```bash
npm run build
```

This will create the production build in `extension/dist/` directory with:
- `main.js` - The compiled JavaScript bundle
- `style.css` - The compiled CSS styles

### 4. Load the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the root `extension` directory (the one containing `manifest.json`)
5. The extension should now appear in your extensions list

## Configuration

### First-Time Setup

1. **Open the extension**: Press `Cmd/Ctrl + Shift + K` on any webpage
2. **Enter your Open WebUI URL**: 
   - Example: `http://localhost:8080` or `https://your-open-webui-instance.com`
   - Do not include a trailing slash
3. **Enter your API Key**: Your Open WebUI API key
4. **Fetch Models**: Click the refresh icon next to the API key field to load available models
5. **Select a Model**: Choose your preferred model from the dropdown
6. **Save**: Click the checkmark to save your configuration

### Resetting Configuration

To reset your configuration:
- Press `Cmd/Ctrl + Shift + K` to open the search
- Press `Shift + Escape` while the search is open
- This will clear all stored settings and show the configuration screen again

## Usage

### Opening the Search Interface

- **Keyboard Shortcut**: `Cmd/Ctrl + Shift + K`
- The search interface will appear as an overlay on the current page
- If you have text selected, it will automatically populate the search field

### Searching in Open WebUI

1. Open the search interface (`Cmd/Ctrl + Shift + K`)
2. Type your query (or use selected text)
3. Press `Enter` to open the search in a new Open WebUI tab

### Getting AI Responses Directly

1. Select text on any webpage
2. Press `Cmd/Ctrl + Shift + Enter`
3. A popup will appear showing the streaming AI response
4. **Ask Follow-up Questions**: Type a follow-up question in the input field at the bottom of the popup
5. Press `Enter` or click "Send" to continue the conversation
6. The conversation history is maintained, so the AI has full context
7. Press `Escape` to close the popup

**Note**: The response can also be written directly to active input/textarea fields if one is focused.

### Using the Sidebar

- **Keyboard Shortcut**: `Cmd/Ctrl + Shift + L` to open the Open WebUI sidebar in Chrome’s side panel
- **Context Menu**: Right-click on a page and choose **"Open sidebar"** under "OpenWebUI Extension"
- The sidebar provides the same search and chat interface in a persistent side panel
- **Page context**: You can have any conversation in the sidebar. When you send your **first message**, the extension includes the text content of the **current tab** as context for the model. If your questions relate to the page (e.g. summarize, explain, or tasks based on it), the model uses that content; otherwise you can chat about anything and the model will respond normally. Follow-up messages in the same conversation keep the page context available

### Using Context Menu Features

The extension adds context menu options under "OpenWebUI Extension":

#### Explain This

1. **Select text** on any webpage that you want explained
2. **Right-click** on the selected text
3. Choose **"Explain This"** from the context menu
4. A popup will appear with an AI-powered explanation that includes:
   - Clear definitions and explanations
   - Examples to illustrate concepts
   - Related ideas and concepts
   - Background information and context
5. You can ask follow-up questions in the popup
6. Press `Escape` to close the popup

**Note**: "Explain This" only appears when text is selected.

#### Summarize Page

1. **Right-click** anywhere on a webpage (no text selection needed)
2. Choose **"Summarize Page"** from the context menu
3. The extension will extract the main content from the page
4. A popup will appear with an AI-generated summary
5. You can ask follow-up questions about the summary
6. Press `Escape` to close the popup

**Note**: The summarization focuses on main content and ignores navigation, ads, footers, and other non-content elements.

### Closing the Search

- Press `Escape` to close the search interface or response popup
- Click outside the modal to close it

## Development

### Project Structure

```
extension/
├── manifest.json          # Chrome extension manifest
├── background.js          # Service worker for extension
├── content.js             # Content script injected into web pages
├── images/                # Extension icons
└── extension/             # Svelte application
    ├── src/
    │   ├── App.svelte     # Main application component
    │   ├── main.ts        # Application entry point (page overlay)
    │   ├── sidebar.ts     # Side panel entry point
    │   └── lib/
    │       ├── components/  # Svelte components
    │       ├── apis/       # API integration
    │       └── utils/      # Utility functions
    ├── sidebar.html       # Side panel HTML template
    ├── dist/              # Build output (main.js, style.css, sidebar.html)
    └── package.json      # Dependencies and scripts
```

### Development Workflow

1. **Make changes** to files in `extension/src/`
2. **Build the extension**:
   ```bash
   cd extension
   npm run build
   ```
3. **Reload the extension** in Chrome:
   - Go to `chrome://extensions/`
   - Click the refresh icon on the extension card
4. **Test your changes** on a webpage

### Available Scripts

In the `extension/` directory:

- `npm run dev` - Start Vite development server (for testing outside extension context)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run check` - Run Svelte type checking
- `npm test` - Run unit tests (Vitest)
- `npm run test:coverage` - Run tests with coverage report
- `npm run test:watch` - Run tests in watch mode
- `npm run test:deps` - Run dependency audit (`npm audit`) for known vulnerabilities

### Testing

The project uses **Vitest** for unit tests. Security-sensitive logic is covered so regressions are caught early.

| What's tested | Location |
|---------------|----------|
| URL validation (SSRF), rate-limit config, validated fetch URLs | `src/lib/background-helpers.test.js` |
| API layer (getModels, chat completion, Chrome API handling) | `src/lib/apis/index.test.js` |
| Stream parsing, markdown rendering (including safe escaping) | `src/lib/utils/index.test.js` |

### CI (GitHub Actions)

On **push** and **pull_request** to `main` or `master`, the [CI workflow](.github/workflows/ci.yml) runs:

1. **Install** – `npm ci`
2. **Dependency audit** – `npm audit --audit-level=high` (fails only on high/critical)
3. **Type check** – `npm run check`
4. **Build** – `npm run build`
5. **Unit tests** – `npm test`

Merging a PR into the default branch triggers the same workflow via push.

### Development Tips

- After building, always reload the extension in Chrome to see changes
- Check the browser console for any errors
- The extension uses Chrome Storage API for configuration persistence
- Content scripts are injected into all pages (`<all_urls>`)

## Troubleshooting

### Extension Not Loading

- Ensure you've built the extension (`npm run build` in the `extension/` directory)
- Check that `extension/dist/main.js` and `extension/dist/style.css` exist
- Verify you're loading the correct directory (the one with `manifest.json`)

### API Connection Issues

- Verify your Open WebUI URL is correct and accessible
- Check that your API key is valid
- Ensure CORS is properly configured on your Open WebUI instance
- Check the browser console for specific error messages

### Keyboard Shortcuts Not Working

- Some websites may intercept keyboard shortcuts
- Try on a different page or website
- Ensure no other extensions are conflicting with the shortcuts

### Models Not Loading

- Verify your API key has the correct permissions
- Check that your Open WebUI instance is running and accessible
- Ensure the `/api/models` endpoint is available

## Browser Compatibility

- Chrome 88+ (Manifest V3 support required)
- Edge 88+ (Chromium-based)
- Other Chromium-based browsers with Manifest V3 support

## Permissions

The extension requires the following permissions:

- `storage` - To save your Open WebUI configuration
- `scripting` - To interact with web pages and inject content
- `host_permissions: <all_urls>` - To work on all websites
- Content scripts on all URLs - To provide the search interface

## Security

This fork includes comprehensive security enhancements. For detailed security information, see [SECURITY.md](./SECURITY.md).

**Key Security Features**:
- ✅ AES-256-GCM encryption for API keys
- ✅ Rate limiting to prevent abuse
- ✅ SSRF protection via URL validation
- ✅ Input sanitization and validation
- ✅ Content Security Policy (CSP)
- ✅ Message action validation

## Changelog

### 2026-02-14
- Added sidebar panel: open with `Ctrl+Shift+L` / `Cmd+Shift+L` or via "Open sidebar" context menu
- Sidebar page context: on the first message in a conversation, the current tab’s extracted text is included as optional context so users can ask about the page or have any conversation; the model uses page content when questions relate to it
- Custom system prompt for sidebar that supports both page-related and general conversation
- Unified keyboard shortcuts in documentation: spotlight search `Ctrl+Shift+K`, sidebar `Ctrl+Shift+L`
- Updated project structure in README to include sidebar entry point and build output

### 2026-01-02
- Enhanced UI responsiveness and user experience with improved modal styles and thinking animation
- Implemented state management improvements for response handling in SpotlightSearch component
- Added thinking text indicator and follow-up input features for better conversation flow
- Refactored CSS for improved layout and accessibility
- Updated .gitignore to include the '_old' directory for better file management
- Fixed CSS linting warnings for Tailwind CSS directives (`@tailwind` at-rules)

### 2025-11-23
- Enhanced Chrome API availability checks across the extension to improve error handling and user experience
- Updated styles for better readability in markdown content
- Adjusted color schemes for UI elements
- Refactored code to ensure secure interactions with Chrome storage and APIs

### 2025-11-18
- Added comprehensive security enhancements: API key encryption (AES-256-GCM), rate limiting, CSP validation, and security fixes
- Added 'Explain This' feature to context menu for AI-powered text explanations
- Enhanced 'Summarize Page' functionality with improved content extraction
- Added 'Continue in OpenWebUI' button to transfer conversation to OpenWebUI
- Fixed context menu registration: created as separate top-level items instead of parent-child structure
- Improved context menu registration error handling with proper async handling
- Added comprehensive comments documenting all enhancements throughout codebase
- Updated README to credit Open WebUI and highlight enhancements
- Added Tim J. Baek to Acknowledgments section

## License

Copyright (c) 2023-2025 Timothy Jaeryang Baek (Open WebUI)

This project is licensed under the same terms as the original [Open WebUI Extension](https://github.com/open-webui/extension). See [LICENSE](./LICENSE) for full license details.

**Important**: This license requires maintaining "Open WebUI" branding in all distributions. The extension name, descriptions, and user-facing text preserve the Open WebUI branding as required by the license terms.

## Contributing

This is a fork with enhancements. If you'd like to contribute:

1. **To this fork**: Feel free to open issues or pull requests here
2. **To the original project**: Consider contributing to [open-webui/extension](https://github.com/open-webui/extension) for features that benefit everyone
3. **To Open WebUI**: Check out [open-webui/open-webui](https://github.com/open-webui/open-webui) for the main project

## Differences from Original

This fork focuses on:
- **Security**: Enhanced encryption, validation, and protection mechanisms
- **User Experience**: Conversation history, follow-up questions, and improved UI
- **Reliability**: Better error handling and recovery mechanisms

If you prefer the original version without these enhancements, check out the [original extension](https://github.com/open-webui/extension).
