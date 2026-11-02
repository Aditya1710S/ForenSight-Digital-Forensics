import { api } from './api.js';
import { esc, bytes, when, badge, demoBadge, empty, icons, tmpl } from './ui.js';

let charts = [];
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

function drawCharts(root, d) {
  charts.forEach(c => c.destroy()); charts = [];
  if (!window.Chart) { root.querySelectorAll('.chart-box').forEach(b => { b.innerHTML = '<p class="muted">Chart library not loaded (run npm install).</p>'; }); return; }
  const text = css('--text-2'), grid = css('--chart-grid');
  Chart.defaults.color = text; Chart.defaults.font.family = 'Segoe UI, system-ui, sans-serif';
  const t = root.querySelector('#chType');
  if (t) charts.push(new Chart(t, { type: 'doughnut', data: { labels: ['Images', 'Videos'], datasets: [{ data: [d.evidenceByType.image, d.evidenceByType.video], backgroundColor: [css('--chart-1'), css('--chart-2')], borderColor: css('--surface'), borderWidth: 3 }] }, options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom' } } } }));
  const a = root.querySelector('#chAct');
  if (a) charts.push(new Chart(a, { type: 'bar', data: { labels: d.activity.days.map(x => x.slice(5)), datasets: [
    { label: 'Uploads', data: d.activity.uploads, backgroundColor: css('--chart-1') }, { label: 'Analyses', data: d.activity.analyses, backgroundColor: css('--chart-2') }, { label: 'Verifications', data: d.activity.verifications, backgroundColor: css('--chart-4') }] },
    options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: grid } } }, plugins: { legend: { position: 'bottom' } } } }));
}

export async function render(root, ctx) {
  const d = await api.get('/dashboard/stats');
  const t = d.totals; const fresh = t.cases === 0 && t.evidence === 0;
  const stat = (label, icon, value, sub) => `<div class="stat"><div class="label"><i data-lucide="${icon}"></i>${esc(label)}</div><div class="value">${esc(value)}</div><div class="sub">${esc(sub)}</div></div>`;
  const i = d.integrity;
  root.innerHTML = `
    <div class="page-head"><div><h1>Dashboard</h1><p>Live overview of cases, evidence and verification activity.</p></div>
      <div class="actions">
        <a class="btn primary" href="#/cases?new=1"><i data-lucide="folder-plus"></i>Create Case</a>
        <a class="btn" href="#/evidence?upload=1"><i data-lucide="upload"></i>Upload Evidence</a>
        <a class="btn" href="#/image"><i data-lucide="image"></i>Analyze Image</a>
        <a class="btn" href="#/video"><i data-lucide="film"></i>Analyze Video</a>
        <a class="btn" href="#/integrity"><i data-lucide="shield-check"></i>Verify Hash</a></div></div>
    ${fresh ? `<div class="card"><h2>Welcome - start your first investigation</h2><p class="muted">Nothing has been recorded yet. A typical workflow:</p><ol class="steps"><li><span>Create a case to group related evidence.</span></li><li><span>Upload a JPG, PNG, WebP, MP4, MOV or WebM file into that case. Its SHA-256 is recorded immediately.</span></li><li><span>Open Image Analysis or Video Analysis to inspect metadata and indicators.</span></li><li><span>Run Integrity Verification, then export a PDF or JSON report.</span></li></ol><p class="small muted">Tip: set <code>DEMO_MODE=true</code> in <code>.env</code> to load clearly marked synthetic demo records.</p></div>` : ''}
    <div class="grid g-stats" style="margin-top:16px">
      ${stat('Total Cases', 'folder-kanban', t.cases, 'active (non-archived)')}${stat('Evidence Files', 'archive', t.evidence, 'in the vault')}
      ${stat('Images Analyzed', 'image', t.imagesAnalyzed, 'with at least one analysis')}${stat('Videos Analyzed', 'film', t.videosAnalyzed, 'with at least one analysis')}
      ${stat('Integrity Results', 'shield-check', `${i.MATCH} / ${i.MISMATCH} / ${i.ERROR}`, 'latest per file: match / mismatch / error')}${stat('Recent Activity', 'activity', t.eventsLast24h, 'audit events, last 24 hours')}
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Evidence by type</h2></div>${t.evidence ? '<div class="chart-box"><canvas id="chType" aria-label="Evidence type distribution" role="img"></canvas></div>' : empty('pie-chart', 'No evidence yet', 'The chart appears after your first upload.')}</div>
      <div class="card"><div class="card-head"><h2>Activity, last 14 days</h2></div><div class="chart-box"><canvas id="chAct" aria-label="Analysis activity" role="img"></canvas></div></div>
    </div>
    <div class="grid g-2" style="margin-top:16px">
      <div class="card"><div class="card-head"><h2>Recent cases</h2><a href="#/cases" class="small">View all</a></div>${d.recentCases.length ? `<div class="table-wrap"><table><thead><tr><th>Case</th><th>Status</th><th>Priority</th></tr></thead><tbody>${d.recentCases.map(c => `<tr><td><a href="#/cases/${esc(c.id)}">${esc(c.title)}</a>${demoBadge(c.is_demo)}<div class="small muted mono">${esc(c.id)}</div></td><td>${badge(c.status)}</td><td>${badge(c.priority)}</td></tr>`).join('')}</tbody></table></div>` : empty('folder-open', 'No cases yet', 'Create a case to begin.')}</div>
      <div class="card"><div class="card-head"><h2>Recent evidence</h2><a href="#/evidence" class="small">View all</a></div>${d.recentEvidence.length ? `<div class="table-wrap"><table><thead><tr><th>File</th><th>Type</th><th>Size</th></tr></thead><tbody>${d.recentEvidence.map(e => `<tr><td>${esc(e.original_filename)}${demoBadge(e.is_demo)}<div class="small muted mono">${esc(e.id)}</div></td><td>${badge(e.category, 'info')}</td><td class="nowrap">${bytes(e.size_bytes)}</td></tr>`).join('')}</tbody></table></div>` : empty('archive', 'Vault is empty', 'Uploaded evidence will be listed here.')}</div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Recent audit events</h2><a href="#/audit" class="small">Full log</a></div>${d.recentAudit.length ? `<div class="table-wrap"><table><thead><tr><th>Time</th><th>Event</th><th>Actor</th><th>Description</th></tr></thead><tbody>${d.recentAudit.map(a => `<tr><td class="nowrap">${when(a.timestamp)}</td><td class="mono">${esc(a.event_type)}</td><td>${esc(a.actor)}</td><td>${esc(a.description)}</td></tr>`).join('')}</tbody></table></div>` : empty('scroll-text', 'No events yet', 'Actions you perform are recorded here.')}</div>`;
  const redraw = () => drawCharts(root, d);
  setTimeout(redraw, 0);
  const onTheme = () => { if (!root.isConnected) { document.removeEventListener('themechange', onTheme); charts.forEach(c => c.destroy()); charts = []; return; } redraw(); };
  document.addEventListener('themechange', onTheme);
  icons();
}
