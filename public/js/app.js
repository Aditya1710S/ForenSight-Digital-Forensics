import { api } from './api.js';
import { esc, icons, toast, debounce, spinner } from './ui.js';

const NAV = [
  ['dashboard', 'Dashboard', 'layout-dashboard'], ['cases', 'Cases', 'folder-kanban'], ['evidence', 'Evidence Vault', 'archive'],
  ['image', 'Image Analysis', 'image'], ['video', 'Video Analysis', 'film'], ['integrity', 'Integrity Verification', 'shield-check'],
  ['reports', 'Reports', 'file-text'], ['audit', 'Audit Log', 'scroll-text'], ['settings', 'Settings', 'settings']
];
const TITLES = Object.fromEntries(NAV.map(n => [n[0], n[1]]));
const loaders = {
  dashboard: () => import('./dashboard.js'), cases: () => import('./cases.js'), evidence: () => import('./evidence.js'),
  image: () => import('./image-analysis.js'), video: () => import('./video-analysis.js'), integrity: () => import('./integrity.js'),
  reports: () => import('./reports.js'), audit: () => import('./audit.js'), settings: () => import('./settings.js')
};
const $ = id => document.getElementById(id);
const appEl = $('app'); const main = $('main');
let renderToken = 0;

// ---- theme ----
function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); document.dispatchEvent(new CustomEvent('themechange', { detail: t })); }
$('themeBtn').onclick = () => { const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('forensight-theme', t); } catch { /* storage blocked */ } applyTheme(t); };
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', e => { try { if (localStorage.getItem('forensight-theme')) return; } catch { /* ignore */ } applyTheme(e.matches ? 'dark' : 'light'); });

// ---- sidebar ----
$('nav').innerHTML = NAV.map(([k, label, ic]) => `<a href="#/${k}" data-route="${k}"><i data-lucide="${ic}"></i><span>${esc(label)}</span></a>`).join('');
try { if (localStorage.getItem('forensight-collapsed') === '1') appEl.classList.add('collapsed'); } catch { /* ignore */ }
$('menuBtn').onclick = () => {
  if (matchMedia('(max-width:820px)').matches) appEl.classList.toggle('nav-open');
  else { appEl.classList.toggle('collapsed'); try { localStorage.setItem('forensight-collapsed', appEl.classList.contains('collapsed') ? '1' : '0'); } catch { /* ignore */ } }
};
$('scrim').onclick = () => appEl.classList.remove('nav-open');

// ---- dropdowns ----
function toggleMenu(btn, menu, fill) {
  const open = menu.hidden; closeMenus();
  if (open) { fill && fill(); menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); icons(); }
}
function closeMenus() { for (const [b, m] of [['bellBtn', 'bellMenu'], ['profileBtn', 'profileMenu']]) { $(m).hidden = true; $(b).setAttribute('aria-expanded', 'false'); } $('searchResults').hidden = true; }
document.addEventListener('click', e => { if (!e.target.closest('.menu-wrap') && !e.target.closest('.search')) closeMenus(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

$('bellBtn').onclick = () => toggleMenu($('bellBtn'), $('bellMenu'), async () => {
  const m = $('bellMenu'); m.innerHTML = spinner();
  try {
    const ev = await api.get('/dashboard/activity');
    try { localStorage.setItem('forensight-seen', ev[0]?.timestamp || ''); } catch { /* ignore */ } $('bellDot').hidden = true;
    m.innerHTML = ev.length ? ev.map(x => `<div class="row"><strong>${esc(x.event_type)}</strong><div>${esc(x.description)}</div><div class="muted">${esc(new Date(x.timestamp).toLocaleString())}</div></div>`).join('') + '<div class="row"><a href="#/audit">Open audit log</a></div>' : '<div class="row muted">No activity yet.</div>';
  } catch (e) { m.innerHTML = `<div class="row">${esc(e.message)}</div>`; }
});
async function refreshChrome() {
  try {
    const [s, ev] = await Promise.all([api.get('/settings'), api.get('/dashboard/activity')]);
    $('profileName').textContent = s.investigatorAlias; $('avatar').textContent = s.investigatorAlias.trim().charAt(0).toUpperCase() || '?';
    $('profileMenu').innerHTML = `<div class="row"><strong>${esc(s.investigatorAlias)}</strong><div class="muted">Self-declared alias. Identity is not verified.</div></div><div class="row"><a href="#/settings">Change alias in Settings</a></div>`;
    let seen = ''; try { seen = localStorage.getItem('forensight-seen') || ''; } catch { /* ignore */ }
    $('bellDot').hidden = !(ev[0] && ev[0].timestamp > seen);
  } catch { /* server offline: pages will show errors */ }
}
$('profileBtn').onclick = () => toggleMenu($('profileBtn'), $('profileMenu'));

// ---- global search ----
const runSearch = debounce(async q => {
  const box = $('searchResults');
  if (q.trim().length < 2) { box.hidden = true; return; }
  try {
    const r = await api.get('/search', { q });
    const part = (t, items, href, label) => items.length ? `<div class="grp">${t}</div>` + items.map(i => `<a href="${href(i)}">${esc(label(i))}</a>`).join('') : '';
    const html = part('Cases', r.cases, i => `#/cases/${encodeURIComponent(i.id)}`, i => `${i.title} (${i.id})`) + part('Evidence', r.evidence, i => `#/evidence?q=${encodeURIComponent(i.id)}`, i => `${i.original_filename} (${i.id})`);
    box.innerHTML = html || '<div class="grp">No matches</div>'; box.hidden = false;
  } catch (e) { box.innerHTML = `<div class="grp">${esc(e.message)}</div>`; box.hidden = false; }
});
$('globalSearch').addEventListener('input', e => runSearch(e.target.value));
$('searchResults').addEventListener('click', () => { $('searchResults').hidden = true; $('globalSearch').value = ''; });

// ---- router ----
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, ''); const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { route: parts[0] || 'dashboard', params: parts.slice(1), query: Object.fromEntries(new URLSearchParams(query)) };
}
export const navigate = hash => { if (location.hash === hash) route(); else location.hash = hash; };

async function route() {
  const { route: r, params, query } = parseHash();
  const name = loaders[r] ? r : 'dashboard';
  const token = ++renderToken;
  appEl.classList.remove('nav-open'); closeMenus();
  document.querySelectorAll('.nav a').forEach(a => a.classList.toggle('active', a.dataset.route === name));
  const crumbs = [`<a href="#/dashboard">Home</a>`, name === 'dashboard' ? `<span>Dashboard</span>` : params.length ? `<a href="#/${name}">${esc(TITLES[name])}</a>` : `<span>${esc(TITLES[name])}</span>`];
  if (params.length) crumbs.push(`<span>${esc(params[0])}</span>`);
  $('crumbs').innerHTML = crumbs.join('');
  document.title = `${TITLES[name]} - ForenSight`;
  main.innerHTML = spinner();
  const root = document.createElement('div');
  try {
    const mod = await loaders[name]();
    await mod.render(root, { params, query, navigate, refreshChrome });
  } catch (e) { root.innerHTML = `<div class="notice err" role="alert"><strong>Could not load this page.</strong><div>${esc(e.message)}</div></div>`; }
  if (token !== renderToken) return;
  main.replaceChildren(root); icons(); main.focus({ preventScroll: true });
}
window.addEventListener('hashchange', route);
window.addEventListener('load', () => { icons(); });
document.addEventListener('DOMContentLoaded', () => icons());
refreshChrome(); route();
window.addEventListener('unhandledrejection', e => toast(e.reason?.message || 'Unexpected error', 'error'));
