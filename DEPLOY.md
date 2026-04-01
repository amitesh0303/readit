# Deploying to Cloudflare Pages

This is a fully static site — no build step, no Node.js, no bundler required.

---

## Step 1 — Create a Cloudflare Pages project

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Click **Workers & Pages** in the left sidebar
3. Click **Create application** → **Pages** → **Upload assets**
4. Give your project a name (e.g. `my-web3-blog`)

---

## Step 2 — Upload the `int` folder

Drag and drop the entire `int` folder into Cloudflare's upload area. This includes:
- `site/` (HTML, CSS, JS)
- `blogs/` (markdown files)
- `track-*/` (markdown tracks)
- `index.html`, `404.html`, `_redirects`, `_routes.json`

Cloudflare will immediately process and deploy.

---

## Step 3 — Get your URL

Your site goes live instantly at:

```
https://your-project-name.pages.dev/site/
```

---

## Optional: Custom domain

1. In your Pages project, go to **Custom domains**
2. Click **Set up a custom domain**
3. Enter your domain (e.g. `amitesh.dev`)
4. Follow the DNS instructions (add a CNAME record pointing to `your-project-name.pages.dev`)

If you want the root domain to go directly to the blog (instead of `/site/`), the `_redirects` file at the repo root handles this:

```
# _redirects (already in your folder)
/ /site/ 301
```

---

## Updating content after deploy

1. Make changes locally (add new markdown files, update site files, etc.)
2. Drag and drop the updated `int` folder into Cloudflare Pages again
3. Cloudflare redeploys within 30 seconds — live instantly

---

## Local development (matches production exactly)

```bash
# From the int folder:
python3 -m http.server 8080

# Open: http://localhost:8080/site/
```

The local server also serves from root, so `/blogs/...` and `/track-*/...` paths work identically to production.

---

## Folder structure Cloudflare sees

```
/ (repo root — what Cloudflare serves)
├── site/
│   ├── index.html       ← yoursite.pages.dev/site/
│   ├── tracks.html
│   ├── post.html
│   ├── track.html
│   ├── style.css
│   ├── posts.js
│   ├── app.js
│   ├── tracks-app.js
│   └── post-app.js
├── blogs/
│   ├── 2023-02-14-why-i-finally-went-all-in-on-web3.md
│   └── ...              ← fetched as /blogs/filename.md ✓
├── track-1-blockchain-fundamentals/
│   └── ...              ← fetched as /track-1-.../filename.md ✓
└── ...
```

The HTML pages in `site/` fetch markdown using absolute paths (`/blogs/...`, `/track-*/...`). Since Cloudflare serves from the repo root, these paths resolve correctly.

---

## Local development (matches production exactly)

```bash
# From the repo root:
python3 -m http.server 8080

# Open: http://localhost:8080/site/
```

The local server also serves from root, so `/blogs/...` paths work identically to production.
