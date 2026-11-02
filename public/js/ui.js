// Shared UI helpers. Every dynamic value that reaches innerHTML goes through esc().
export const esc = v => String(v ?? '').replace(/[&<>"'`]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }[c]));
export const bytes = n => { n = Number(n); if (!Number.isFinite(n)) return '-'; const u = ['B', 'KB', 'MB', 'GB']; let i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return `${n.toFixed(i ? 1 : 0)} ${u[i]}`; };
export const when = iso => { if (!iso) return '-'; const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString(); };
export const slug = s => String(s).toLowerCase().replace(/[^a-z]+/g, '-');
export const badge = (text, cls) => `<span class="badge ${esc(cls || slug(text))}">${esc(text)}</span>`;
export const demoBadge = f => f ? ' <span class="badge demo" title="Synthetic demonstration record">DEMO</span>' : '';
export const icons = () => { if (window.lucide) window.lucide.createIcons(); };
export const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const spinner = () => '<div class="spinner" role="status" aria-label="Loading"></div>';
export const empty = (icon, title, text, action = '') => `<div class="empty"><i data-lucide="${icon}"></i><h3>${esc(title)}</h3><p>${esc(text)}</p>${action}</div>`;
export const levelBadge = l => badge(l, l === 'Error' ? 'err' : l === 'Warning' ? 'warn' : 'info');

export function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`; el.setAttribute('role', type === 'error' ? 'alert' : 'status'); el.textContent = message;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 7000 : 3800);
}

const dlg = () => document.getElementById('modal');
export function openModal({ title, body, actions = '', onOpen }) {
  const d = dlg();
  d.innerHTML = `<div class="modal-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Close"><i data-lucide="x"></i></button></div><div class="modal-body">${body}</div>${actions ? `<div class="modal-foot">${actions}</div>` : ''}`;
  d.onclick = e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); };
  icons(); if (!d.open) d.showModal(); if (onOpen) onOpen(d); return d;
}
export const closeModal = () => { const d = dlg(); if (d.open) d.close(); };
export function confirmBox(title, message, okLabel = 'Confirm', danger = false) {
  return new Promise(res => {
    const d = openModal({ title, body: `<p>${esc(message)}</p>`, actions: `<button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cfOk">${esc(okLabel)}</button>` });
    d.querySelector('#cfOk').onclick = () => { res(true); d.close(); };
    d.addEventListener('close', () => res(false), { once: true });
  });
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied to clipboard', 'success'); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); toast('Copied to clipboard', 'success'); } catch { toast('Copy failed', 'error'); } t.remove(); }
}
export function pager(page, pageSize, total) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return `<div class="pager"><span>${total} result${total === 1 ? '' : 's'} - page ${page} of ${pages}</span><span class="actions"><button class="btn sm" data-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button><button class="btn sm" data-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button></span></div>`;
}
export function fieldErrors(form, details = {}) {
  form.querySelectorAll('.err').forEach(e => e.remove());
  for (const [k, msg] of Object.entries(details)) {
    const input = form.elements[k]; if (!input) continue;
    const p = document.createElement('div'); p.className = 'err'; p.textContent = msg; input.closest('.field')?.appendChild(p);
    input.setAttribute('aria-invalid', 'true');
  }
}
export const kvList = rows => `<dl class="kv">${rows.filter(r => r[1] !== undefined && r[1] !== null && r[1] !== '').map(([k, v, raw]) => `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>`).join('')}</dl>`;
export const tmpl = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d; };
