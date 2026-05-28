// Blog index page
(function () {
  const list = document.getElementById('posts-list');
  if (!list) return;

  list.innerHTML = '';

  BLOG_POSTS.forEach(post => {
    const a = document.createElement('a');
    a.className = 'post-item';
    a.href = `post.html?type=blog&slug=${post.slug}`;

    const tagsHtml = post.tags.slice(0, 4).map(t =>
      `<span class="post-tag">${t}</span>`
    ).join('');

    a.innerHTML = `
      <div class="post-item-meta">
        <span class="post-date">${post.dateDisplay}</span>
        <div class="post-tags">${tagsHtml}</div>
      </div>
      <div class="post-item-title">${post.title}</div>
      <div class="post-item-excerpt">${post.excerpt}</div>
    `;

    list.appendChild(a);
  });
})();
