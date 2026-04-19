# Grace — Svelte App

The Svelte application bundle for the Grace Chrome extension.

## Commands

Run from this directory (`extension/`):

```bash
npm install          # Install dependencies
npm run dev          # Vite dev server on port 5173
npm run build        # Build to dist/ (main app + content IIFE)
npm run check        # Svelte type checking
npm test             # Vitest unit tests
npm run test:watch   # Watch mode
npm run test:coverage  # With coverage report
```

## Build Output

`dist/` is git-ignored. After `npm run build`:

| File | Description |
|------|-------------|
| `dist/main.js` | In-page overlay bundle |
| `dist/sidebar.js` | Side panel bundle |
| `dist/chunk.js` | Shared chunk |
| `dist/style.css` | Compiled styles |
| `dist/index.html` | Overlay HTML |
| `dist/sidebar.html` | Side panel HTML |
| `dist/main-content.js` | IIFE bundle loaded by manifest content script |

## Project Structure

```
src/
├── main.ts            # In-page overlay entry
├── sidebar.ts         # Side panel entry (sidebarMode: true)
├── settings.ts        # Settings page entry
├── App.svelte         # Root component
├── app.css            # Global styles + Grace design tokens
├── global.d.ts        # Window interface extensions
└── lib/
    ├── appearance.ts  # Theme/density/accent logic
    ├── storage.ts     # Storage type definitions
    ├── apis/          # Chrome message API helpers
    ├── components/    # Svelte UI components
    └── utils/         # Stream parsing, markdown rendering
```

## Tests

Tests use Vitest with jsdom. Test files: `src/**/*.test.{js,ts}`.
