import { api } from './api.js';
import { esc, toast, kvList, badge, fieldErrors, icons } from './ui.js';

export async function render(root, ctx) {
  const s = await api.get('/settings'); const t = s.tools; const ro = s.readOnly;
  const tool = (n, x) => [n, `${badge(x.available ? 'Available' : 'Not found', x.available ? 'ok' : 'warn')} ${x.version ? esc(x.version) : ''}`, 1];
  root.innerHTML = `<div class="page-head"><div><h1>Settings</h1><p>Local configuration. Limits and tool paths are set in <code>.env</code>.</p></div></div>
    <div class="grid g-2"><div class="card"><div class="card-head"><h2>Investigator</h2></div>
      <form id="sf" novalidate><div class="field"><label for="alias">Investigator alias</label><input id="alias" name="investigatorAlias" maxlength="60" value="${esc(s.investigatorAlias)}"><div class="hint">Recorded on audit events. It is self-declared; ForenSight does not verify real-world identity.</div></div>
        <div class="field"><label for="cs">Contact-sheet frame limit (2 - ${ro.contactSheetHardLimit})</label><input id="cs" name="contactSheetMaxFrames" type="number" min="2" max="${ro.contactSheetHardLimit}" value="${esc(s.contactSheetMaxFrames)}"></div>
        <button class="btn primary" type="submit">Save settings</button></form></div>
      <div class="card"><div class="card-head"><h2>External tools</h2></div>${kvList([tool('FFmpeg', t.ffmpeg), tool('FFprobe', t.ffprobe), tool('ExifTool', t.exiftool)])}
        ${!t.ffmpeg.available || !t.ffprobe.available ? `<div class="notice warn" style="margin-top:12px"><pre>${esc(t.guidance || '')}</pre></div>` : ''}
        ${!t.exiftool.available ? '<p class="small muted">ExifTool is optional. Without it, a limited built-in EXIF reader is used. Install from exiftool.org and add it to PATH (or set EXIFTOOL_PATH).</p>' : ''}</div></div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Runtime configuration (read-only)</h2></div>${kvList([['Max upload size', `${ro.maxUploadMb} MB`], ['Allowed extensions', ro.allowedExtensions.join(', ')], ['Process timeout', `${ro.processTimeoutMs} ms`], ['Concurrent media jobs', ro.maxConcurrentJobs], ['Demo mode', ro.demoMode ? 'Enabled (synthetic records are marked DEMO)' : 'Disabled']])}</div>
    <div class="card" style="margin-top:16px"><div class="card-head"><h2>Evidence-handling notice</h2></div><p>ForenSight is intended for a trusted local environment. Handle evidence only with proper authorization and follow your organisation's legal and privacy requirements. Hashes, metadata and indicators produced here support review; they do not independently establish authenticity, origin or legal admissibility. Nothing is sent to third-party services.</p></div>`;
  root.querySelector('#sf').onsubmit = async e => {
    e.preventDefault(); const f = e.target;
    try { await api.put('/settings', { investigatorAlias: f.elements.investigatorAlias.value, contactSheetMaxFrames: Number(f.elements.contactSheetMaxFrames.value) }); toast('Settings saved', 'success'); ctx.refreshChrome(); }
    catch (er) { if (er.details) fieldErrors(f, er.details); toast(er.message, 'error'); }
  };
  icons();
}
