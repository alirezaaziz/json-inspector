# JSON Inspector Pro

A professional, client-side JSON inspector that runs entirely in the browser. No server, no dependencies, no data leaves your machine.

![JSON Inspector Pro](https://img.shields.io/badge/version-2.0.0-blue) ![License](https://img.shields.io/badge/license-MIT-green) ![Zero dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)

## Features

### Views
| View | Description |
|------|-------------|
| **Tree** | Interactive collapsible tree with lazy rendering for large documents |
| **Raw** | Syntax-highlighted source with line numbers and minify/prettify toggle |
| **Table** | Spreadsheet view for arrays of objects with sortable columns |
| **Diff** | Side-by-side comparison of two JSON documents |

### Inspector Panel
- Click any node to see its **type badge**, full **value**, and **path** in three formats:
  - JSONPath (`$.users[0].name`)
  - JSON Pointer (`/users/0/name`)
  - Bracket notation (`$["users"][0]["name"]`)
- **Edit** any value inline and see the tree update instantly
- **Siblings** panel — navigate to adjacent keys without going back to the root
- **Breadcrumb** trail — click any ancestor to jump directly to it

### Search
- **Text search** — matches across all keys and values simultaneously
- **JSONPath query** — type `$.users[*].email` to highlight only matching nodes
- Keyboard navigation: `Enter` / `Shift+Enter` to move between matches

### Quality of Life
- **Dark / Light theme** with preference saved to `localStorage`
- **Drag & drop** any `.json` file anywhere on the page
- **History** — last 8 inspected documents saved to `localStorage`
- **Sort keys** — original order, A→Z, or Z→A
- **Copy JSON** — prettified or minified to clipboard
- **Download** — save the current (possibly edited) document as a `.json` file
- Detailed **parse error messages** with line/column markers and actionable hints
- Full **keyboard shortcuts** (press `?` to see the cheatsheet)

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `E` | Expand all nodes |
| `C` | Collapse all nodes |
| `1` / `2` / `3` / `4` | Switch to Tree / Raw / Table / Diff view |
| `/` or `Ctrl+F` | Focus search bar |
| `Enter` | Next search match |
| `Shift+Enter` | Previous search match |
| `Esc` | Clear search / close modal |
| `M` | Toggle minify (Raw view) |
| `?` | Show shortcuts panel |
| `Ctrl/Cmd+Enter` | Inspect pasted JSON |

## Getting Started

No build step required. Just open `index.html` in any modern browser.

```bash
git clone https://github.com/your-username/json-inspector.git
cd json-inspector
open index.html        # macOS
# or
xdg-open index.html   # Linux
```

Or serve it locally if you prefer:

```bash
npx serve .
# → http://localhost:3000
```

## Project Structure

```
json-inspector/
├── index.html          # App shell — HTML only, no inline scripts or styles
├── style.css           # All styles (dark + light theme via CSS variables)
└── js/
    ├── utils.js        # Shared utilities and JSON path helpers
    ├── jsonpath.js     # JSONPath expression evaluator
    ├── tree.js         # Tree view rendering and collapse/expand logic
    ├── inspector.js    # Inspector panel, breadcrumb, and inline editor
    ├── search.js       # Text and JSONPath search with match navigation
    ├── views.js        # Raw, Table, and Diff view renderers
    └── app.js          # Global state, event wiring, history, and init
```

No bundler, no framework, no `node_modules`. Each file is a plain script loaded in dependency order.

## JSONPath Support

The search bar accepts a subset of the JSONPath standard:

| Expression | Meaning |
|------------|---------|
| `$` | Root element |
| `$.key` | Child key |
| `$.a.b.c` | Nested path |
| `$[0]` | Array index |
| `$[-1]` | Last element |
| `$.arr[*]` | All array items |
| `$.*` | All object values |
| `$..key` | Recursive descent |
| `$[2:5]` | Array slice |

## Privacy

Everything runs locally in your browser. No data is sent to any server.

## License

MIT
