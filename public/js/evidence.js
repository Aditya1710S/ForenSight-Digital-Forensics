import { api, ApiError } from './api.js';
import { esc, bytes, when, badge, demoBadge, empty, pager, toast, openModal, closeModal, confirmBox, debounce, kvList, icons } from './ui.js';

const SORTS = [['created_at', 'Date'], ['original_filename', 'Filename'], ['size_bytes', 'Size'], ['category', 'Type']];

export function evidenceDetailModal(id, onChange) {
  api.get(`/evidence/${encodeURIComponent(id)}`).then(r => {
    const e = r.evidence; const a = r.analysis;
    const d = openModal({ title: 'Evidence details', body: `
      ${e.is_demo ? '<div class="notice warn">DEMONSTRATION RECORD - synthetic, not genuine evidence.</div>' : ''}
      ${kvList([['Evidence ID', e.id], ['Case', `${r.case.title} (${r.case.id})`], ['Original filename', e.original_filename], ['Type', e.category], ['Detected format', `${e.detected_format} (${e.mime_type})`], ['Size', bytes(e.size_bytes)], ['Recorded SHA-256', e.sha256], ['Ingested', when(e.created_at)], ['Uploaded by', e.uploaded_by], ['Extension check', e.format_mismatch ? 'Extension did not match detected content' : 'Consistent'], ['Latest analysis', a ? `${a.status} - ${when(a.createdAt)}` : 'Not analyzed'], ['Verifications', r.verifications.length ? `${r.verifications[0].status} (latest of ${r.verifications.length})` : 'None'], ['Derived artifacts', r.artifacts.length]])}
      <div class="field" style="margin-top:14px"><label for="evNotes">Analyst notes (entered by you; not verified by the system)</label><textarea id="evNotes" maxlength="2000">${esc(e.notes)}</textarea></div>`,
      actions: '<button class="btn" data-close>Close</button><button class="btn primary" id="saveNotes">Save notes</button>' });
    d.querySelector('#saveNotes').onclick = async () => { try { await api.put(`/evidence/${e.id}`, { notes: d.querySelector('#evNotes').value }); toast('Notes saved', 'success'); closeModal(); onChange && onChange(); } catch (er) { toast(er.message, 'error'); } };
  }).catch(e => toast(e.message, 'error'));
}

export async function render(root, ctx) {
  const q = { q: ctx.query.q || '', caseId: ctx.query.caseId || '', type: ctx.query.type || '', sort: ctx.query.sort || 'created_at', order: ctx.query.order || 'desc', page: Number(ctx.query.page) || 1 };
  const cases = (await api.get('/cases', { pageSize: 100 })).items;
  const open = cases.filter(c => c.status !== 'Closed');
  root.innerHTML = `<div class="page-head"><div><h1>Evidence Vault</h1><p>Originals are stored outside the web root, hashed on ingest and never modified.</p></div></div>
    <div class="card" id="upCard"><div class="card-head"><h2>Upload evidence</h2></div>
      ${open.length ? `<form id="upForm" novalidate><div class="form-row">
        <div class="field"><label for="upCase">Case *</label><select id="upCase" name="caseId" required>${open.map(c => `<option value="${esc(c.id)}" ${c.id === q.caseId ? 'selected' : ''}>${esc(c.title)} (${esc(c.id)})</option>`).join('')}</select></div>
        <div class="field"><label for="upFile">File * (JPG, PNG, WebP, MP4, MOV, WebM)</label><input id="upFile" name="file" type="file" required accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm"></div></div>
        <div class="field"><label for="upNotes">Notes (optional)</label><input id="upNotes" name="notes" maxlength="2000"></div>
        <p class="small muted">Only upload material you are authorised to handle. The file is validated by signature and parser, then SHA-256 hashed.</p>
        <div class="actions"><button class="btn primary" id="upBtn" type="submit"><i data-lucide="upload"></i>Upload</button></div>
        <div id="upProg" hidden style="margin-top:10px"><div class="progress"><div id="upBar"></div></div><div class="small muted" id="upStatus" aria-live="polite"></div></div></form>`
        : empty('folder-plus', 'Create an open case first', 'Evidence must belong to a case that is not Closed.', '<a class="btn primary" href="#/cases?new=1">Create case</a>')}</div>
    <div class="card" style="margin-top:16px"><div class="filters">
      <div class="grow"><label for="eq">Search</label><input id="eq" type="search" value="${esc(q.q)}" placeholder="Filename, evidence ID or hash"></div>
      <div><label for="ec">Case</label><select id="ec"><option value="">All cases</option>${cases.map(c => `<option value="${esc(c.id)}" ${c.id === q.caseId ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}</select></div>
      <div><label for="et">Type</label><select id="et"><option value="">All</option><option value="image" ${q.type === 'image' ? 'selected' : ''}>Images</option><option value="video" ${q.type === 'video' ? 'selected' : ''}>Videos</option></select></div>
      <div><label for="es">Sort by</label><select id="es">${SORTS.map(([k, l]) => `<option value="${k}" ${k === q.sort ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label for="eo">Order</label><select id="eo"><option value="desc" ${q.order === 'desc' ? 'selected' : ''}>Descending</option><option value="asc" ${q.order === 'asc' ? 'selected' : ''}>Ascending</option></select></div></div>
      <div id="tbl"></div></div>`;
  const go = patch => { const n = { ...q, ...patch }; const p = new URLSearchParams(Object.entries(n).filter(([k, v]) => v && !(k === 'page' && v === 1) && !(k === 'sort' && v === 'created_at') && !(k === 'order' && v === 'desc'))); ctx.navigate('#/evidence' + (p.toString() ? '?' + p : '')); };
  const load = async () => {
    const r = await api.get('/evidence', { ...q, pageSize: 10 });
    const box = root.querySelector('#tbl');
    box.innerHTML = r.items.length ? `<div class="table-wrap"><table><thead><tr><th>Preview</th><th>File</th><th>Case</th><th>Size</th><th>Integrity</th><th>Added</th><th></th></tr></thead><tbody>${r.items.map(e => `<tr>
      <td>${e.category === 'image' ? `<img class="thumb" loading="lazy" alt="" src="/api/evidence/${esc(e.id)}/preview">` : '<i data-lucide="film"></i>'}</td>
      <td><a href="#" data-view="${esc(e.id)}">${esc(e.original_filename)}</a>${demoBadge(e.is_demo)}<div class="small muted mono">${esc(e.id)} - ${esc(e.category)}</div></td>
      <td class="small">${esc(e.case_title)}</td><td class="nowrap">${bytes(e.size_bytes)}</td>
      <td>${e.last_verification ? badge(e.last_verification) : '<span class="muted small">not verified</span>'}</td><td class="nowrap small">${when(e.created_at)}</td>
      <td class="right nowrap"><a class="btn sm" href="#/${e.category === 'image' ? 'image' : 'video'}?id=${esc(e.id)}">Analyze</a> <a class="btn sm" href="#/integrity?id=${esc(e.id)}">Verify</a> <a class="btn sm" href="/api/evidence/${esc(e.id)}/download" title="Download original (logged)">Download</a> <a class="btn sm" href="/api/evidence/${esc(e.id)}/report?format=pdf">PDF</a> <a class="btn sm" href="/api/evidence/${esc(e.id)}/report?format=json">JSON</a> <button class="btn sm danger" data-del="${esc(e.id)}" data-name="${esc(e.original_filename)}">Archive</button></td></tr>`).join('')}</tbody></table></div>${pager(r.page, r.pageSize, r.total)}`
      : empty('archive', q.q || q.caseId || q.type ? 'No matching evidence' : 'The vault is empty', q.q || q.caseId || q.type ? 'Adjust the filters.' : 'Upload an image or video above to begin.');
    box.onclick = async e => {
      const pg = e.target.closest('[data-page]'); if (pg) return go({ page: Number(pg.dataset.page) });
      const v = e.target.closest('[data-view]'); if (v) { e.preventDefault(); return evidenceDetailModal(v.dataset.view, load); }
      const del = e.target.closest('[data-del]');
      if (del && await confirmBox('Archive evidence?', `"${del.dataset.name}" will be archived (soft-deleted). The stored file and its audit history are retained.`, 'Archive', true)) {
        try { await api.del(`/evidence/${del.dataset.del}?confirm=true`); toast('Evidence archived', 'success'); load(); } catch (er) { toast(er.message, 'error'); }
      }
    };
    icons();
  };
  const form = root.querySelector('#upForm');
  if (form) form.onsubmit = async ev => {
    ev.preventDefault();
    const file = form.elements.file.files[0];
    if (!file) return toast('Choose a file first.', 'warning');
    const btn = root.querySelector('#upBtn'); btn.disabled = true;
    const prog = root.querySelector('#upProg'), bar = root.querySelector('#upBar'), st = root.querySelector('#upStatus');
    prog.hidden = false; bar.style.width = '0'; st.textContent = 'Uploading...';
    try {
      const fd = new FormData(); fd.append('caseId', form.elements.caseId.value); fd.append('notes', form.elements.notes.value); fd.append('file', file);
      const r = await api.upload(fd, p => { bar.style.width = p + '%'; st.textContent = p < 100 ? `Uploading... ${p}%` : 'Hashing, validating and analysing...'; });
      bar.style.width = '100%'; st.textContent = r.analysisError ? `Stored. Analysis note: ${r.analysisError}` : 'Stored and analysed.';
      toast(`Evidence ${r.evidence.id} stored. SHA-256 recorded.`, 'success'); if (r.parserSkipped) toast('FFprobe unavailable: video structure was not parser-validated.', 'warning');
      form.reset(); load();
    } catch (e) { st.textContent = ''; prog.hidden = true; toast(e instanceof ApiError ? e.message : 'Upload failed', 'error'); }
    finally { btn.disabled = false; }
  };
  root.querySelector('#eq').addEventListener('input', debounce(e => go({ q: e.target.value.trim(), page: 1 }), 400));
  root.querySelector('#ec').onchange = e => go({ caseId: e.target.value, page: 1 });
  root.querySelector('#et').onchange = e => go({ type: e.target.value, page: 1 });
  root.querySelector('#es').onchange = e => go({ sort: e.target.value, page: 1 });
  root.querySelector('#eo').onchange = e => go({ order: e.target.value, page: 1 });
  await load();
  if (ctx.query.upload) root.querySelector('#upCard')?.scrollIntoView({ block: 'start' });
}
