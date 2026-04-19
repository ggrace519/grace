# Open WebUI Extension - Svelte App

This is the Svelte application component of the Open WebUI Chrome Extension.

## Development

### Prerequisites
- Node.js 18+
- Chrome browser for testing

### Commands

```bash
# Install dependencies
npm install

# Run dev server (opens on port 5173)
npm run dev

# Build for production
npm run build

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Type check
npm run check
```

### Project Structure

```
extension/
├── src/
│   ├── lib/
│   │   ├── apis/          # API utility functions
│   │   ├── components/    # Svelte components
│   │   └── utils/         # Helper utilities
│   ├── App.svelte         # Root component
│   ├── main.ts            # Entry point
│   └── app.css            # Global styles
```

## Build Output

The build outputs to `extension/dist/`. This directory is git-ignored - to rebuild:

```bash
npm run build
```

## Testing

Tests use Vitest with a Node environment. Test files are located at `src/**/*.test.{js,ts}`.

```bash
npm test                    # Run tests once
npm run test:watch         # Watch mode
npm run test:coverage      # With coverage report
```

## Type Checking

```bash
npm run check
```

This uses `svelte-check` with the TS configuration in `tsconfig.json`.
