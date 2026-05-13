// Tracks index page
(function () {
  const grid = document.getElementById('tracks-grid');
  if (!grid) return;

  // Add wide-layout class to main
  document.querySelector('.main').style.maxWidth = '1100px';

  grid.innerHTML = '';

  TRACKS
    .filter(t => t.id && t.number && t.title && t.level && t.desc && t.posts)
    .sort((a, b) => {
      const numA = parseInt(a.number.replace('Track ', ''), 10);
      const numB = parseInt(b.number.replace('Track ', ''), 10);
      return numA - numB;
    })
    .forEach(track => {
    const card = document.createElement('div');
    card.className = 'track-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');

    card.innerHTML = `
      <div class="track-card-header">
        <span class="track-number">${track.number}</span>
        <span class="track-level">${track.level}</span>
      </div>
      <div class="track-title">${track.title}</div>
      <div class="track-desc">${track.desc}</div>
      <div class="track-count">${track.posts.length} articles</div>
    `;

    card.addEventListener('click', () => {
      window.location.href = `track.html?id=${track.id}`;
    });
    card.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') {
        window.location.href = `track.html?id=${track.id}`;
      }
    });

    grid.appendChild(card);
  });
})();
