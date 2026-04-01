// Post reader — handles both blog posts (frontmatter) and track articles (# H1 header)
(function () {
  const params   = new URLSearchParams(window.location.search);
  const type     = params.get('type');       // 'blog' | 'track'
  const container = document.getElementById('post-content');
  const navEl    = document.getElementById('post-nav');
  const backEl   = document.getElementById('post-back');

  let filePath = null;
  let prevPost = null;
  let nextPost = null;
  let trackContext = null; // { track, index } for breadcrumb

  // ── 1. Resolve which file to load ──────────────────────────────────────

  if (type === 'blog') {
    const slug = params.get('slug');
    const idx  = BLOG_POSTS.findIndex(p => p.slug === slug);
    if (idx === -1) { container.innerHTML = '<p>Post not found.</p>'; return; }

    filePath = BLOG_POSTS[idx].file;

    if (idx > 0)
      prevPost = { label: '← Newer', title: BLOG_POSTS[idx - 1].title,
                   href: `site/post.html?type=blog&slug=${BLOG_POSTS[idx - 1].slug}` };
    if (idx < BLOG_POSTS.length - 1)
      nextPost = { label: 'Older →', title: BLOG_POSTS[idx + 1].title,
                   href: `site/post.html?type=blog&slug=${BLOG_POSTS[idx + 1].slug}` };

  } else if (type === 'track') {
    const trackId = params.get('trackId');
    const index   = parseInt(params.get('index'), 10);
    const track   = TRACKS.find(t => t.id === trackId);

    if (!track || isNaN(index) || !track.posts[index]) {
      container.innerHTML = '<p>Post not found.</p>'; return;
    }

    filePath     = track.posts[index].file;
    trackContext = { track, index };

    if (index > 0)
      prevPost = { label: '← Previous', title: track.posts[index - 1].title,
                   href: `site/post.html?type=track&trackId=${trackId}&index=${index - 1}` };
    if (index < track.posts.length - 1)
      nextPost = { label: 'Next →', title: track.posts[index + 1].title,
                   href: `site/post.html?type=track&trackId=${trackId}&index=${index + 1}` };

  } else {
    container.innerHTML = '<p>Unknown post type.</p>';
    return;
  }

  // ── 2. Render breadcrumb / back link ───────────────────────────────────

  if (trackContext) {
    const { track, index } = trackContext;
    backEl.innerHTML = `
      <div class="breadcrumb">
        <a href="site/tracks.html" class="breadcrumb-link">Tracks</a>
        <span class="breadcrumb-sep">›</span>
        <a href="site/track.html?id=${track.id}" class="breadcrumb-link">${track.title}</a>
        <span class="breadcrumb-sep">›</span>
        <span class="breadcrumb-current">${String(index + 1).padStart(2, '0')} of ${track.posts.length}</span>
      </div>
    `;
  } else {
    backEl.innerHTML = `<a href="/" class="back-link">← Blog</a>`;
  }

  // ── 3. Fetch the markdown file ─────────────────────────────────────────

  fetch(filePath)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status} — ${filePath}`);
      return r.text();
    })
    .then(raw => {
      const parsed = parseMarkdown(raw);
      renderPost(parsed);
      renderNav(prevPost, nextPost);
    })
    .catch(err => {
      container.innerHTML = `
        <div style="padding:2rem 0">
          <p style="color:var(--red);margin-bottom:0.5rem">Failed to load article</p>
          <p style="color:var(--text-faint);font-size:0.85rem">${err.message}</p>
        </div>`;
    });

  // ── 4. Parse markdown — handles both frontmatter and plain # H1 ────────

  function parseMarkdown(raw) {
    // Try YAML frontmatter first (blog posts)
    const fmMatch = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    if (fmMatch) {
      const fm = {};
      fmMatch[1].split('\n').forEach(line => {
        const colon = line.indexOf(':');
        if (colon === -1) return;
        const key = line.slice(0, colon).trim();
        let val   = line.slice(colon + 1).trim();
        if (val.startsWith('[') && val.endsWith(']')) {
          val = val.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, ''));
        }
        fm[key] = val;
      });
      return { source: 'frontmatter', fm, body: fmMatch[2] };
    }

    // No frontmatter — track article format:
    // First line is "# Title"
    // Followed by optional "**Track:** Level" and "**Read time:** N min"
    const lines = raw.split('\n');
    let title = '';
    let track = '';
    let readTime = '';
    let bodyStart = 0;

    // Extract # H1 title
    if (lines[0] && lines[0].startsWith('# ')) {
      title = lines[0].slice(2).trim();
      bodyStart = 1;
    }

    // Extract **Track:** and **Read time:** from the next few lines
    for (let i = bodyStart; i < Math.min(bodyStart + 6, lines.length); i++) {
      const line = lines[i].trim();
      const trackMatch = line.match(/^\*\*Track:\*\*\s*(.+)/);
      const timeMatch  = line.match(/^\*\*Read time:\*\*\s*(.+)/);
      if (trackMatch) { track = trackMatch[1].trim(); bodyStart = i + 1; }
      if (timeMatch)  { readTime = timeMatch[1].trim(); bodyStart = i + 1; }
    }

    // Skip the horizontal rule that follows the metadata block
    while (bodyStart < lines.length && lines[bodyStart].trim() === '---') {
      bodyStart++;
    }

    const body = lines.slice(bodyStart).join('\n');
    return { source: 'h1', title, track, readTime, body };
  }

  // ── 5. Render the post ─────────────────────────────────────────────────

  function renderPost(parsed) {
    // Configure marked
    const renderer = new marked.Renderer();

    renderer.code = function (token) {
      // marked v9 passes an object {text, lang, escaped}
      const rawCode = typeof token === 'object' ? token.text : token;
      const rawLang = typeof token === 'object' ? (token.lang || '') : '';
      const lang    = rawLang.split(/\s/)[0]; // strip any extra flags

      let highlighted;
      try {
        if (lang && hljs.getLanguage(lang)) {
          highlighted = hljs.highlight(rawCode, { language: lang }).value;
        } else {
          highlighted = hljs.highlightAuto(rawCode).value;
        }
      } catch {
        highlighted = escapeHtml(rawCode);
      }

      const langLabel = lang ? `<span class="code-lang">${lang}</span>` : '';
      return `<div class="code-block">${langLabel}<pre><code class="hljs">${highlighted}</code></pre></div>`;
    };

    marked.use({ renderer, gfm: true, breaks: false });

    let title = '', metaHtml = '', body = '';

    if (parsed.source === 'frontmatter') {
      const fm   = parsed.fm;
      title      = fm.title || '';
      body       = parsed.body;
      const tags = Array.isArray(fm.tags) ? fm.tags : (fm.tags ? [fm.tags] : []);
      const date = fm.date || '';
      let dateDisplay = date;
      if (date) {
        try { dateDisplay = new Date(date + 'T00:00:00').toLocaleDateString('en-US',
          { year: 'numeric', month: 'long', day: 'numeric' }); } catch {}
      }
      const tagsHtml = tags.map(t => `<span class="post-header-tag">${t}</span>`).join('');
      metaHtml = `
        <div class="post-header-meta">
          ${date ? `<span class="post-header-date">${dateDisplay}</span>` : ''}
          ${tags.length ? `<div class="post-header-tags">${tagsHtml}</div>` : ''}
        </div>`;
    } else {
      title = parsed.title;
      body  = parsed.body;
      const badges = [];
      if (parsed.track)    badges.push(`<span class="post-header-tag">${parsed.track}</span>`);
      if (parsed.readTime) badges.push(`<span class="post-header-date">${parsed.readTime} read</span>`);
      if (badges.length) {
        metaHtml = `<div class="post-header-meta">${badges.join('')}</div>`;
      }
    }

    if (title) document.title = `${title} — Amitesh Patnaik`;

    const headerHtml = (title || metaHtml) ? `
      <div class="post-header">
        ${metaHtml}
        ${title ? `<h1 class="post-header-title">${escapeHtml(title)}</h1>` : ''}
      </div>` : '';

    container.innerHTML = `
      ${headerHtml}
      <div class="post-body">${marked.parse(body)}</div>
    `;

    window.scrollTo(0, 0);
  }

  // ── 6. Prev / next navigation ──────────────────────────────────────────

  function renderNav(prev, next) {
    if (!prev && !next) { navEl.style.display = 'none'; return; }
    let html = '';
    if (prev) html += `
      <a class="post-nav-link prev" href="${prev.href}">
        <span class="post-nav-label">${prev.label}</span>
        <span class="post-nav-title">${escapeHtml(prev.title)}</span>
      </a>`;
    if (next) html += `
      <a class="post-nav-link next" href="${next.href}">
        <span class="post-nav-label">${next.label}</span>
        <span class="post-nav-title">${escapeHtml(next.title)}</span>
      </a>`;
    navEl.innerHTML = html;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  function escapeHtml(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
              .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

})();
