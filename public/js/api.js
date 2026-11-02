export class ApiError extends Error { constructor(status, body) { super(body?.error?.message || 'Request failed'); this.status = status; this.code = body?.error?.code; this.details = body?.error?.details; } }
const H = { 'X-Requested-With': 'ForenSight' };
const qs = o => { const p = new URLSearchParams(); Object.entries(o || {}).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') p.set(k, v); }); const s = p.toString(); return s ? '?' + s : ''; };

async function req(method, url, body) {
  let res;
  try { res = await fetch('/api' + url, { method, headers: body === undefined ? H : { ...H, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch { throw new ApiError(0, { error: { message: 'Cannot reach the ForenSight server. Is it running?' } }); }
  let json = null; try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok || !json || json.ok === false) throw new ApiError(res.status, json);
  return json.data;
}

export const api = {
  qs,
  get: (u, params) => req('GET', u + qs(params)),
  post: (u, b = {}) => req('POST', u, b),
  put: (u, b) => req('PUT', u, b),
  del: u => req('DELETE', u),
  // multipart upload with progress (fetch cannot report upload progress)
  upload(formData, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/api/evidence/upload'); x.setRequestHeader('X-Requested-With', 'ForenSight');
      x.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100)); };
      x.onerror = () => reject(new ApiError(0, { error: { message: 'Upload failed: server unreachable.' } }));
      x.onload = () => { let j = null; try { j = JSON.parse(x.responseText); } catch { /* ignore */ } if (x.status >= 200 && x.status < 300 && j?.ok) resolve(j.data); else reject(new ApiError(x.status, j)); };
      x.send(formData);
    });
  }
};
