# Static Site

Completely static — no build step, no Node.js, no bundler.

## How to run locally

The server must be started from the **repo root** (not inside `site/`) because the HTML files fetch markdown using absolute paths like `/blogs/...`.

**Option 1 — Python (built-in):**
```bash
# From the repo root:
python3 -m http.server 8080
# Then open: http://localhost:8080/site/
```

**Option 2 — Node.js:**
```bash
# From the repo root:
npx serve .
# Then open: http://localhost:3000/site/
```

**Option 3 — VS Code:**
Install "Live Server", right-click `site/index.html` → Open with Live Server.
Make sure Live Server's root is set to the workspace root, not `site/`.

## Why not just open index.html directly?

The site fetches `.md` files via `fetch()`. Browsers block `fetch()` on `file://` URLs (CORS). You need a local HTTP server started from the repo root.

## How to deploy to Cloudflare Pages

See the full guide in `DEPLOY.md` at the repo root.

## Adding a new blog post

1. Write the markdown file in `blogs/` with frontmatter:
   ```markdown
   ---
   title: "Your Post Title"
   date: 2025-06-01
   tags: [ethereum, solidity]
   ---
   Your content here...
   ```

2. Add an entry to `site/posts.js` in the `BLOG_POSTS` array (at the top, newest first).

That's it. No rebuild needed.
