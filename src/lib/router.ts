// Hash routes (§7): #/ · #/<slug> · #/<slug>/<n> · #/<slug>/presenter · #/<slug>/print

export type Route =
  | { view: 'index' }
  | { view: 'deck'; slug: string; n: number | null }   // n is 1-based, null when absent
  | { view: 'presenter'; slug: string }
  | { view: 'print'; slug: string };

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (!path.startsWith('/')) return { view: 'index' };
  const [slug = '', sub = ''] = path.slice(1).split('/');
  if (!slug || !SLUG.test(slug)) return { view: 'index' };
  if (sub === 'presenter') return { view: 'presenter', slug };
  if (sub === 'print') return { view: 'print', slug };
  const n = /^\d+$/.test(sub) ? Number(sub) : null;
  return { view: 'deck', slug, n: n !== null && n >= 1 ? n : null };
}

export function formatRoute(route: Route): string {
  switch (route.view) {
    case 'index':
      return '#/';
    case 'deck':
      return route.n === null ? `#/${route.slug}` : `#/${route.slug}/${route.n}`;
    case 'presenter':
      return `#/${route.slug}/presenter`;
    case 'print':
      return `#/${route.slug}/print`;
  }
}

/**
 * Hashes that are not routes (`#fn-…` from a footnote link, say) are not
 * navigations; callers ignore them.
 */
export function isRouteHash(hash: string): boolean {
  return hash === '' || hash === '#' || hash.startsWith('#/');
}

/** Replace the hash without a history entry and without a `hashchange` event. */
export function replaceHash(hash: string): void {
  if (location.hash === hash) return;
  history.replaceState(history.state, '', hash);
}

/** Subscribe to user-driven hash changes (typed URL, Back/Forward, links). */
export function onHashChange(callback: (route: Route) => void): () => void {
  const handler = () => {
    if (isRouteHash(location.hash)) callback(parseHash(location.hash));
  };
  window.addEventListener('hashchange', handler);
  return () => window.removeEventListener('hashchange', handler);
}
