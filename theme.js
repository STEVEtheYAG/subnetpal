/* SubnetPal - light/dark theme and greeting helpers. Pure functions + a tiny guarded bootstrap (loaded in <head> so there is no flash). */
(function (root) {
  'use strict';
  const KEY = 'subnetpal.theme', PKEY = 'subnetpal.palette';
  // stored: 'light' | 'dark' | anything else (= follow the system). Light is the default look.
  function resolve(stored, prefersDark) { return stored === 'dark' || stored === 'light' ? stored : prefersDark ? 'dark' : 'light'; }
  function other(theme) { return theme === 'dark' ? 'light' : 'dark'; }
  // Colour themes (each works in light and dark). First is the default.
  const PALETTES = [['indigo', 'Indigo'], ['teal', 'Teal'], ['blugrn', 'BluGrn'], ['burg', 'Burg'], ['peach', 'Peach']];
  function palette(stored) { return PALETTES.some(p => p[0] === stored) ? stored : 'indigo'; }
  // 1234 -> "1,234"; 1.2M style for big address counts so a KPI tile never overflows.
  function compact(n) {
    n = Number(n) || 0;
    if (n < 100000) return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const u = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
    for (const [v, s] of u) if (n >= v) return (n / v >= 100 ? Math.round(n / v) : Math.round(n / v * 10) / 10) + s;
    return String(n);
  }
  const api = { KEY, PKEY, PALETTES, resolve, other, palette, compact };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Theme = api;

  if (typeof document !== 'undefined') {
    let stored = null;
    try { stored = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    const dark = !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
    const t = resolve(stored, dark);
    document.documentElement.setAttribute('data-theme', t);
    let ps = null; try { ps = localStorage.getItem(PKEY); } catch (e) { /* private mode */ }
    document.documentElement.setAttribute('data-palette', palette(ps));
    api.applyPalette = function (p) {
      p = palette(p); document.documentElement.setAttribute('data-palette', p);
      try { localStorage.setItem(PKEY, p); } catch (e) { /* ignore */ }
    };
    api.apply = function (theme) {
      document.documentElement.setAttribute('data-theme', theme);
      const m = document.querySelector('meta[name="theme-color"]'); if (m) m.setAttribute('content', theme === 'dark' ? '#0b0b12' : '#e4e7f7');
      try { localStorage.setItem(KEY, theme); } catch (e) { /* ignore */ }
    };
  }
}(typeof self !== 'undefined' ? self : this));
