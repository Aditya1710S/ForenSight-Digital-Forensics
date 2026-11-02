import { api } from './api.js';
import { esc, when, badge, empty, toast, kvList, icons, spinner, copyText } from './ui.js';

const ICON = { MATCH: 'shield-check', MISMATCH: 'shield-alert', ERROR: 'shield-x' };
const MSG = { MATCH: 'The recalculated SHA-256 equals the hash recorded at ingestion.', MISMATCH: 'The file on disk differs from what was recorded at ingestion.', ERROR: 'Verification could not be completed. This is NOT a match.' };

export async function render(root, ctx) {
  const list = (await api.get('/evidence', { pageSize: 100 })).items;
  root.innerHTML = `<div class="page-head"><div><h1>Integrity Verification</h1><p>Recalculate SHA-256 from the stored original and compare it with the recorded value.</p></div></div>
    <div class="notice" style="margin-bottom:16px">A MATCH shows byte-level consistency with the recorded hash, assuming the baseline hash and records were not themselves compromised. It does not prove authenticity, origin or legal admissibility.</div>
    ${list.length ? `<div class="card"><form id="vf" novalidate><div class="form-row"><div class="field"><label for="pick">Evidence</label><select id="pick" name="id"><option value="">Select evidence...</option>${list.map(e => `<option value="${esc(e.id)}" ${e.id === ctx.query.id ? 'selected' : ''}>${esc(e.original_filename)} - ${esc(e.id)}</option>`).join('')}</select></div>
      <div class="field"><label for="prov">Optional: compare a SHA-256 you already have</label><input id="prov" name="expectedHash" class="mono" maxlength="64" placeholder="64 hexadecimal characters" autocomplete="off" spellcheck="false"><div class="hint">Compared with the recorded hash and the freshly calculated hash.</div></div></div>
      <button class="btn primary" type="submit"><i data-lucide="shield-check"></i>Verify now</button></form></div>
    <div id="out" style="margin-top:16px"></div>` : empty('shield-check', 'Nothing to verify yet', 'Upload evidence first.', '<a class="btn primary" href="#/evidence?upload=1">Upload evidence</a>')}`;
  if (!list.length) return;
  const out = root.querySelector('#out'); const pick = root.querySelector('#pick');

  async function history(id) {
    const rows = await api.get(`/evidence/${id}/verifications`);
    const h = rows.length ? `<div class="card" style="margin-top:16px"><div class="card-head"><h2>Verification history</h2></div><div class="table-wrap"><table><thead><tr><th>When</th><th>Result</th><th>Calculated</th><th>By</th><th>Report</th></tr></thead><tbody>${rows.map(v => `<tr><td class="nowrap">${when(v.verified_at)}</td><td>${badge(v.status)}</td><td class="mono hash">${esc((v.calculated_hash || '-').slice(0, 24))}${v.calculated_hash ? '...' : ''}</td><td>${esc(v.verified_by)}</td><td class="nowrap"><a class="btn sm" href="/api/verifications/${esc(v.id)}/report?format=pdf">PDF</a> <a class="btn sm" href="/api/verifications/${esc(v.id)}/report?format=json">JSON</a></td></tr>`).join('')}</tbody></table></div></div>` : '';
    return h;
  }
  function resultCard(v, evName) {
    return `<div class="result ${v.status.toLowerCase()}" role="status"><i data-lucide="${ICON[v.status]}"></i><div><strong>${esc(v.status)}</strong><div>${esc(MSG[v.status])}</div></div></div>
      <div class="card" style="margin-top:12px">${kvList([['Evidence', `${evName} (${v.evidence_id})`], ['Verification ID', v.id], ['Verified (local time)', when(v.verified_at)], ['Expected (recorded)', `<span class="mono hash">${esc(v.expected_hash)}</span>`, 1], ['Calculated now', `<span class="mono hash">${esc(v.calculated_hash || 'not available')}</span>`, 1],
        v.provided_hash ? ['Provided hash', `<span class="mono hash">${esc(v.provided_hash)}</span> - ${v.provided_matches_recorded ? badge('matches recorded', 'ok') : badge('does not match recorded', 'err')}`, 1] : ['', ''],
        v.error_message ? ['Error', v.error_message] : ['', '']])}
        <div class="actions" style="margin-top:12px"><a class="btn" href="/api/verifications/${esc(v.id)}/report?format=pdf"><i data-lucide="file-down"></i>Export PDF report</a><a class="btn" href="/api/verifications/${esc(v.id)}/report?format=json"><i data-lucide="braces"></i>Export JSON</a>${v.calculated_hash ? `<button class="btn" id="cp">Copy calculated hash</button>` : ''}</div></div>`;
  }
  async function showHistory(id) { out.innerHTML = id ? spinner() : ''; if (id) { out.innerHTML = await history(id) || '<p class="muted">No verifications yet for this evidence.</p>'; icons(); } }

  pick.onchange = () => { history_(pick.value); };
  const history_ = id => { window.history.replaceState(null, '', '#/integrity' + (id ? '?id=' + id : '')); showHistory(id); };
  root.querySelector('#vf').onsubmit = async e => {
    e.preventDefault();
    const id = pick.value; const prov = root.querySelector('#prov').value.trim();
    if (!id) return toast('Select an evidence item.', 'warning');
    if (prov && !/^[a-fA-F0-9]{64}$/.test(prov)) return toast('The provided hash must be exactly 64 hexadecimal characters.', 'warning');
    out.innerHTML = spinner();
    try {
      const v = await api.post(`/evidence/${id}/verify`, prov ? { expectedHash: prov } : {});
      const name = list.find(x => x.id === id)?.original_filename || id;
      out.innerHTML = resultCard(v, esc(name)) + await history(id); icons();
      out.querySelector('#cp')?.addEventListener('click', () => copyText(v.calculated_hash));
      toast(`Verification: ${v.status}`, v.status === 'MATCH' ? 'success' : 'error');
    } catch (er) { out.innerHTML = `<div class="notice err" role="alert">${esc(er.message)}</div>`; }
  };
  if (ctx.query.id) showHistory(ctx.query.id);
  icons();
}
