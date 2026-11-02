import { api } from './api.js';
import { esc, bytes, when, badge, demoBadge, empty, pager, toast, openModal, closeModal, confirmBox, fieldErrors, debounce, kvList, icons } from './ui.js';

const STATUSES = ['Open', 'In Progress', 'Closed'], PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];
const opts = (list, sel) => list.map(v => `<option ${v === sel ? 'selected' : ''}>${esc(v)}</option>`).join('');

function caseForm(c = {}) {
  return `<form id="caseForm" novalidate>
    <div class="field"><label for="cf-title">Title *</label><input id="cf-title" name="title" required minlength="3" maxlength="120" value="${esc(c.title)}"></div>
    <div class="field"><label for="cf-desc">Description</label><textarea id="cf-desc" name="description" maxlength="2000">${esc(c.description)}</textarea></div>
    <div class="form-row">
      <div class="field"><label for="cf-inv">Investigator (name or alias)</label><input id="cf-inv" name="investigator" maxlength="60" value="${esc(c.investigator)}" placeholder="defaults to your settings alias"></div>
      <div class="field"><label for="cf-st">Status</label><select id="cf-st" name="status">${opts(STATUSES, c.status || 'Open')}</select></div>
      <div class="field"><label for="cf-pr">Priority</label><select id="cf-pr" name="priority">${opts(PRIORITIES, c.priority || 'Medium')}</select></div>
    </div></form>`;
}

export function openCaseModal(c, done) {
  const d = openModal({ title: c ? 'Edit case' : 'Create case', body: caseForm(c || {}), actions: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="cfSave">Save</button>' });
  d.querySelector('#cfSave').onclick = async () => {
    const f = d.querySelector('#caseForm');
    const body = Object.fromEntries(new FormData(f));
    const errs = {};
    if ((body.title || '').trim().length < 3) errs.title = 'Title must be at least 3 characters.';
    if (Object.keys(errs).length) return fieldErrors(f, errs);
    try { const r = c ? await api.put(`/cases/${c.id}`, body) : await api.post('/cases', body); toast(c ? 'Case updated' : 'Case created', 'success'); closeModal(); done && done(r); }
    catch (e) { if (e.details) fieldErrors(f, e.details); toast(e.message, 'error'); }
  };
}

async function list(root, ctx) {
  const q = { q: ctx.query.q || '', status: ctx.query.status || '', priority: ctx.query.priority || '', page: Number(ctx.query.page) || 1 };
  root.innerHTML = `<div class="page-head"><div><h1>Cases</h1><p>Group evidence under investigations. Deleting archives a case; history is preserved.</p></div><button class="btn primary" id="newCase"><i data-lucide="folder-plus"></i>New case</button></div>
    <div class="card"><div class="filters"><div class="grow"><label for="fq">Search</label><input id="fq" type="search" value="${esc(q.q)}" placeholder="Title, ID, investigator..."></div>
      <div><label for="fs">Status</label><select id="fs"><option value="">All</option>${opts(STATUSES, q.status)}</select></div>
      <div><label for="fp">Priority</label><select id="fp"><option value="">All</option>${opts(PRIORITIES, q.priority)}</select></div></div><div id="tbl"></div></div>`;
  const go = (patch) => { const n = { ...q, ...patch }; const p = new URLSearchParams(Object.entries(n).filter(([k, v]) => v && !(k === 'page' && v === 1))); ctx.navigate('#/cases' + (p.toString() ? '?' + p : '')); };
  const load = async () => {
    const r = await api.get('/cases', { ...q, pageSize: 10 });
    root.querySelector('#tbl').innerHTML = r.items.length ? `<div class="table-wrap"><table><thead><tr><th>Case</th><th>Investigator</th><th>Status</th><th>Priority</th><th>Evidence</th><th>Updated</th><th></th></tr></thead><tbody>${r.items.map(c => `<tr><td><a href="#/cases/${esc(c.id)}">${esc(c.title)}</a>${demoBadge(c.is_demo)}<div class="small muted mono">${esc(c.id)}</div></td><td>${esc(c.investigator)}</td><td>${badge(c.status)}</td><td>${badge(c.priority)}</td><td>${c.evidence_count}</td><td class="nowrap">${when(c.updated_at)}</td><td class="right nowrap"><button class="btn sm" data-edit="${esc(c.id)}">Edit</button> <button class="btn sm danger" data-del="${esc(c.id)}" data-title="${esc(c.title)}">Delete</button></td></tr>`).join('')}</tbody></table></div>${pager(r.page, r.pageSize, r.total)}` : empty('folder-open', q.q || q.status || q.priority ? 'No matching cases' : 'No cases yet', q.q || q.status || q.priority ? 'Try different filters.' : 'Create your first case to start collecting evidence.');
    root.querySelector('#tbl').onclick = async e => {
      const pg = e.target.closest('[data-page]'); if (pg) return go({ page: Number(pg.dataset.page) });
      const ed = e.target.closest('[data-edit]'); if (ed) { const c = r.items.find(x => x.id === ed.dataset.edit); return openCaseModal(c, load); }
      const del = e.target.closest('[data-del]');
      if (del && await confirmBox('Delete case?', `"${del.dataset.title}" and its evidence records will be archived. Stored files and audit history are retained.`, 'Delete case', true)) {
        try { await api.del(`/cases/${del.dataset.del}?confirm=true`); toast('Case archived', 'success'); load(); } catch (er) { toast(er.message, 'error'); }
      }
    };
    icons();
  };
  root.querySelector('#newCase').onclick = () => openCaseModal(null, load);
  root.querySelector('#fq').addEventListener('input', debounce(e => go({ q: e.target.value.trim(), page: 1 }), 400));
  root.querySelector('#fs').onchange = e => go({ status: e.target.value, page: 1 });
  root.querySelector('#fp').onchange = e => go({ priority: e.target.value, page: 1 });
  await load();
  if (ctx.query.new) openCaseModal(null, load);
}

async function detail(root, ctx) {
  const id = ctx.params[0]; const c = await api.get(`/cases/${encodeURIComponent(id)}`);
  root.innerHTML = `<div class="page-head"><div><h1>${esc(c.title)}${demoBadge(c.is_demo)}</h1><p class="mono">${esc(c.id)}</p></div>
    <div class="actions"><button class="btn" id="edit"><i data-lucide="pencil"></i>Edit</button>
    <a class="btn" href="/api/reports/case/${esc(c.id)}?format=pdf"><i data-lucide="file-down"></i>PDF report</a><a class="btn" href="/api/reports/case/${esc(c.id)}?format=json"><i data-lucide="braces"></i>JSON</a>
    <button class="btn danger" id="del"><i data-lucide="trash-2"></i>Delete</button></div></div>
    <div class="grid g-2"><div class="card"><div class="card-head"><h2>Details</h2></div>${kvList([['Status', badge(c.status), 1], ['Priority', badge(c.priority), 1], ['Investigator', c.investigator], ['Created', when(c.created_at)], ['Updated', when(c.updated_at)], ['Description', c.description || 'No description.']])}
      <div class="field" style="margin-top:12px"><label for="chSt">Change status</label><select id="chSt">${opts(STATUSES, c.status)}</select></div></div>
    <div class="card"><div class="card-head"><h2>Recent custody events</h2></div>${c.recentAudit.length ? c.recentAudit.map(a => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--border)"><span class="mono">${esc(a.event_type)}</span> - ${esc(a.description)}<div class="muted">${when(a.timestamp)} by ${esc(a.actor)}</div></div>`).join('') : '<p class="muted">None.</p>'}</div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Evidence (${c.evidence.length})</h2><a class="btn sm primary" href="#/evidence?upload=1&caseId=${esc(c.id)}"><i data-lucide="upload"></i>Upload evidence</a></div>
    ${c.evidence.length ? `<div class="table-wrap"><table><thead><tr><th>File</th><th>Type</th><th>Size</th><th>SHA-256</th><th></th></tr></thead><tbody>${c.evidence.map(e => `<tr><td>${esc(e.original_filename)}<div class="small muted mono">${esc(e.id)}</div></td><td>${badge(e.category, 'info')}</td><td>${bytes(e.size_bytes)}</td><td class="mono hash">${esc(e.sha256.slice(0, 16))}...</td><td class="right nowrap"><a class="btn sm" href="#/${e.category === 'image' ? 'image' : 'video'}?id=${esc(e.id)}">Analyze</a> <a class="btn sm" href="#/integrity?id=${esc(e.id)}">Verify</a></td></tr>`).join('')}</tbody></table></div>` : empty('archive', 'No evidence in this case', 'Upload an image or video to begin.')}</div>`;
  root.querySelector('#edit').onclick = () => openCaseModal(c, () => ctx.navigate(location.hash));
  root.querySelector('#chSt').onchange = async e => { try { await api.put(`/cases/${c.id}`, { status: e.target.value }); toast('Status updated', 'success'); ctx.navigate(location.hash); } catch (er) { toast(er.message, 'error'); } };
  root.querySelector('#del').onclick = async () => { if (await confirmBox('Delete case?', 'The case and its evidence records will be archived. Files and history are retained.', 'Delete case', true)) { try { await api.del(`/cases/${c.id}?confirm=true`); toast('Case archived', 'success'); ctx.navigate('#/cases'); } catch (er) { toast(er.message, 'error'); } } };
}

export async function render(root, ctx) { return ctx.params.length ? detail(root, ctx) : list(root, ctx); }
