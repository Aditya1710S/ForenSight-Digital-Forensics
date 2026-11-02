import { api } from './api.js';
import { esc, bytes, when, badge, empty, icons, toast } from './ui.js';

export async function render(root, ctx) {
  const [cases, evidence] = await Promise.all([api.get('/cases', { pageSize: 100 }), api.get('/evidence', { pageSize: 100 })]);
  const rep = (url, label) => `<a class="btn sm" href="${url}&format=pdf">${label} PDF</a> <a class="btn sm" href="${url}&format=json">JSON</a>`;
  root.innerHTML = `<div class="page-head"><div><h1>Reports</h1><p>Case, evidence and verification reports. Each export is recorded in the audit log.</p></div></div>
    <div class="notice" style="margin-bottom:16px">Reports separate verified facts, extracted metadata, heuristic indicators and analyst notes, and include a statement of scope and limitations. Internal storage paths are never included.</div>
    <div class="card"><div class="card-head"><h2>Case reports</h2></div>${cases.items.length ? `<div class="table-wrap"><table><thead><tr><th>Case</th><th>Status</th><th>Evidence</th><th></th></tr></thead><tbody>${cases.items.map(c => `<tr><td>${esc(c.title)}<div class="small muted mono">${esc(c.id)}</div></td><td>${badge(c.status)}</td><td>${c.evidence_count}</td><td class="right nowrap">${rep(`/api/reports/case/${esc(c.id)}?x=1`, 'Case')}</td></tr>`).join('')}</tbody></table></div>` : empty('file-text', 'No cases', 'Create a case to generate reports.')}</div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Evidence reports</h2></div>${evidence.items.length ? `<div class="table-wrap"><table><thead><tr><th>Evidence</th><th>Type</th><th>Size</th><th>Last verification</th><th></th></tr></thead><tbody>${evidence.items.map(e => `<tr><td>${esc(e.original_filename)}<div class="small muted mono">${esc(e.id)}</div></td><td>${badge(e.category, 'info')}</td><td>${bytes(e.size_bytes)}</td><td>${e.last_verification ? badge(e.last_verification) : '<span class="muted small">none</span>'}</td><td class="right nowrap">${rep(`/api/evidence/${esc(e.id)}/report?x=1`, 'Evidence')} <a class="btn sm" href="#/integrity?id=${esc(e.id)}">Verification reports</a></td></tr>`).join('')}</tbody></table></div>` : empty('archive', 'No evidence', 'Upload evidence to generate reports.')}</div>`;
  icons();
}
