import { api } from './api.js';
import { esc, when, badge, empty, pager, toast, debounce, icons } from './ui.js';

export async function render(root, ctx) {
  const q = { q: ctx.query.q || '', type: ctx.query.type || '', caseId: ctx.query.caseId || '', page: Number(ctx.query.page) || 1 };
  const [types, cases] = await Promise.all([api.get('/audit/types'), api.get('/cases', { pageSize: 100 })]);
  root.innerHTML = `<div class="page-head"><div><h1>Audit Log</h1><p>Append-only, hash-linked record of application events. Read-only: events cannot be edited or deleted through the app.</p></div><button class="btn" id="chain"><i data-lucide="link"></i>Verify hash chain</button></div>
    <div class="notice" style="margin-bottom:16px">A hash-linked log helps reveal edits made outside the application. It is not a legally certified, tamper-proof chain of custody, and actor names are self-declared aliases.</div>
    <div id="chainOut"></div>
    <div class="card"><div class="filters"><div class="grow"><label for="aq">Search</label><input id="aq" type="search" value="${esc(q.q)}" placeholder="Description, actor or event ID"></div>
      <div><label for="at">Event type</label><select id="at"><option value="">All</option>${types.map(t => `<option ${t === q.type ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div><label for="ac">Case</label><select id="ac"><option value="">All</option>${cases.items.map(c => `<option value="${esc(c.id)}" ${c.id === q.caseId ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></div></div><div id="tbl"></div></div>`;
  const go = patch => { const n = { ...q, ...patch }; const p = new URLSearchParams(Object.entries(n).filter(([k, v]) => v && !(k === 'page' && v === 1))); ctx.navigate('#/audit' + (p.toString() ? '?' + p : '')); };
  const r = await api.get('/audit', { ...q, pageSize: 25 });
  const box = root.querySelector('#tbl');
  box.innerHTML = r.items.length ? `<div class="table-wrap"><table><thead><tr><th>#</th><th>Time</th><th>Event</th><th>Case</th><th>Evidence</th><th>Actor</th><th>Status</th><th>Description</th></tr></thead><tbody>${r.items.map(a => `<tr><td class="mono">${a.seq}</td><td class="nowrap small">${when(a.timestamp)}<div class="muted mono">${esc(a.timestamp)}</div></td><td class="mono">${esc(a.event_type)}</td><td class="mono small">${esc(a.case_id || '-')}</td><td class="mono small">${esc(a.evidence_id || '-')}</td><td>${esc(a.actor)}</td><td>${badge(a.status)}</td><td>${esc(a.description)}</td></tr>`).join('')}</tbody></table></div>${pager(r.page, r.pageSize, r.total)}` : empty('scroll-text', 'No events found', 'Events appear as you work.');
  box.onclick = e => { const pg = e.target.closest('[data-page]'); if (pg) go({ page: Number(pg.dataset.page) }); };
  root.querySelector('#aq').addEventListener('input', debounce(e => go({ q: e.target.value.trim(), page: 1 }), 400));
  root.querySelector('#at').onchange = e => go({ type: e.target.value, page: 1 });
  root.querySelector('#ac').onchange = e => go({ caseId: e.target.value, page: 1 });
  root.querySelector('#chain').onclick = async () => {
    try { const c = await api.get('/audit/verify-chain'); root.querySelector('#chainOut').innerHTML = c.valid ? `<div class="notice ok" style="margin-bottom:16px"><strong>Hash chain intact.</strong> ${c.checked} event(s) checked. Head: <span class="mono hash">${esc(c.headHash || 'n/a')}</span></div>` : `<div class="notice err" style="margin-bottom:16px" role="alert"><strong>Hash chain broken</strong> at event #${esc(c.brokenAtSeq)} (${esc(c.brokenEventId)}). The log may have been modified outside the application.</div>`; }
    catch (e) { toast(e.message, 'error'); }
  };
  icons();
}
