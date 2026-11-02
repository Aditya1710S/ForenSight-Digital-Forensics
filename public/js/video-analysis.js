import { api } from './api.js';
import { esc, bytes, when, badge, levelBadge, empty, toast, copyText, kvList, icons, spinner } from './ui.js';

const dur = s => s == null ? '-' : `${Number(s).toFixed(2)} s`;

export async function render(root, ctx) {
  const list = (await api.get('/evidence', { type: 'video', pageSize: 100 })).items;
  root.innerHTML = `<div class="page-head"><div><h1>Video Analysis</h1><p>FFprobe metadata, derived frame extraction and contact sheets. Originals are never altered.</p></div></div>
    <div class="card"><div class="field" style="margin:0"><label for="pick">Video evidence</label>
      <select id="pick"><option value="">Select a video...</option>${list.map(e => `<option value="${esc(e.id)}" ${e.id === ctx.query.id ? 'selected' : ''}>${esc(e.original_filename)} - ${esc(e.id)}</option>`).join('')}</select></div></div>
    <div id="out" style="margin-top:16px">${list.length ? '' : empty('film', 'No video evidence yet', 'Upload an MP4, MOV or WebM into a case first.', '<a class="btn primary" href="#/evidence?upload=1">Upload evidence</a>')}</div>`;
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
    const a = analysis.result; const c = a.container || {}; const v = a.video || {}; const au = a.audio;
    const toolsOk = a.tools.ffmpeg && a.tools.ffprobe; const duration = c.durationSeconds || 0;
    const frames = artifacts.filter(x => x.kind === 'video_frame'); const sheets = artifacts.filter(x => x.kind === 'contact_sheet');
    out.innerHTML = `
      ${toolsOk ? '' : `<div class="notice warn" role="alert"><strong>FFmpeg / FFprobe not found.</strong> Metadata, frame extraction and contact sheets are unavailable. The rest of ForenSight works normally.<pre>${esc(a.setupGuidance || '')}</pre></div>`}
      <div class="grid g-2" style="margin-top:${toolsOk ? 0 : 16}px">
        <div class="card"><div class="card-head"><h2>Preview</h2><button class="btn sm" id="re"><i data-lucide="refresh-cw"></i>Re-run analysis</button></div>
          <video id="player" class="media" controls preload="metadata" src="/api/evidence/${esc(ev.id)}/preview"></video>
          <p class="small muted">Analysed ${when(analysis.createdAt)} by ${esc(analysis.analyzedBy)} - status ${badge(analysis.status)}</p></div>
        <div class="card"><div class="card-head"><h2>Stream facts</h2></div>${kvList([
          ['Filename', ev.original_filename], ['File size', bytes(ev.size_bytes)], ['Container', c.formatName ? `${c.formatName}` : ev.detected_format], ['Duration', dur(duration || null)],
          ['Resolution', v.width ? `${v.width} x ${v.height}` : '-'], ['Frame rate', v.frameRate ? `${v.frameRate} fps` : '-'], ['Video codec', v.codec], ['Audio codec', au ? `${au.codec} (${au.channels} ch, ${au.sampleRate} Hz)` : (toolsOk ? 'none' : '-')],
          ['Created (metadata)', a.creation?.creationTime || 'not present'], ['Encoder tag', a.creation?.encoder || 'not present'],
          ['Validation', `${badge(a.validation.status, a.validation.status === 'valid' ? 'ok' : a.validation.status === 'invalid' ? 'err' : 'warn')} ${esc(a.validation.message)}`, 1],
          ['Metadata status', badge(a.metadata.status.replace('_', ' '), a.metadata.status === 'extracted' ? 'ok' : 'info'), 1],
          ['SHA-256 (recorded)', `<span class="mono hash">${esc(ev.sha256)}</span> <button class="btn sm ghost" data-copy="${esc(ev.sha256)}" aria-label="Copy SHA-256"><i data-lucide="copy"></i></button>`, 1]])}</div></div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Indicators</h2></div><p class="small muted">${esc(a.limitations)}</p>
        ${a.indicators.map(i => `<div class="indicator">${levelBadge(i.level)}<div><strong>${esc(i.title)}</strong><p>${esc(i.explanation)}</p></div></div>`).join('')}</div>
      <div class="card" style="margin-top:16px"><div class="card-head"><h2>Frame extraction</h2></div>
        <form id="frameForm" class="filters" novalidate><div><label for="ts">Timestamp (seconds, 0 - ${duration ? duration.toFixed(2) : '?'})</label><input id="ts" name="timestamp" type="number" min="0" step="0.001" ${duration ? `max="${duration}"` : ''} value="0" ${toolsOk ? '' : 'disabled'}></div>
          <div style="flex:none"><button class="btn" type="button" id="useNow" ${toolsOk ? '' : 'disabled'}>Use player time</button></div>
          <div style="flex:none"><button class="btn primary" type="submit" ${toolsOk ? '' : 'disabled'}><i data-lucide="image-down"></i>Extract frame</button></div></form>
        <form id="sheetForm" class="filters" novalidate><div><label for="cnt">Contact sheet frames (2 - max)</label><input id="cnt" type="number" min="2" max="12" step="1" value="8" ${toolsOk ? '' : 'disabled'}></div>
          <div style="flex:none"><button class="btn" type="submit" ${toolsOk ? '' : 'disabled'}><i data-lucide="layout-grid"></i>Generate contact sheet</button></div></form>
        <p class="small muted">Frames are derived artifacts, hashed separately and linked to ${esc(ev.id)}. The source video is not modified.</p>
        ${(frames.length || sheets.length) ? `<div class="gallery">${[...sheets, ...frames].map(f => `<figure><img loading="lazy" alt="${esc(f.kind)} ${esc(f.id)}" src="/api/artifacts/${esc(f.id)}/preview"><figcaption><strong>${f.kind === 'contact_sheet' ? `Contact sheet (${esc(f.params.frames)} frames)` : `Frame at ${esc(Number(f.params.timestampSeconds).toFixed(3))} s`}</strong><div class="mono hash">${esc(f.sha256)}</div><div class="actions" style="margin-top:6px"><a class="btn sm" href="/api/artifacts/${esc(f.id)}/download">Download</a><button class="btn sm ghost" data-copy="${esc(f.sha256)}">Copy hash</button></div></figcaption></figure>`).join('')}</div>` : '<p class="muted">No derived frames yet.</p>'}</div>`;
    icons();
    out.querySelector('#re').onclick = async () => { try { await api.post(`/evidence/${ev.id}/analyze`); toast('Analysis refreshed', 'success'); show(ev.id); } catch (e) { toast(e.message, 'error'); } };
    out.querySelector('#useNow').onclick = () => { out.querySelector('#ts').value = out.querySelector('#player').currentTime.toFixed(3); };
    out.querySelector('#frameForm').onsubmit = async e => {
      e.preventDefault(); const ts = out.querySelector('#ts').value;
      if (ts === '' || isNaN(Number(ts)) || Number(ts) < 0) return toast('Enter a timestamp of 0 or more.', 'warning');
      if (duration && Number(ts) > duration) return toast(`Timestamp exceeds the duration (${duration.toFixed(2)} s).`, 'warning');
      try { await api.post(`/evidence/${ev.id}/video/frame`, { timestamp: Number(ts) }); toast('Frame extracted and hashed', 'success'); show(ev.id); } catch (er) { toast(er.message, 'error'); }
    };
    out.querySelector('#sheetForm').onsubmit = async e => {
      e.preventDefault(); const n = Number(out.querySelector('#cnt').value);
      if (!Number.isInteger(n) || n < 2) return toast('Enter a whole number of at least 2.', 'warning');
      try { await api.post(`/evidence/${ev.id}/video/contact-sheet`, { count: n }); toast('Contact sheet created', 'success'); show(ev.id); } catch (er) { toast(er.message, 'error'); }
    };
  }
  root.querySelector('#pick').onchange = e => { history.replaceState(null, '', '#/video' + (e.target.value ? '?id=' + e.target.value : '')); show(e.target.value); };
  if (ctx.query.id) show(ctx.query.id);
  icons();
}
