document.addEventListener('DOMContentLoaded', () => {
  const pages = [
    { name: 'about', href: '/', file: 'index.html' },
    { name: 'photos', href: '/photos', file: 'photos.html' },
    { name: 'games', href: '/games', file: 'games.html' },
    { name: 'files', href: '/files', file: 'files.html' },
  ];

  const path = window.location.pathname;
  const currentFile = path.split('/').pop() || 'index.html';

  const nav = document.createElement('nav');

  const brand = document.createElement('a');
  brand.className = 'brand';
  brand.href = '/';
  brand.textContent = 'linnsanity';

  const links = document.createElement('div');
  links.className = 'links';

  pages.forEach(page => {
    const a = document.createElement('a');
    // Use .html paths for local file:// compatibility, clean paths for deployed
    const isLocal = path.startsWith('/') && (path.endsWith('.html') || currentFile === '');
    a.href = page.href;
    a.textContent = page.name;

    // Detect active page
    const isActive =
      currentFile === page.file ||
      (page.file === 'index.html' && (currentFile === '' || path === '/')) ||
      path === page.href;

    if (isActive) a.classList.add('active');
    links.appendChild(a);
  });

  nav.appendChild(brand);
  nav.appendChild(links);

  document.body.insertBefore(nav, document.body.firstChild);
});
