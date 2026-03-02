# pi-extension-diffs

A [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent) extension that adds a `/diffs` command to view git changes in a native macOS window.

Browse staged, unstaged, and untracked changes alongside branch commits — all rendered with syntax-highlighted diffs in a fast, native WKWebView window powered by [Glimpse](https://github.com/HazAT/glimpse).

## Features

- **`/diffs` command** — opens a native macOS window showing all git changes
- **Commit navigator** — browse up to 5 commits on your branch, or last 5 on main
- **Working changes** — staged, unstaged, and untracked files grouped by section
- **Sidebar + tabs** — click files to open as tabs, switch between them instantly
- **Syntax highlighting** — full Shiki-powered highlighting via [@pierre/diffs](https://www.npmjs.com/package/@pierre/diffs)
- **Prewarm** — hidden window pre-loads the viewer on startup for near-instant `/diffs`
- **Persistent window** — updates in place if already open, re-preloads after close

## Install

```bash
pi install pi-extension-diffs
```

Or add to your pi settings manually:

```jsonc
// ~/.pi/agent/settings.json
{
  "packages": [
    "pi-extension-diffs"
  ]
}
```

Then restart pi or run `/reload`.

## Requirements

- **macOS** — uses native WKWebView windows via Glimpse
- **git** — must be in a git repository
- **bun** — required for building the viewer bundle (runs automatically on install)

## Usage

```
/diffs
```

That's it. The window shows:

1. **Commit list** at the top of the sidebar — your branch's commits (vs main/master) or last 5 if on main
2. **Working Changes** entry if you have uncommitted changes (staged/unstaged/untracked)
3. **File list** below — click to open files as tabs with syntax-highlighted diffs

Switching between commits updates the file list. Tabs clear when you change commits.

## Development

```bash
git clone https://github.com/HazAT/pi-extension-diffs.git
cd pi-extension-diffs
npm install  # installs deps + builds viewer bundle
```

To rebuild the viewer after making changes to `src/viewer.tsx`:

```bash
npm run build
```

Then point pi at your local clone:

```jsonc
// ~/.pi/agent/settings.json
{
  "packages": [
    "/path/to/pi-extension-diffs"
  ]
}
```

## How it works

The extension has two parts:

- **`src/index.ts`** — pi extension that registers `/diffs`, gathers git data, manages the Glimpse window, and injects data into the viewer
- **`src/viewer.tsx`** — React app bundled into `dist/viewer.js` at build time, rendering diffs with `@pierre/diffs` components

On startup, a hidden window pre-loads the 10MB viewer bundle (which includes Shiki grammars for syntax highlighting). When you run `/diffs`, git data is injected and the window appears instantly.

## License

MIT
