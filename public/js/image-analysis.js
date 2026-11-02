import { api } from './api.js';
import { esc, bytes, when, badge, levelBadge, empty, toast, copyText, kvList, icons, spinner } from './ui.js';

const DISCLAIMER = 'Visual differences alone do not prove manipulation. Derived copies are for inspection only; the original is never modified.';
const DERIVE_LABEL = { preview: 'Resized preview', grayscale: 'Grayscale', contrast: 'Contrast-normalised' };

function metaTable(fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return '<p class="muted">No embedded metadata was found. This is common and is not evidence of tampering.</p>';
  return `<div class="table-wrap"><table><thead><tr><th>Field</th><th>Value</th><th></th></tr></thead><tbody>${keys.map(k => `<tr><td class="mono">${esc(k)}</td><td class="hash">${esc(fields[k])}</td><td class="right"><button class="btn sm ghost" data-copy="${esc(fields[k])}" aria-label="Copy ${esc(k)}"><i data-lucide="copy"></i></button></td></tr>`).join('')}</tbody></table></div>`;
}

export async function render(root, ctx) {
  const list = (await api.get('/evidence', { type: 'image', pageSize: 100 })).items;
  root.innerHTML = `<div class="page-head"><div><h1>Image Analysis</h1><p>Metadata, validation and preliminary indicators. Missing metadata is normal, not proof of tampering.</p></div></div>
    <div class="card"><div class="field" style="margin:0"><label for="pick">Image evidence</label>
      <select id="pick"><option value="">Select an image...</option>${list.map(e => `<option value="${esc(e.id)}" ${e.id === ctx.query.id ? 'selected' : ''}>${esc(e.original_filename)} - ${esc(e.id)}</option>`).join('')}</select></div></div>
    <div id="out" style="margin-top:16px">${list.length ? '' : empty('image', 'No image evidence yet', 'Upload a JPG, PNG or WebP into a case first.', '<a class="btn primary" href="#/evidence?upload=1">Upload evidence</a>')}</div>`;
  const out = root.querySelector('#out');
  root.addEventListener('click', e => { const c = e.target.closest('[data-copy]'); if (c) copyText(c.dataset.copy); });

  async function show(id) {
    if (!id) { out.innerHTML = ''; return; }
    out.innerHTML = spinner();
    try {
      let r = await api.get(`/evidence/${id}/analysis`);
      if (!r.analysis) { await api.post(`/evidence/${id}/analyze`); r = await api.get(`/evidence/${id}/analysis`); }
      draw(r);
    } catch (e) { out.innerHTML = `<div class="notice err" role="alert">${esc(e.message)}</div>`; }
  }

  function draw({ evidence: ev, analysis, artifacts }) {
    const a = analysis.result; const m = a.metadata || { fields: {}, camera: {}, dates: {} };
    const derived = artifacts.filter(x => x.kind.startsWith('image_'));
    out.innerHTML = `
      <div class="grid g-2">
        <div class="card"><div class="card-head"><h2>Preview</h2><span class="actions"><button class="btn sm" id="re"><i data-lucide="refresh-cw"></i>Re-run analysis</button></span></div>
          <img class="media" alt="Preview of ${esc(ev.original_filename)}" src="/api/evidence/${esc(ev.id)}/preview" style="background:var(--surface-2)">
          <p class="small muted">Analysed ${when(analysis.createdAt)} by ${esc(analysis.analyzedBy)} - status: ${badge(analysis.status)}</p></div>
        <div class="card"><div class="card-head"><h2>File facts</h2></div>${kvList([
          ['Filename', ev.original_filename], ['File size', bytes(ev.size_bytes)], ['Dimensions', a.file.width ? `${a.file.width} x ${a.file.height} px` : 'unknown'], ['Format', ev.detected_format], ['MIME type', ev.mime_type],
          ['Validation', `${badge(a.validation.status === 'valid' ? 'Valid' : 'Invalid', a.validation.status === 'valid' ? 'ok' : 'err')} ${esc(a.validation.message)}`, 1],
          ['Metadata status', `${badge(m.status.replace('_', ' '), m.status === 'extracted' ? 'ok' : m.status === 'error' ? 'err' : 'info')} via ${esc(m.source)}${m.message ? ' - ' + esc(m.message) : ''}`, 1],
          ['SHA-256 (recorded)', `<span class="mono hash">${esc(ev.sha256)}</span> <button class="btn sm ghost" data-copy="${esc(ev.sha256)}" aria-label="Copy SHA-256"><i data-lucide="copy"></i></button>`, 1],
          ['Camera', [m.camera.make, m.camera.model].filter(Boolean).join(' ') || 'not present'], ['Original date', m.dates.original || 'not present'], ['Create date', m.dates.created || 'not present'], ['Modify date', m.dates.modified || 'not present'], ['Software tag', m.software || 'not present'],
          ['GPS', m.gps ? `${m.gps.latitude.toFixed(6)}, ${m.gps.longitude.toFixed(6)} (embedded in file; not sent anywhere)` : 'not present']])}
          ${a.image ? `<h3 style="margin-top:14px">Image properties</h3>${kvList([['Colour space', a.image.colourSpace], ['Channels', a.image.channels], ['Bit depth', a.image.bitDepth], ['Alpha channel', a.image.hasAlpha ? 'yes' : 'no'], ['EXIF block', a.image.hasExifBlock ? 'present' : 'absent'], ['ICC profile', a.image.hasIccProfile ? 'present' : 'absent']])}` : ''}</div></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Metadata</h2></div><div class="notice" style="margin-bottom:10px">Metadata is self-reported by the file and can be edited or fabricated. It is shown for review, not as proof of authenticity.</div>${metaTable(m.fields)}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Preliminary forensic indicators</h2></div><p class="small muted">${esc(a.limitations)}</p>
        ${a.indicators.map(i => `<div class="indicator">${levelBadge(i.level)}<div><strong>${esc(i.title)}</strong><p>${esc(i.explanation)}</p></div></div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Comparison workspace</h2><span class="actions">${Object.entries(DERIVE_LABEL).map(([k, l]) => `<button class="btn sm" data-derive="${k}">${esc(l)}</button>`).join('')}</span></div>
        <div class="notice warn">${esc(DISCLAIMER)}</div>
        ${derived.length ? `<div class="grid g-2" style="margin:12px 0"><div class="field" style="margin:0"><label for="dsel">Derived artifact</label><select id="dsel">${derived.map(d => `<option value="${esc(d.id)}">${esc(DERIVE_LABEL[d.params.mode] || d.kind)} - ${esc(d.id)}</option>`).join('')}</select></div><div class="field" style="margin:0"><label for="zoom">Zoom <span id="zv">100%</span></label><input id="zoom" type="range" min="25" max="300" value="100" step="5"></div></div>
        <div class="compare"><figure><figcaption>Original</figcaption><img id="cmpA" alt="Original" src="/api/evidence/${esc(ev.id)}/preview"></figure><figure><figcaption id="capB">Derived</figcaption><img id="cmpB" alt="Derived copy" src="/api/artifacts/${esc(derived[0].id)}/preview"></figure></div>
        <p class="small muted" id="dmeta"></p>` : '<p class="muted" style="margin-top:12px">Create a derived copy to compare it side by side with the original.</p>'}</div>`;
    icons();
    out.querySelector('#re').onclick = async () => { try { await api.post(`/evidence/${ev.id}/analyze`); toast('Analysis refreshed', 'success'); show(ev.id); } catch (e) { toast(e.message, 'error'); } };
    out.querySelectorAll('[data-derive]').forEach(b => b.onclick = async () => { b.disabled = true; try { await api.post(`/evidence/${ev.id}/image/derive`, { mode: b.dataset.derive }); toast('Derived copy created and hashed', 'success'); show(ev.id); } catch (e) { toast(e.message, 'error'); b.disabled = false; } });
    const sel = out.querySelector('#dsel');
    if (sel) {
      const upd = () => { const d = derived.find(x => x.id === sel.value); out.querySelector('#cmpB').src = `/api/artifacts/${d.id}/preview`; out.querySelector('#capB').textContent = `Derived: ${DERIVE_LABEL[d.params.mode] || d.kind}`;
        out.querySelector('#dmeta').innerHTML = `Derived artifact ${esc(d.id)} - SHA-256 <span class="mono hash">${esc(d.sha256)}</span> - <a href="/api/artifacts/${esc(d.id)}/download">download</a>`; };
      sel.onchange = upd; upd();
      out.querySelector('#zoom').oninput = e => { const z = e.target.value / 100; out.querySelector('#zv').textContent = e.target.value + '%'; ['cmpA', 'cmpB'].forEach(i => { const im = out.querySelector('#' + i); im.style.transform = `scale(${z})`; }); };
    }
  }
  root.querySelector('#pick').onchange = e => { history.replaceState(null, '', '#/image' + (e.target.value ? '?id=' + e.target.value : '')); show(e.target.value); };
  if (ctx.query.id) show(ctx.query.id);
  icons();
}
