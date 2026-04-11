// ════════════════════════════════════════════════════════════════════════════
//  Portfolio Admin — app.js
//  Pure vanilla ES6+. No frameworks, no build step.
// ════════════════════════════════════════════════════════════════════════════

// ── Template registry ────────────────────────────────────────────────────────
//  Single source of truth for available templates.
//  value  → stored in data model / used by frontend renderer
//  label  → human-friendly name shown in dropdowns
const TEMPLATES = [
  { value: 'intro',               label: 'Intro'                              },
  { value: 'carousel',            label: 'Carousel — like People'             },
  { value: 'grid',                label: 'Grid — like Things'                 },
  { value: 'fullscreen-carousel', label: 'Fullscreen Carousel — like Personal'},
  { value: 'info',                label: 'Info / About'                       },
  { value: 'archive',             label: 'Archive'                            },
  { value: 'archive-standalone',  label: 'Archive — Standalone (external)'   },
  { value: 'filmstrip',           label: 'Filmstrip Gallery'                  },
  { value: 'custom',              label: 'Custom'                             },
];

/** Build <option> tags for a <select>, with the given value pre-selected. */
function templateOptions(selected) {
  return TEMPLATES.map(t =>
    `<option value="${t.value}" ${t.value === selected ? 'selected' : ''}>${esc(t.label)}</option>`
  ).join('');
}

/**
 * Resolve the live URL for a page record.
 * - archive-standalone pages live at /<id>.html (static standalone files)
 * - all other pages live inside index.html at /#<slug-or-id>
 */
function pagePreviewUrl(page) {
  if (page.template === 'archive-standalone' || page.template === 'filmstrip') {
    return `/${page.id}.html`;
  }
  // Main SPA pages: open root; hash is for informational clarity only
  return '/';
}

// ── Debug mode ───────────────────────────────────────────────────────────────
//  Activate:   append ?debug=1 to the URL  OR  run in browser console:
//              localStorage.setItem('cms_debug','1'); location.reload();
//  Deactivate: localStorage.removeItem('cms_debug'); location.reload();
const DEBUG = new URLSearchParams(location.search).get('debug') === '1'
           || localStorage.getItem('cms_debug') === '1';

const log = {
  info:  (...a) => { if (DEBUG) console.info( '%c[CMS]', 'color:#3b82f6;font-weight:600', ...a); },
  warn:  (...a) => { if (DEBUG) console.warn( '%c[CMS]', 'color:#f59e0b;font-weight:600', ...a); },
  error: (...a) =>              console.error('%c[CMS]', 'color:#ef4444;font-weight:600', ...a),
  group: (label, fn) => { if (!DEBUG) return; console.group(`[CMS] ${label}`); try { fn(); } finally { console.groupEnd(); } },
};

if (DEBUG) {
  console.info('%c[CMS] Debug mode ON', 'background:#1e40af;color:#fff;padding:2px 8px;border-radius:4px;font-weight:600');
}

// ── Auth ────────────────────────────────────────────────────────────────────
let authPassword = sessionStorage.getItem('cms_auth') || '';
let authEmail    = sessionStorage.getItem('cms_auth_email') || '';

function getHeaders(isUpload = false) {
  const h = { 'X-Admin-Password': authPassword };
  if (authEmail) h['X-Admin-Email'] = authEmail;
  if (!isUpload) h['Content-Type'] = 'application/json';
  return h;
}

// ── API helper ───────────────────────────────────────────────────────────────
const api = {
  async _fetch(method, path, body = null, isUpload = false) {
    log.info(`${method} ${path}`);
    const opts = { method, headers: getHeaders(isUpload) };
    if (body && !isUpload) opts.body = JSON.stringify(body);
    if (body && isUpload)  opts.body = body;

    let res;
    try {
      res = await fetch(path, opts);
    } catch (networkErr) {
      log.error(`Network error on ${method} ${path}:`, networkErr.message);
      throw new Error(
        'No se pudo conectar al servidor. ' +
        'Verifica que esté corriendo: python3 server.py'
      );
    }

    if (res.status === 401) { logout(); return null; }

    if (!res.ok) {
      let errBody;
      try { errBody = await res.json(); } catch { errBody = { error: res.statusText }; }
      const msg    = errBody.error || errBody.message || `Error ${res.status}`;
      const detail = errBody.detail || errBody.traceback || null;
      log.error(`${method} ${path} → ${res.status}:`, msg, detail || '');
      const err    = new Error(msg);
      err.status   = res.status;
      err.detail   = detail;
      err.body     = errBody;
      throw err;
    }

    if (res.status === 204) return null;
    const data = await res.json();
    log.info(`${method} ${path} → OK`, DEBUG ? data : `(${typeof data})`);
    return data;
  },
  get:    (path)        => api._fetch('GET',    path),
  post:   (path, body)  => api._fetch('POST',   path, body),
  put:    (path, body)  => api._fetch('PUT',    path, body),
  del:    (path)        => api._fetch('DELETE', path),
  upload: (path, form)  => api._fetch('POST',   path, form, true),
};

// ── Toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function slugify(str) {
  return str.toLowerCase()
    .replace(/[áàâä]/g, 'a').replace(/[éèêë]/g, 'e')
    .replace(/[íìîï]/g, 'i').replace(/[óòôö]/g, 'o')
    .replace(/[úùûü]/g, 'u').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function statusBadge(status) {
  const map = { published: 'badge-published', draft: 'badge-draft', archived: 'badge-archived' };
  const label = { published: 'Published', draft: 'Draft', archived: 'Archived' };
  return `<span class="badge ${map[status] || 'badge-draft'}">${label[status] || status}</span>`;
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Router ────────────────────────────────────────────────────────────────────
function route() {
  const hash = location.hash.slice(1) || 'dashboard';
  const parts = hash.split('/');
  const view  = parts[0];
  const id    = parts[1];

  // Update sidebar active state
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === view);
  });

  const views = {
    dashboard:  () => renderDashboard(),
    pages:      () => renderPages(),
    page:       () => renderPageEditor(id),
    projects:   () => renderProjects(id),
    project:    () => renderProjectEditor(id),
    navigation: () => renderNavigation(),
    images:     () => renderImages(),
    settings:   () => renderSettings(),
  };
  (views[view] || views.dashboard)();
}

window.addEventListener('hashchange', route);

// ── Login / Logout ────────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('admin-app').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('admin-app').classList.remove('hidden');
  route();
}

function logout() {
  sessionStorage.removeItem('cms_auth');
  sessionStorage.removeItem('cms_auth_email');
  authPassword = '';
  authEmail    = '';
  showLogin();
}

async function checkServerVersion() {
  // Verify the running server has all required endpoints.
  // If /api/library returns 404, the server is an old version and needs restart.
  try {
    const pingData = await api.get('/api/ping');
    // New server includes "debug" field in ping response
    if (pingData && !('debug' in pingData)) {
      log.warn('Server is an older version (no "debug" in /api/ping response)');
    }
    // Confirm critical endpoint exists
    await api.get('/api/library');
    return true;
  } catch(e) {
    if (e.status === 404) {
      // Show a clear restart-server message
      setView(`
        <div class="view">
          <div class="error-state">
            <div class="error-state-icon">🔄</div>
            <div class="error-state-title">El servidor necesita reiniciarse</div>
            <div class="error-state-detail">El servidor que está corriendo es una versión anterior
sin el endpoint /api/library.
Detén el servidor y reinícialo:</div>
            <div style="background:#111;color:#a3e635;font-family:var(--mono);font-size:13px;padding:12px 18px;border-radius:6px;margin-top:4px;text-align:left">
              <div style="color:#6b7280;margin-bottom:4px"># En tu terminal:</div>
              <div>Ctrl + C   &nbsp;&nbsp;&nbsp;← detener servidor</div>
              <div style="margin-top:6px">python3 server.py &nbsp;&nbsp;← iniciar de nuevo</div>
            </div>
            <button class="btn btn-secondary" onclick="location.reload()">↺ Reintentar</button>
          </div>
        </div>
      `);
      return false;
    }
    throw e;
  }
}

async function init() {
  if (!authPassword) { showLogin(); return; }
  try {
    await api.get('/api/ping');
    // If a 401 occurred, logout() already cleared authPassword and showed login — stop here.
    if (!authPassword) return;
    const ok = await checkServerVersion();
    if (ok) showApp();
  } catch {
    showLogin();
  }
}

document.getElementById('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const pw    = document.getElementById('login-password').value;
  const email = (document.getElementById('login-email')?.value || '').trim();
  const err   = document.getElementById('login-error');
  authPassword = pw;
  authEmail    = email;
  try {
    await api.get('/api/ping');
    sessionStorage.setItem('cms_auth', pw);
    if (email) sessionStorage.setItem('cms_auth_email', email);
    err.classList.add('hidden');
    const ok = await checkServerVersion();
    if (ok) showApp();
  } catch {
    err.classList.remove('hidden');
    authPassword = '';
    authEmail    = '';
  }
});

document.getElementById('btn-logout').addEventListener('click', logout);

// ── View rendering helpers ────────────────────────────────────────────────────
function setView(html) {
  document.getElementById('view-container').innerHTML = html;
}

function loading(msg = 'Loading…') {
  setView(`<div class="loading">${esc(msg)}</div>`);
}

/** Full-view error state — shown when a top-level fetch fails */
function setError(msg, detail = null) {
  log.error('setError:', msg, detail || '');
  const detailHtml = detail
    ? `<div class="error-state-detail">${esc(detail)}</div>`
    : '';
  const debugHint = DEBUG
    ? '<div class="error-state-hint">Debug mode ON — check browser console (F12) for details</div>'
    : '<div class="error-state-hint">Activa debug mode añadiendo <code>?debug=1</code> a la URL para más detalles</div>';
  setView(`
    <div class="view">
      <div class="error-state">
        <div class="error-state-icon">⚠️</div>
        <div class="error-state-title">${esc(msg)}</div>
        ${detailHtml}
        ${debugHint}
        <div style="display:flex;gap:8px;margin-top:4px">
          <button class="btn btn-secondary" onclick="route()">↺ Reintentar</button>
          <a href="#dashboard" class="btn btn-ghost">← Dashboard</a>
        </div>
      </div>
    </div>
  `);
}

/** Empty-state HTML snippet — embed inside panels */
function emptyState(title, hint = '') {
  return `
    <div class="empty-state">
      <div class="empty-state-icon">📭</div>
      <div class="empty-state-title">${esc(title)}</div>
      ${hint ? `<div class="empty-state-hint">${esc(hint)}</div>` : ''}
    </div>
  `;
}

/** Inline banner error — shown inside a panel or form area */
function bannerError(msg) {
  return `<div class="banner-error">
    <span style="font-size:16px">⚠</span>
    <span>${esc(msg)}</span>
  </div>`;
}

// ── Form validation helpers ───────────────────────────────────────────────────
function showFieldError(fieldId, msg) {
  const field = document.getElementById(fieldId);
  if (!field) return;
  field.classList.add('field-error');
  const wrap = field.closest('.field-group') || field.parentElement;
  const existing = wrap.querySelector('.field-error-msg');
  if (existing) existing.remove();
  const span = document.createElement('span');
  span.className = 'field-error-msg';
  span.textContent = msg;
  wrap.appendChild(span);
  field.focus();
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach(el => el.classList.remove('field-error'));
  document.querySelectorAll('.field-error-msg').forEach(el => el.remove());
}

// ════════════════════════════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════════════════════════════
async function renderDashboard() {
  loading('Cargando dashboard…');
  let pages, images;
  try {
    [pages, images] = await Promise.all([
      api.get('/api/pages'),
      api.get('/api/library'),
    ]);
  } catch(e) {
    setError('No se pudo cargar el dashboard', e.message);
    return;
  }
  if (!pages || !images) return;

  const published = pages.filter(p => p.status === 'published').length;
  const drafts    = pages.filter(p => p.status === 'draft').length;
  const inMenu    = pages.filter(p => p.inMenu).length;

  setView(`
    <div class="view">
      <div class="view-header">
        <div>
          <div class="view-title">Dashboard</div>
          <div class="view-subtitle">Portfolio overview</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-value">${images.length}</div>
          <div class="stat-label">Images</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${pages.length}</div>
          <div class="stat-label">Pages</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${published}</div>
          <div class="stat-label">Published</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${drafts}</div>
          <div class="stat-label">Drafts</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">${inMenu}</div>
          <div class="stat-label">In Menu</div>
        </div>
      </div>

      <div class="section-heading">Quick access</div>
      <div class="quick-grid">
        <a href="#pages" class="quick-card">
          <div class="quick-icon"><svg viewBox="0 0 20 20"><path d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"/></svg></div>
          Manage Pages
        </a>
        <a href="#images" class="quick-card">
          <div class="quick-icon"><svg viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clip-rule="evenodd"/></svg></div>
          Media Library
        </a>
        <a href="#navigation" class="quick-card">
          <div class="quick-icon"><svg viewBox="0 0 20 20"><path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd"/></svg></div>
          Navigation
        </a>
        <a href="#settings" class="quick-card">
          <div class="quick-icon"><svg viewBox="0 0 20 20"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg></div>
          Site Settings
        </a>
      </div>
    </div>
  `);
}

// ════════════════════════════════════════════════════════════════════════════
//  PAGES LIST
// ════════════════════════════════════════════════════════════════════════════
async function renderPages() {
  loading('Cargando páginas…');
  let pages;
  try {
    pages = await api.get('/api/pages');
  } catch(e) {
    setError('No se pudo cargar la lista de páginas', e.message);
    return;
  }
  if (!pages) return;

  const rows = pages.map(p => `
    <tr>
      <td><strong>${esc(p.title)}</strong></td>
      <td><code style="font-size:12px;color:var(--text-2)">${esc(p.slug || p.id)}</code></td>
      <td>${esc(p.template || '—')}</td>
      <td>${statusBadge(p.status)}</td>
      <td>
        <label class="toggle"><input type="checkbox" data-action="toggle-menu" data-id="${esc(p.id)}" ${p.inMenu ? 'checked' : ''} /><span class="toggle-track"></span></label>
      </td>
      <td style="text-align:center">
        ${['archive-standalone','filmstrip'].includes(p.template)
          ? `<span title="Standalone pages cannot be set as Home" style="color:var(--text-3,#aaa);font-size:13px;line-height:1">—</span>`
          : `<label title="${p.isHome ? 'Current Home Page' : 'Set as Home Page'}" style="cursor:${p.isHome ? 'default' : 'pointer'};display:inline-flex;align-items:center;justify-content:center">
          <input type="radio" name="home-page-radio" data-action="set-home" data-id="${esc(p.id)}"
            ${p.isHome ? 'checked' : ''}
            style="width:16px;height:16px;accent-color:var(--accent,#5b5ef4);cursor:${p.isHome ? 'default' : 'pointer'}" />
        </label>`}
      </td>
      <td>
        <div class="row-actions">
          <a href="#page/${esc(p.id)}" class="btn btn-sm btn-secondary">Edit</a>
          <button class="btn btn-sm btn-secondary" data-action="duplicate-page" data-id="${esc(p.id)}">Duplicate</button>
          ${!['intro','people','things','personal-v2','info','archive'].includes(p.id)
            ? `<button class="btn btn-sm btn-ghost" data-action="delete-page" data-id="${esc(p.id)}" style="color:var(--danger)">Delete</button>`
            : ''}
        </div>
      </td>
    </tr>
  `).join('');

  setView(`
    <div class="view">
      <div class="view-header">
        <div>
          <div class="view-title">Pages</div>
          <div class="view-subtitle">${pages.length} pages total</div>
        </div>
        <div class="ml-auto">
          <button class="btn btn-primary" data-action="new-page">+ New Page</button>
        </div>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr>
            <th>Title</th><th>Slug</th><th>Template</th><th>Status</th><th>In Menu</th><th style="text-align:center">Home</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `);

  // Events
  document.querySelector('[data-action="new-page"]').addEventListener('click', () => showNewPageModal());

  document.querySelectorAll('[data-action="toggle-menu"]').forEach(el => {
    el.addEventListener('change', async () => {
      const p = pages.find(x => x.id === el.dataset.id);
      if (!p) return;
      p.inMenu = el.checked;
      try { await api.put(`/api/pages/${p.id}`, p); toast('Menu updated'); }
      catch(e) { toast(e.message, 'error'); }
    });
  });

  document.querySelectorAll('[data-action="set-home"]').forEach(el => {
    el.addEventListener('change', async () => {
      if (!el.checked) return;
      const newHome = pages.find(x => x.id === el.dataset.id);
      if (!newHome) return;
      // Optimistic inline update — no full re-render
      const prevChecked = el; // already checked by browser
      try {
        await api.put(`/api/pages/${newHome.id}`, { ...newHome, isHome: true });
        // Update local pages array
        pages.forEach(x => { x.isHome = (x.id === newHome.id); });
        // Update all radios + their parent label attributes inline
        document.querySelectorAll('[data-action="set-home"]').forEach(r => {
          const isThis = r.dataset.id === newHome.id;
          r.checked = isThis;
          r.style.cursor = isThis ? 'default' : 'pointer';
          const lbl = r.closest('label');
          if (lbl) {
            lbl.title = isThis ? 'Current Home Page' : 'Set as Home Page';
            lbl.style.cursor = isThis ? 'default' : 'pointer';
          }
        });
        toast(`"${newHome.title}" set as Home Page`);
      } catch(e) {
        toast(e.message, 'error');
        el.checked = false;
      }
    });
  });

  document.querySelectorAll('[data-action="duplicate-page"]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('Duplicate this page?')) return;
      try {
        const np = await api.post(`/api/pages/${el.dataset.id}/duplicate`, {});
        toast(`Page duplicated as "${np.title}"`);
        renderPages();
      } catch(e) { toast(e.message, 'error'); }
    });
  });

  document.querySelectorAll('[data-action="delete-page"]').forEach(el => {
    el.addEventListener('click', async () => {
      if (!confirm('Delete this page? This cannot be undone.')) return;
      try {
        await api.del(`/api/pages/${el.dataset.id}`);
        toast('Page deleted');
        renderPages();
      } catch(e) { toast(e.message, 'error'); }
    });
  });
}

function showNewPageModal() {
  const existing = document.getElementById('new-page-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'new-page-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div class="card" style="width:440px;padding:28px">
      <h2 style="font-size:17px;font-weight:700;margin-bottom:20px">New Page</h2>
      <div class="form-grid cols-1" style="gap:14px">
        <div class="field-group">
          <label class="field-label">Title</label>
          <input class="field-input" id="np-title" placeholder="e.g. Films" />
        </div>
        <div class="field-group">
          <label class="field-label">Slug</label>
          <div class="slug-field"><span class="slug-prefix">/</span><input class="field-input" id="np-slug" placeholder="films" /></div>
        </div>
        <div class="field-group">
          <label class="field-label">Template</label>
          <select class="field-select" id="np-template">
            ${templateOptions('carousel')}
          </select>
        </div>
      </div>
      <div class="flex gap-3 mt-4" style="justify-content:flex-end">
        <button class="btn btn-secondary" id="np-cancel">Cancel</button>
        <button class="btn btn-primary" id="np-create">Create Page</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const titleEl = document.getElementById('np-title');
  const slugEl  = document.getElementById('np-slug');
  let userEditedSlug = false;

  titleEl.addEventListener('input', () => {
    if (!userEditedSlug) slugEl.value = slugify(titleEl.value);
  });
  slugEl.addEventListener('input', () => { userEditedSlug = true; });
  titleEl.focus();

  document.getElementById('np-cancel').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  document.getElementById('np-create').addEventListener('click', async () => {
    const title    = titleEl.value.trim();
    const slug     = slugEl.value.trim() || slugify(title);
    const template = document.getElementById('np-template').value;
    if (!title) { titleEl.focus(); return; }
    try {
      const np = await api.post('/api/pages', {
        id: slug, title, slug, template,
        status: 'draft', inMenu: false,
        sections: [],
        seo: { pageTitle: title, metaDescription: '', ogImage: '', indexable: true }
      });
      modal.remove();
      toast(`Page "${np.title}" created`);
      location.hash = `#page/${np.id}`;
    } catch(e) { toast(e.message, 'error'); }
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  PAGE EDITOR
// ════════════════════════════════════════════════════════════════════════════
async function renderPageEditor(pageId) {
  if (!pageId) {
    setError('ID de página inválido', 'No se proporcionó un ID en la URL.');
    return;
  }
  loading('Cargando editor…');
  let page, library;
  try {
    page = await api.get(`/api/pages/${pageId}`);
  } catch(e) {
    const detail = e.status === 404
      ? `La página "${pageId}" no existe.`
      : e.message;
    setError('No se pudo cargar el editor de página', detail);
    return;
  }
  try {
    library = await api.get('/api/library');
  } catch(e) {
    setError('No se pudo cargar la biblioteca de imágenes', e.message);
    return;
  }
  if (!page || !library) return;

  const imgMap    = Object.fromEntries(library.map(img => [img.id, img]));
  let pageGallery = (page.gallery || []).map(item => ({ ...item })); // {imageId,alt,caption}
  let dragGalSrc  = null;

  const sectionsHtml = (page.sections || []).map(s => `
    <div class="section-item">
      <label class="toggle">
        <input type="checkbox" class="section-toggle" data-sid="${esc(s.id)}" ${s.enabled ? 'checked' : ''} />
        <span class="toggle-track"></span>
      </label>
      <span class="section-name">${esc(s.label)}</span>
    </div>
  `).join('') || '<p style="color:var(--text-3);font-size:13px">No sections defined for this page.</p>';

  // ── Template-specific content panel ──────────────────────────────────────
  const _c = page.content || {};
  let contentPanelHtml = '';
  if (page.template === 'intro') {
    contentPanelHtml = `
      <div class="panel">
        <div class="panel-header">Page Content</div>
        <div class="panel-body">
          <p style="font-size:13px;color:var(--text-2);margin-bottom:14px">
            Textos específicos de la página de intro. El nombre y tagline se editan en Settings.
          </p>
          <div class="form-grid cols-1">
            <div class="field-group">
              <label class="field-label">Tagline (debajo del nombre)</label>
              <input class="field-input" id="pc-tagline"
                value="${esc(_c.tagline || 'Melbourne based. Photographer & Art-director. EST 2020')}" />
              <span class="field-hint">Texto que aparece bajo el nombre en la intro.</span>
            </div>
            <div class="field-group">
              <label class="field-label">Footer — Label</label>
              <input class="field-input" id="pc-footer-cta1"
                value="${esc(_c.footerCta1 || 'Got a project?')}" />
            </div>
            <div class="field-group">
              <label class="field-label">Footer — CTA heading</label>
              <input class="field-input" id="pc-footer-cta2"
                value="${esc(_c.footerCta2 || "Let's work together.")}" />
            </div>
          </div>
        </div>
      </div>
    `;
  } else if (page.template === 'info') {
    contentPanelHtml = `
      <div class="panel">
        <div class="panel-header">Page Content</div>
        <div class="panel-body">
          <p style="font-size:13px;color:var(--text-2);margin-bottom:14px">
            Textos de la página de info. La bio, foto, email e Instagram principal se editan en Settings.
          </p>
          <div class="form-grid cols-1">
            <div class="field-group">
              <label class="field-label">Section label</label>
              <input class="field-input" id="pc-label"
                value="${esc(_c.label || 'About')}" />
              <span class="field-hint">Pequeño label encima del nombre ("About").</span>
            </div>
            <div class="field-group">
              <label class="field-label">Role / location line</label>
              <input class="field-input" id="pc-role"
                value="${esc(_c.role || 'Melbourne based. Photographer & Art-director.')}" />
              <span class="field-hint">Línea de rol debajo del nombre.</span>
            </div>
            <div class="field-group">
              <label class="field-label">Second Instagram — handle</label>
              <input class="field-input" id="pc-ig2-label"
                value="${esc(_c.instagram2Label || '@babyjuanmoretime')}" />
            </div>
            <div class="field-group">
              <label class="field-label">Second Instagram — URL</label>
              <input class="field-input" id="pc-ig2-url"
                value="${esc(_c.instagram2Url || 'https://instagram.com/babyjuanmoretime')}"
                placeholder="https://instagram.com/..." />
            </div>
          </div>
        </div>
      </div>
    `;
  }

  setView(`
    <div class="view">
      <div class="breadcrumb">
        <a href="#pages">Pages</a>
        <span class="sep">›</span>
        <span>${esc(page.title)}</span>
      </div>

      <div class="view-header">
        <div class="view-title">Edit: ${esc(page.title)}</div>
        <div class="ml-auto flex gap-3">
          <button class="btn btn-secondary" id="page-preview-btn">View Site</button>
          <button class="btn btn-primary"   id="page-save-btn">Save Changes</button>
        </div>
      </div>

      <div class="editor-layout">
        <!-- Main column -->
        <div class="editor-main">

          <!-- Basic info -->
          <div class="panel">
            <div class="panel-header">Page Info</div>
            <div class="panel-body">
              <div class="form-grid">
                <div class="field-group">
                  <label class="field-label">Title</label>
                  <input class="field-input" id="pe-title" value="${esc(page.title)}" />
                </div>
                <div class="field-group">
                  <label class="field-label">Menu Label</label>
                  <input class="field-input" id="pe-menulabel" value="${esc(page.menuLabel || page.title)}" />
                </div>
                <div class="field-group span-2">
                  <label class="field-label">Slug</label>
                  <div class="slug-field">
                    <span class="slug-prefix">/</span>
                    <input class="field-input field-mono" id="pe-slug" value="${esc(page.slug || page.id)}" />
                  </div>
                  <span class="field-hint">URL del sitio cuando se navega a esta página.</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Sections -->
          <div class="panel">
            <div class="panel-header">Sections — Active / Inactive</div>
            <div class="panel-body">
              <p style="font-size:13px;color:var(--text-2);margin-bottom:14px">
                Activa o desactiva bloques dentro de esta página. Los bloques inactivos no se renderizan en el sitio.
              </p>
              <div class="section-list" id="sections-list">${sectionsHtml}</div>
            </div>
          </div>

          ${contentPanelHtml}

          <!-- Gallery -->
          <div class="panel">
            <div class="panel-header" style="display:flex;align-items:center;justify-content:space-between">
              <span>Gallery</span>
              <span id="gallery-count" style="font-size:12px;font-weight:400;color:var(--text-3)"></span>
            </div>
            <div class="panel-body">
              <div class="gallery-row-list" id="gallery-row-list"></div>
              <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;align-items:center">
                <button class="btn btn-secondary btn-sm" id="gallery-add-lib-btn">+ Add from Library</button>
                <label class="btn btn-secondary btn-sm" style="cursor:pointer">
                  ↑ Upload to Library
                  <input type="file" id="gallery-upload-input" accept="image/*" multiple style="display:none" />
                </label>
              </div>
            </div>
          </div>

          <!-- SEO -->
          <div class="panel">
            <div class="panel-header">SEO</div>
            <div class="panel-body">
              <div class="form-grid cols-1">
                <div class="field-group">
                  <label class="field-label">Page Title <span style="color:var(--text-3)">(tag &lt;title&gt;)</span></label>
                  <input class="field-input" id="pe-seo-title" value="${esc((page.seo||{}).pageTitle||'')}" placeholder="Title — Site Name" />
                  <span class="field-hint" id="pe-title-count" style="text-align:right"></span>
                </div>
                <div class="field-group">
                  <label class="field-label">Meta Description</label>
                  <textarea class="field-textarea" id="pe-seo-desc" rows="3" placeholder="Brief description (150–160 chars)">${esc((page.seo||{}).metaDescription||'')}</textarea>
                  <span class="field-hint" id="pe-desc-count" style="text-align:right"></span>
                </div>
                <div class="field-group">
                  <label class="field-label">Social Share Image (OG)</label>
                  <input class="field-input" id="pe-seo-og" value="${esc((page.seo||{}).ogImage||'')}" placeholder="https://..." />
                  <div class="img-preview-wrap">
                    <img id="pe-seo-og-preview" class="img-preview ${(page.seo||{}).ogImage ? '' : 'hidden'}" src="${esc((page.seo||{}).ogImage||'')}" alt="OG Preview" />
                  </div>
                </div>
              </div>
            </div>
          </div>

        </div>

        <!-- Side column -->
        <div class="editor-side">

          <!-- Status -->
          <div class="panel">
            <div class="panel-header">Status</div>
            <div class="panel-body">
              <div class="field-group">
                <label class="field-label">Publish Status</label>
                <select class="field-select" id="pe-status">
                  <option value="published" ${page.status==='published'?'selected':''}>Published</option>
                  <option value="draft"     ${page.status==='draft'    ?'selected':''}>Draft</option>
                  <option value="archived"  ${page.status==='archived' ?'selected':''}>Archived</option>
                </select>
              </div>
              <div class="field-group">
                <label class="field-label">Template</label>
                <select class="field-select" id="pe-template">
                  ${templateOptions(page.template || '')}
                </select>
                <span class="field-hint">Layout used to render this page on the frontend.</span>
              </div>
            </div>
          </div>

          <!-- Menu visibility -->
          <div class="panel">
            <div class="panel-header">Navigation</div>
            <div class="panel-body">
              <div class="toggle-wrap">
                <label class="toggle">
                  <input type="checkbox" id="pe-inmenu" ${page.inMenu ? 'checked' : ''} />
                  <span class="toggle-track"></span>
                </label>
                <span style="font-size:13.5px;font-weight:500">Show in menu</span>
              </div>
              <div class="field-group mt-4">
                <label class="field-label">Menu Order</label>
                <input class="field-input" type="number" id="pe-menuorder" value="${page.menuOrder || 0}" min="0" />
              </div>
            </div>
          </div>

          <!-- Indexing -->
          <div class="panel">
            <div class="panel-header">Search Engines</div>
            <div class="panel-body">
              <div class="toggle-wrap">
                <label class="toggle">
                  <input type="checkbox" id="pe-indexable" ${(page.seo||{}).indexable !== false ? 'checked' : ''} />
                  <span class="toggle-track"></span>
                </label>
                <span style="font-size:13.5px;font-weight:500">Allow indexing</span>
              </div>
              <span class="field-hint" style="display:block;margin-top:6px">Desmarca para agregar <code>noindex</code> a esta página.</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  `);

  // Char counters
  function updateCounters() {
    const t = document.getElementById('pe-seo-title').value.length;
    const d = document.getElementById('pe-seo-desc').value.length;
    document.getElementById('pe-title-count').textContent = `${t}/60`;
    document.getElementById('pe-desc-count').textContent  = `${d}/160`;
    document.getElementById('pe-title-count').style.color = t > 60  ? 'var(--danger)' : 'var(--text-3)';
    document.getElementById('pe-desc-count').style.color  = d > 160 ? 'var(--danger)' : 'var(--text-3)';
  }
  document.getElementById('pe-seo-title').addEventListener('input', updateCounters);
  document.getElementById('pe-seo-desc').addEventListener('input', updateCounters);
  updateCounters();

  // OG image preview
  document.getElementById('pe-seo-og').addEventListener('input', e => {
    const preview = document.getElementById('pe-seo-og-preview');
    if (e.target.value) { preview.src = e.target.value; preview.classList.remove('hidden'); }
    else preview.classList.add('hidden');
  });

  // Auto-slug from title
  const titleInput = document.getElementById('pe-title');
  const slugInput  = document.getElementById('pe-slug');
  let userEditedSlug = page.slug !== slugify(page.title);
  titleInput.addEventListener('input', () => {
    if (!userEditedSlug) slugInput.value = slugify(titleInput.value);
  });
  slugInput.addEventListener('input', () => { userEditedSlug = true; });

  // Save
  document.getElementById('page-save-btn').addEventListener('click', async () => {
    clearFieldErrors();

    // ── Validation ────────────────────────────────────────────────────────
    const titleVal = document.getElementById('pe-title').value.trim();
    const slugVal  = document.getElementById('pe-slug').value.trim();
    let valid = true;

    if (!titleVal) {
      showFieldError('pe-title', 'El título es obligatorio.');
      valid = false;
    }
    if (!slugVal) {
      showFieldError('pe-slug', 'El slug es obligatorio.');
      valid = false;
    } else if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(slugVal)) {
      showFieldError('pe-slug', 'Solo letras minúsculas, números y guiones. No puede empezar ni terminar en guión.');
      valid = false;
    }
    if (!valid) return;
    // ─────────────────────────────────────────────────────────────────────

    const btn = document.getElementById('page-save-btn');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    try {
      const sections = (page.sections || []).map(s => ({
        ...s,
        enabled: document.querySelector(`.section-toggle[data-sid="${s.id}"]`)?.checked ?? s.enabled
      }));

      // Collect template-specific content fields
      let contentData;
      if (page.template === 'intro') {
        contentData = {
          tagline:    document.getElementById('pc-tagline')?.value.trim()      || '',
          footerCta1: document.getElementById('pc-footer-cta1')?.value.trim()  || '',
          footerCta2: document.getElementById('pc-footer-cta2')?.value.trim()  || '',
        };
      } else if (page.template === 'info') {
        contentData = {
          label:           document.getElementById('pc-label')?.value.trim()     || '',
          role:            document.getElementById('pc-role')?.value.trim()      || '',
          instagram2Label: document.getElementById('pc-ig2-label')?.value.trim() || '',
          instagram2Url:   document.getElementById('pc-ig2-url')?.value.trim()   || '',
        };
      }

      const updated = {
        ...page,
        title:      document.getElementById('pe-title').value.trim(),
        slug:       document.getElementById('pe-slug').value.trim(),
        menuLabel:  document.getElementById('pe-menulabel').value.trim(),
        template:   document.getElementById('pe-template').value,
        status:     document.getElementById('pe-status').value,
        inMenu:     document.getElementById('pe-inmenu').checked,
        menuOrder:  parseInt(document.getElementById('pe-menuorder').value) || 0,
        sections,
        gallery:    pageGallery,
        seo: {
          pageTitle:       document.getElementById('pe-seo-title').value,
          metaDescription: document.getElementById('pe-seo-desc').value,
          ogImage:         document.getElementById('pe-seo-og').value,
          indexable:       document.getElementById('pe-indexable').checked,
        },
        ...(contentData !== undefined && { content: contentData }),
      };

      await api.put(`/api/pages/${pageId}`, updated);
      toast('✓ Página guardada correctamente');
      log.info('Page saved:', pageId);
    } catch(e) {
      log.error('Save page failed:', e);
      toast(`Error al guardar: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
    }
  });

  document.getElementById('page-preview-btn').addEventListener('click', () => {
    window.open(pagePreviewUrl(page), '_blank');
  });

  // ── Gallery editor ─────────────────────────────────────────────────────────
  function updateGalleryCount() {
    const el = document.getElementById('gallery-count');
    if (el) el.textContent = `${pageGallery.length} image${pageGallery.length !== 1 ? 's' : ''}`;
  }

  function buildGalleryRows() {
    const list = document.getElementById('gallery-row-list');
    if (!list) return;
    if (!pageGallery.length) {
      list.innerHTML = '<p class="gallery-empty">No images in this page\'s gallery.<br>Add images from the Library or upload a new one.</p>';
      updateGalleryCount();
      return;
    }
    list.innerHTML = pageGallery.map((item, i) => {
      const img     = imgMap[item.imageId] || {};
      const url     = img.url || '';
      const alt     = item.alt !== undefined && item.alt !== null ? item.alt : (img.alt || '');
      const caption = item.caption !== undefined && item.caption !== null ? item.caption : (img.caption || '');
      return `
        <div class="gallery-row" draggable="true" data-idx="${i}">
          <div class="drag-handle" title="Drag to reorder">
            <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor"><path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"/></svg>
          </div>
          ${url
            ? `<img class="gallery-thumb" src="${esc(url)}" alt="" loading="lazy" />`
            : `<div class="gallery-thumb gallery-thumb-empty"></div>`}
          <div class="gallery-row-fields">
            <input class="field-input" placeholder="Alt text (blank = use library default)" data-gfield="alt" data-idx="${i}" value="${esc(alt)}" />
            <input class="field-input" placeholder="Caption (blank = use library default)" data-gfield="caption" data-idx="${i}" value="${esc(caption)}" />
          </div>
          <div class="gallery-row-meta">
            <span class="gallery-img-id">${esc(item.imageId)}</span>
            <button class="btn btn-ghost btn-sm gallery-remove-btn" data-action="remove-gallery-item" data-idx="${i}" title="Remove from page (image stays in Library)">✕</button>
          </div>
        </div>
      `;
    }).join('');
    updateGalleryCount();
    bindGalleryRowEvents();
  }

  function bindGalleryRowEvents() {
    const list = document.getElementById('gallery-row-list');
    if (!list) return;

    list.querySelectorAll('[data-gfield]').forEach(el => {
      el.addEventListener('input', () => {
        pageGallery[parseInt(el.dataset.idx)][el.dataset.gfield] = el.value;
      });
    });

    list.querySelectorAll('[data-action="remove-gallery-item"]').forEach(btn => {
      btn.addEventListener('click', () => {
        pageGallery.splice(parseInt(btn.dataset.idx), 1);
        buildGalleryRows();
      });
    });

    list.querySelectorAll('.gallery-row').forEach(row => {
      row.addEventListener('dragstart', e => {
        dragGalSrc = parseInt(row.dataset.idx);
        row.style.opacity = '.4';
        e.dataTransfer.effectAllowed = 'move';
      });
      row.addEventListener('dragend',   () => { row.style.opacity = '1'; });
      row.addEventListener('dragover',  e => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', ()  => row.classList.remove('drag-over'));
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const target = parseInt(row.dataset.idx);
        if (dragGalSrc === null || dragGalSrc === target) return;
        const moved = pageGallery.splice(dragGalSrc, 1)[0];
        pageGallery.splice(target, 0, moved);
        dragGalSrc = null;
        buildGalleryRows();
      });
    });
  }

  buildGalleryRows();

  document.getElementById('gallery-add-lib-btn').addEventListener('click', async () => {
    await showImagePicker(async (selectedId) => {
      if (pageGallery.find(item => item.imageId === selectedId)) {
        toast('That image is already in this gallery', 'error');
        return;
      }
      // Refresh imgMap in case library changed
      if (!imgMap[selectedId]) {
        const fresh = await api.get('/api/library');
        if (fresh) fresh.forEach(img => { imgMap[img.id] = img; });
      }
      pageGallery.push({ imageId: selectedId, alt: '', caption: '' });
      buildGalleryRows();
      toast('Image added to gallery — remember to Save Changes');
    });
  });

  document.getElementById('gallery-upload-input').addEventListener('change', async e => {
    const files = [...e.target.files];
    if (!files.length) return;
    let added = 0;
    for (const file of files) {
      const form = new FormData();
      form.append('file', file);
      try {
        const result = await api.upload('/api/upload', form);
        if (result && result.imageId) {
          imgMap[result.imageId] = {
            id: result.imageId, url: result.url,
            alt: '', caption: '', categories: []
          };
          pageGallery.push({ imageId: result.imageId, alt: '', caption: '' });
          added++;
        }
      } catch(err) { toast(`Failed: ${file.name}`, 'error'); }
    }
    e.target.value = '';
    if (added) {
      buildGalleryRows();
      toast(`${added} image(s) uploaded and added to gallery`);
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  PROJECTS — dormant module placeholder
// ════════════════════════════════════════════════════════════════════════════
function renderProjects() {
  setView(`
    <div class="view">
      <div class="view-header">
        <div class="view-title">Projects</div>
      </div>
      <div class="panel">
        <div class="panel-body" style="padding:32px;text-align:center;color:var(--text-2)">
          <div style="font-size:32px;margin-bottom:12px">🗂</div>
          <p style="font-size:15px;font-weight:600;margin-bottom:8px">Projects module — reserved for future use</p>
          <p style="font-size:13px">El contenido del portafolio se gestiona desde <strong>Pages → Gallery</strong>.<br>
          Este módulo está disponible para uso futuro.</p>
          <a href="#pages" class="btn btn-primary" style="margin-top:20px;display:inline-flex">Go to Pages →</a>
        </div>
      </div>
    </div>
  `);
}

function renderProjectEditor() { location.hash = '#projects'; }

// ════════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ════════════════════════════════════════════════════════════════════════════
async function renderNavigation() {
  loading('Cargando navegación…');
  let allPages, nav;
  try {
    [allPages, nav] = await Promise.all([api.get('/api/pages'), api.get('/api/navigation')]);
  } catch(e) {
    setError('No se pudo cargar la navegación', e.message);
    return;
  }
  if (!allPages || !nav) return;

  // Menu links: all published pages, sorted by menuOrder — this is the source of truth
  let menuPages = allPages
    .filter(p => p.status === 'published')
    .sort((a, b) => (a.menuOrder ?? 999) - (b.menuOrder ?? 999));

  // Track original state for change detection on save
  const origState = new Map(menuPages.map(p => [p.id, { inMenu: !!p.inMenu, menuOrder: p.menuOrder }]));

  let footerLinks = [...(nav.footerLinks || [])];
  let dragSrc = null;

  function buildMenuRows() {
    return menuPages.map((page, i) => `
      <div class="nav-item-row" draggable="true" data-idx="${i}">
        <div class="drag-handle"><svg viewBox="0 0 20 20"><path d="M7 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 2zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 7 14zm6-8a2 2 0 1 0-.001-4.001A2 2 0 0 0 13 6zm0 2a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 8zm0 6a2 2 0 1 0 .001 4.001A2 2 0 0 0 13 14z"/></svg></div>
        <div style="flex:1">
          <span style="font-weight:600">${esc(page.menuLabel || page.title)}</span>
          <div class="nav-item-page">${esc(page.id)}</div>
        </div>
        <label class="toggle">
          <input type="checkbox" data-field="inMenu" data-idx="${i}" ${page.inMenu ? 'checked' : ''} />
          <span class="toggle-track"></span>
        </label>
      </div>
    `).join('');
  }

  function buildFooterRows() {
    return footerLinks.map((link, i) => `
      <div class="footer-link-row">
        <label class="toggle"><input type="checkbox" data-footer-vis="${i}" ${link.visible !== false ? 'checked' : ''} /><span class="toggle-track"></span></label>
        <input class="field-input" data-footer-label="${i}" value="${esc(link.label)}" placeholder="Label" style="flex:1" />
        <input class="field-input" data-footer-url="${i}" value="${esc(link.url)}" placeholder="https://..." style="flex:2" />
      </div>
    `).join('');
  }

  setView(`
    <div class="view">
      <div class="view-header">
        <div>
          <div class="view-title">Navigation</div>
          <div class="view-subtitle">Drag to reorder. Toggle to show/hide in menu.</div>
        </div>
        <div class="ml-auto">
          <button class="btn btn-primary" id="nav-save">Save Navigation</button>
        </div>
      </div>

      <div class="panel" style="margin-bottom:20px">
        <div class="panel-header">Menu Links</div>
        <div class="panel-body">
          <div class="nav-list" id="menu-links-list">${buildMenuRows()}</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-header">Footer Links</div>
        <div class="panel-body">
          <div style="display:flex;flex-direction:column;gap:8px" id="footer-links-list">${buildFooterRows()}</div>
          <button class="btn btn-secondary btn-sm mt-4" id="add-footer-link">+ Add Footer Link</button>
        </div>
      </div>
    </div>
  `);

  function rebindMenuEvents() {
    const list = document.getElementById('menu-links-list');
    list.querySelectorAll('[data-field="inMenu"]').forEach(el => {
      el.addEventListener('change', () => { menuPages[el.dataset.idx].inMenu = el.checked; });
    });

    // Drag-to-reorder
    list.querySelectorAll('.nav-item-row').forEach(row => {
      row.addEventListener('dragstart', e => { dragSrc = parseInt(row.dataset.idx); row.style.opacity = '.5'; });
      row.addEventListener('dragend',   () => { row.style.opacity = '1'; });
      row.addEventListener('dragover',  e => { e.preventDefault(); row.classList.add('drag-over'); });
      row.addEventListener('dragleave', () => { row.classList.remove('drag-over'); });
      row.addEventListener('drop', e => {
        e.preventDefault();
        row.classList.remove('drag-over');
        const target = parseInt(row.dataset.idx);
        if (dragSrc === null || dragSrc === target) return;
        const moved = menuPages.splice(dragSrc, 1)[0];
        menuPages.splice(target, 0, moved);
        list.innerHTML = buildMenuRows();
        rebindMenuEvents();
      });
    });
  }
  rebindMenuEvents();

  function rebindFooterEvents() {
    const list = document.getElementById('footer-links-list');
    list.querySelectorAll('[data-footer-vis]').forEach(el => {
      el.addEventListener('change', () => { footerLinks[el.dataset.footerVis].visible = el.checked; });
    });
    list.querySelectorAll('[data-footer-label]').forEach(el => {
      el.addEventListener('input', () => { footerLinks[el.dataset.footerLabel].label = el.value; });
    });
    list.querySelectorAll('[data-footer-url]').forEach(el => {
      el.addEventListener('input', () => { footerLinks[el.dataset.footerUrl].url = el.value; });
    });
  }
  rebindFooterEvents();

  document.getElementById('add-footer-link').addEventListener('click', () => {
    footerLinks.push({ label: '', url: '', visible: true });
    document.getElementById('footer-links-list').innerHTML = buildFooterRows();
    rebindFooterEvents();
  });

  document.getElementById('nav-save').addEventListener('click', async () => {
    const btn = document.getElementById('nav-save');
    btn.disabled = true;
    btn.textContent = 'Guardando…';

    // Assign menuOrder based on current drag position
    menuPages.forEach((p, i) => { p.menuOrder = i + 1; });

    try {
      // Save each page where inMenu or menuOrder changed — sequential to avoid race conditions
      // (all pages share a single MongoDB document; parallel writes overwrite each other)
      const changedPages = menuPages.filter(p => {
        const orig = origState.get(p.id);
        return !orig || orig.inMenu !== !!p.inMenu || orig.menuOrder !== p.menuOrder;
      });
      for (const p of changedPages) {
        await api.put(`/api/pages/${p.id}`, p);
      }

      // Save footer links (pass empty menuLinks so server doesn't overwrite inMenu we just set)
      await api.put('/api/navigation', { menuLinks: [], footerLinks });

      // Update origState so subsequent saves only send real changes
      menuPages.forEach(p => origState.set(p.id, { inMenu: !!p.inMenu, menuOrder: p.menuOrder }));

      toast('✓ Navegación guardada');
    } catch(e) {
      log.error('Save navigation failed:', e);
      toast(`Error al guardar navegación: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Navigation';
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  MEDIA LIBRARY
// ════════════════════════════════════════════════════════════════════════════
async function renderImages() {
  loading('Cargando librería de imágenes…');
  let images;
  try {
    images = await api.get('/api/library');
  } catch(e) {
    setError('No se pudo cargar la Media Library', e.message);
    return;
  }
  if (!images) return;

  function buildLibTiles() {
    if (!images.length) {
      return '<p style="color:var(--text-3);font-size:13px;text-align:center;padding:40px 0">No images in library yet. Upload one above.</p>';
    }
    return images.map(img => `
      <div class="library-tile" data-id="${esc(img.id)}">
        <img class="library-tile-thumb" src="${esc(img.url)}" alt="" loading="lazy" onerror="this.style.opacity='.2'" />
        <div class="library-tile-body">
          <div class="library-tile-id">${esc(img.id)}</div>
          <input class="library-tile-input" placeholder="Alt text…" data-lib-alt="${esc(img.id)}" value="${esc(img.alt||'')}" title="Alt text" />
          <input class="library-tile-input" placeholder="Caption…"  data-lib-cap="${esc(img.id)}" value="${esc(img.caption||'')}" title="Caption" />
          <div style="margin:4px 0 6px;display:flex;flex-wrap:wrap;gap:3px">
            ${(img.categories||[]).map(c => `<span class="library-tile-cat">${esc(c)}</span>`).join('')}
          </div>
          <div class="library-tile-actions">
            <button class="btn btn-sm btn-secondary" data-lib-save="${esc(img.id)}">Save</button>
            <button class="btn btn-sm btn-ghost"     data-lib-copy="${esc(img.url)}">Copy URL</button>
            <button class="btn btn-sm btn-ghost"     data-lib-del="${esc(img.id)}" style="color:var(--danger)">Delete</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  setView(`
    <div class="view">
      <div class="view-header">
        <div>
          <div class="view-title">Media Library</div>
          <div class="view-subtitle">${images.length} image${images.length !== 1 ? 's' : ''} in library</div>
        </div>
      </div>

      <div class="upload-zone" id="upload-zone">
        <div class="upload-zone-icon">📁</div>
        <p><strong>Click to upload</strong> or drag & drop images here</p>
        <small>JPG, PNG, WebP, GIF · Images are registered in the global library</small>
        <input type="file" id="upload-input" accept="image/*" multiple style="display:none" />
      </div>
      <div id="upload-progress" style="margin-bottom:16px;display:none">
        <div style="background:var(--bg);border-radius:6px;height:6px;overflow:hidden">
          <div id="upload-bar" style="height:100%;background:var(--accent);width:0%;transition:width .3s"></div>
        </div>
        <p id="upload-msg" style="font-size:12px;color:var(--text-2);margin-top:4px"></p>
      </div>

      <div class="library-grid" id="library-grid">${buildLibTiles()}</div>
    </div>
  `);

  const zone  = document.getElementById('upload-zone');
  const input = document.getElementById('upload-input');
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-active'); });
  zone.addEventListener('dragleave', ()  => zone.classList.remove('drag-active'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-active');
    uploadFiles([...e.dataTransfer.files]);
  });
  input.addEventListener('change', () => uploadFiles([...input.files]));

  async function uploadFiles(files) {
    const progress = document.getElementById('upload-progress');
    const bar      = document.getElementById('upload-bar');
    const msg      = document.getElementById('upload-msg');
    progress.style.display = 'block';
    let done = 0;
    const errors = [];
    for (const file of files) {
      msg.textContent = `Subiendo ${file.name}… (${done + 1}/${files.length})`;
      const form = new FormData();
      form.append('file', file);
      try {
        await api.upload('/api/upload', form);
        done++;
        bar.style.width = `${(done / files.length) * 100}%`;
        log.info('Uploaded:', file.name);
      } catch(e) {
        log.error('Upload failed:', file.name, e.message);
        errors.push(`${file.name}: ${e.message}`);
      }
    }
    if (errors.length === 0) {
      msg.textContent = `✓ ${done}/${files.length} imagen(es) subida(s)`;
      toast(`✓ ${done} imagen(es) añadida(s) a la librería`);
    } else {
      msg.textContent = `${done} subida(s), ${errors.length} error(es)`;
      errors.forEach(e => toast(e, 'error'));
    }
    setTimeout(() => { progress.style.display = 'none'; bar.style.width = '0'; }, 3000);
    renderImages();
  }

  function bindTileEvents() {
    document.querySelectorAll('[data-lib-save]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id  = btn.dataset.libSave;
        const alt = document.querySelector(`[data-lib-alt="${id}"]`)?.value || '';
        const cap = document.querySelector(`[data-lib-cap="${id}"]`)?.value || '';
        try {
          await api.put(`/api/library/${id}`, { alt, caption: cap });
          toast('Saved');
        } catch(e) { toast(e.message, 'error'); }
      });
    });

    document.querySelectorAll('[data-lib-copy]').forEach(btn => {
      btn.addEventListener('click', async () => {
        await navigator.clipboard.writeText(btn.dataset.libCopy).catch(() => {});
        toast('URL copied to clipboard');
      });
    });

    document.querySelectorAll('[data-lib-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.libDel;
        if (!confirm(`Remove ${id} from the library?\n\nThis will also remove it from all page galleries. The file on disk is not deleted.`)) return;
        try {
          await api.del(`/api/library/${id}`);
          toast('Image removed from library and all page galleries');
          renderImages();
        } catch(e) { toast(e.message, 'error'); }
      });
    });
  }
  bindTileEvents();
}

// ════════════════════════════════════════════════════════════════════════════
//  SETTINGS
// ════════════════════════════════════════════════════════════════════════════
async function renderSettings() {
  loading('Cargando configuración del sitio…');
  let site;
  try {
    site = await api.get('/api/settings');
  } catch(e) {
    setError('No se pudo cargar la configuración del sitio', e.message);
    return;
  }
  if (!site) return;

  let logos = [...(site.clientLogos || [])];

  function buildLogoRows() {
    return logos.map((logo, i) => `
      <div class="logo-row">
        <input class="field-input" data-logo-name="${i}" value="${esc(logo.name)}" placeholder="Client name" style="max-width:120px" />
        <input class="field-input" data-logo-url="${i}" value="${esc(logo.url)}" placeholder="https://..." />
        <button class="btn btn-ghost btn-sm" data-delete-logo="${i}">✕</button>
      </div>
    `).join('');
  }

  setView(`
    <div class="view">
      <div class="view-header">
        <div class="view-title">Site Settings</div>
        <div class="ml-auto">
          <button class="btn btn-primary" id="settings-save">Save Settings</button>
        </div>
      </div>

      <!-- Personal info -->
      <div class="panel" style="margin-bottom:20px">
        <div class="panel-header">Personal Info</div>
        <div class="panel-body">
          <div class="form-grid">
            <div class="field-group">
              <label class="field-label">Name</label>
              <input class="field-input" id="s-name" value="${esc(site.name||'')}" />
            </div>
            <div class="field-group">
              <label class="field-label">Tagline</label>
              <input class="field-input" id="s-tagline" value="${esc(site.tagline||'')}" />
            </div>
            <div class="field-group">
              <label class="field-label">Email</label>
              <input class="field-input" id="s-email" type="email" value="${esc(site.email||'')}" />
            </div>
            <div class="field-group">
              <label class="field-label">Instagram handle</label>
              <input class="field-input" id="s-instagram" value="${esc(site.instagram||'')}" placeholder="@username" />
            </div>
            <div class="field-group span-2">
              <label class="field-label">Instagram URL</label>
              <input class="field-input" id="s-instagramUrl" value="${esc(site.instagramUrl||'')}" placeholder="https://instagram.com/..." />
            </div>
            <div class="field-group span-2">
              <label class="field-label">Copyright</label>
              <input class="field-input" id="s-copyright" value="${esc(site.copyright||'')}" />
            </div>
          </div>
        </div>
      </div>

      <!-- About -->
      <div class="panel" style="margin-bottom:20px">
        <div class="panel-header">About Section</div>
        <div class="panel-body">
          <div class="form-grid cols-1">
            <div class="field-group">
              <label class="field-label">Profile Photo URL</label>
              <input class="field-input" id="s-photo" value="${esc((site.about||{}).photo||'')}" placeholder="https://..." />
              <div class="img-preview-wrap">
                <img id="s-photo-preview" class="img-preview ${(site.about||{}).photo ? '' : 'hidden'}" src="${esc((site.about||{}).photo||'')}" alt="Profile" loading="lazy" />
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">Bio</label>
              <textarea class="field-textarea" id="s-bio" rows="6">${esc((site.about||{}).bio||'')}</textarea>
              <span class="field-hint">Usa saltos de línea para separar párrafos.</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Logo -->
      <div class="panel" style="margin-bottom:20px">
        <div class="panel-header">Logo</div>
        <div class="panel-body">
          <div class="field-group">
            <label class="field-label">Logo URL</label>
            <input class="field-input" id="s-logo" value="${esc(site.logoUrl||'')}" placeholder="https://..." />
          </div>
        </div>
      </div>

      <!-- Client logos -->
      <div class="panel">
        <div class="panel-header">Client Logos</div>
        <div class="panel-body">
          <p style="font-size:13px;color:var(--text-2);margin-bottom:14px">Logos que aparecen en el footer / página de info.</p>
          <div class="logo-list" id="logo-list">${buildLogoRows()}</div>
          <button class="btn btn-secondary btn-sm mt-4" id="add-logo">+ Add Logo</button>
        </div>
      </div>
    </div>
  `);

  // Photo preview
  document.getElementById('s-photo').addEventListener('input', e => {
    const preview = document.getElementById('s-photo-preview');
    if (e.target.value) { preview.src = e.target.value; preview.classList.remove('hidden'); }
    else preview.classList.add('hidden');
  });

  function rebindLogoEvents() {
    document.querySelectorAll('[data-logo-name]').forEach(el => {
      el.addEventListener('input', () => { logos[el.dataset.logoName].name = el.value; });
    });
    document.querySelectorAll('[data-logo-url]').forEach(el => {
      el.addEventListener('input', () => { logos[el.dataset.logoUrl].url = el.value; });
    });
    document.querySelectorAll('[data-delete-logo]').forEach(btn => {
      btn.addEventListener('click', () => {
        logos.splice(parseInt(btn.dataset.deleteLogo), 1);
        document.getElementById('logo-list').innerHTML = buildLogoRows();
        rebindLogoEvents();
      });
    });
  }
  rebindLogoEvents();

  document.getElementById('add-logo').addEventListener('click', () => {
    logos.push({ name: '', url: '' });
    document.getElementById('logo-list').innerHTML = buildLogoRows();
    rebindLogoEvents();
  });

  document.getElementById('settings-save').addEventListener('click', async () => {
    const btn = document.getElementById('settings-save');
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    const updated = {
      ...site,
      name:         document.getElementById('s-name').value.trim(),
      tagline:      document.getElementById('s-tagline').value.trim(),
      email:        document.getElementById('s-email').value.trim(),
      instagram:    document.getElementById('s-instagram').value.trim(),
      instagramUrl: document.getElementById('s-instagramUrl').value.trim(),
      copyright:    document.getElementById('s-copyright').value.trim(),
      logoUrl:      document.getElementById('s-logo').value.trim(),
      about: {
        photo: document.getElementById('s-photo').value.trim(),
        bio:   document.getElementById('s-bio').value,
      },
      clientLogos: logos,
    };
    try {
      await api.put('/api/settings', updated);
      toast('✓ Configuración guardada — config.js actualizado');
    } catch(e) {
      log.error('Save settings failed:', e);
      toast(`Error al guardar: ${e.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save Settings';
    }
  });
}

// ════════════════════════════════════════════════════════════════════════════
//  IMAGE PICKER MODAL
// ════════════════════════════════════════════════════════════════════════════
async function showImagePicker(callback) {
  const existing = document.getElementById('img-picker-modal');
  if (existing) existing.remove();

  const library = await api.get('/api/library');
  if (!library) return;

  const modal = document.createElement('div');
  modal.id = 'img-picker-modal';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-header">
        <h2 style="flex-shrink:0">Select from Library</h2>
        <input class="field-input" id="picker-search" placeholder="Filter by ID or alt text…" style="flex:1;max-width:260px;margin-left:auto" />
        <button class="btn btn-ghost btn-sm" id="picker-close" style="flex-shrink:0">✕ Close</button>
      </div>
      <div class="modal-body">
        ${library.length
          ? `<div class="picker-grid" id="picker-grid">
              ${library.map(img => `
                <div class="picker-tile" data-id="${esc(img.id)}" title="${esc(img.alt || img.id)}">
                  <img src="${esc(img.url)}" alt="${esc(img.alt||'')}" loading="lazy" />
                  <div class="picker-tile-label">${esc(img.id)}</div>
                </div>
              `).join('')}
             </div>`
          : '<p style="color:var(--text-3);font-size:13px;text-align:center;padding:40px">No images in library yet.</p>'
        }
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  document.getElementById('picker-close').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

  const searchEl = document.getElementById('picker-search');
  if (searchEl) {
    searchEl.addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      modal.querySelectorAll('.picker-tile').forEach(tile => {
        const match = !q ||
          tile.dataset.id.toLowerCase().includes(q) ||
          (tile.title || '').toLowerCase().includes(q);
        tile.style.display = match ? '' : 'none';
      });
    });
  }

  modal.querySelectorAll('.picker-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      modal.remove();
      callback(tile.dataset.id);
    });
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
