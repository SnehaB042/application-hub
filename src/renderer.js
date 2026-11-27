(() => {
  'use strict';
  const api = window.api;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  const STATUSES = ['Researching', 'Drafting', 'Submitted', 'Interview', 'Accepted', 'Rejected'];
  const OPEN = ['Researching', 'Drafting'];
  const WAIVERS = ['Not Requested', 'Requested', 'Approved', 'N/A'];
  const REQ_TYPES = ['SoP', 'LoR', 'GRE', 'IELTS/TOEFL', 'Video essay', 'Marksheet/Transcript', 'Resume/CV', 'Personal details', 'Application form', 'Other'];
  const SHARED = ['GRE', 'IELTS/TOEFL', 'Marksheet/Transcript', 'Resume/CV', 'Personal details']; // same file/score for every university
  const SCORE_TYPES = ['GRE', 'IELTS/TOEFL'];
  const ALL_STATUS = ['Not started', 'Requested', 'In progress', 'Ready', 'Submitted'];
  const statusOpts = (t) => (t === 'LoR' ? ['Not started', 'Requested', 'In progress', 'Submitted'] : ['Not started', 'In progress', 'Ready', 'Submitted']);
  const isDone = (r) => r.status === 'Submitted' || (r.type !== 'LoR' && r.status === 'Ready');

  let S = { universities: [], reqs: [], notes: [], credentials: [], encryptionAvailable: true };
  let view = 'dashboard', uniDetail = null, docTab = 'files', dashAll = false;
  let activeNote = null, noteMode = 'edit';
  let split = false, splitMode = 'checklist', splitUni = '';
  let googleIn = false;
  const revealed = {};
  const F = {
    uni: { q: '', status: 'All', country: 'All', sort: 'deadline', dir: 'asc', group: false },
    req: { q: '', type: 'All', status: 'Open', uni: '', sort: 'uni', dir: 'asc' },
    det: { q: '', type: 'All', status: 'All', sort: 'type', dir: 'asc' },
    cred: { q: '', sort: 'portalName', dir: 'asc' }
  };

  /* ---------- helpers ---------- */
  const money = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(n || 0);
  const uniById = (id) => S.universities.find((u) => u.id === id);
  
  const getRecommenders = () => {
    const map = new Map();
    for (const r of S.reqs) {
      if (r.type !== 'LoR' || !r.recommender) continue;
      const key = normName(r.recommender) + '|' + normName(r.email);
      const prev = map.get(key) || { name: r.recommender.trim(), email: '', mobile: '' };
      map.set(key, {
        name: r.recommender.trim() || prev.name,
        email: (r.email || '').trim() || prev.email,
        mobile: (r.mobile || '').trim() || prev.mobile
      });
    }
    return [...map.values()];
  };
  
  const uniLabel = (u) => (u ? u.name + (u.program ? ' — ' + u.program : '') : 'General');
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const daysUntil = (d) => { const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(d + 'T00:00:00') - t) / 864e5); };
  const dayBadge = (d) => {
    if (!d) return '<span class="muted">No date</span>';
    const n = daysUntil(d);
    const txt = n < 0 ? `${-n}d overdue` : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${n}d left`;
    return `<span class="badge ${n < 0 ? 'b-bad' : n <= 7 ? 'b-warn' : ''}">${txt}</span>`;
  };
  const stBadge = (s) => `<span class="badge st-${esc(String(s).toLowerCase())}">${esc(s)}</span>`;
  const normUrl = (v) => {
    v = (v || '').trim();
    if (!v) return '';
    if (/^https?:\/\//i.test(v)) return v;
    if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(v)) return 'https://' + v;
    return 'https://www.google.com/search?q=' + encodeURIComponent(v);
  };
  const fixUrl = (u) => (u && !/^https?:\/\//i.test(u) ? 'https://' + u : u);
  const cleanErr = (e) => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const fail = (e) => toast(cleanErr(e), 'bad');
  const fileName = (p) => (p || '').split(/[\\/]/).pop();
  const normName = (s) => String(s || '').trim().toLowerCase();

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind; t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }
  async function persist() {
    try { S.credentials = await api.saveData({ universities: S.universities, reqs: S.reqs, notes: S.notes }); }
    catch (e) { fail(e); }
  }
  const upsert = (list, rec) => { const i = list.findIndex((x) => x.id === rec.id); if (i >= 0) list[i] = rec; else list.push(rec); };

  const cmp = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }));
  const sorted = (rows, f, acc) => { const g = acc[f.sort]; return g ? [...rows].sort((a, b) => cmp(g(a), g(b)) * (f.dir === 'desc' ? -1 : 1)) : rows; };
  const th = (t, k, label) => `<th class="sortable" data-act="sort" data-t="${t}" data-k="${k}">${label}${F[t].sort === k ? (F[t].dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;
  const selOpts = (list, cur) => list.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`; }).join('');

  const progOf = (uniId) => { const m = S.reqs.filter((r) => r.uniId === uniId); return { total: m.length, done: m.filter(isDone).length, open: m.filter((r) => !isDone(r)) }; };
  const progBar = (p) => (p.total ? `<span class="prog ${p.done === p.total ? 'full' : ''}"><i style="width:${Math.round((p.done / p.total) * 100)}%"></i></span><span class="small-t muted">${p.done}/${p.total}</span>` : '<span class="muted small-t">No checklist</span>');
  const reqChip = (r) => (r.type === 'LoR' ? 'LoR' + (r.recommender ? ' · ' + r.recommender : '') : r.title);

  /* ---------- modal + forms ---------- */
  function closeModal() { $('#modalRoot').innerHTML = ''; }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  function fieldHtml(f, v) {
    const id = 'f_' + f.key, val = v ?? f.default ?? '';
    const lab = `<label for="${id}">${esc(f.label)}${f.required ? ' *' : ''}</label>`;
    let row;
    if (f.type === 'checkbox') row = `<div class="form-row check-row"><label><input type="checkbox" name="${f.key}" ${val ? 'checked' : ''}> ${esc(f.label)}</label>${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
    else {
      let ctl;
      if (f.type === 'select') ctl = `<select id="${id}" name="${f.key}">${selOpts(f.options, val)}</select>`;
      else if (f.type === 'textarea') ctl = `<textarea id="${id}" name="${f.key}" rows="3">${esc(val)}</textarea>`;
      else if (f.type === 'file') ctl = `<div class="inline"><input id="${id}" name="${f.key}" type="text" value="${esc(val)}" placeholder="Paste a path or browse"><button type="button" class="btn" data-browse="${f.key}">Browse</button></div>`;
      else if (f.type === 'password') ctl = `<div class="inline"><input id="${id}" name="${f.key}" type="password" autocomplete="new-password" placeholder="${esc(f.placeholder || '')}"><button type="button" class="btn" data-pw>Show</button></div>`;
      else ctl = `<input id="${id}" name="${f.key}" type="${f.type || 'text'}" value="${esc(val)}" placeholder="${esc(f.placeholder || '')}" ${f.type === 'number' ? 'step="any" min="0"' : ''}>`;
      row = `<div class="form-row">${lab}${ctl}${f.hint ? `<div class="hint">${esc(f.hint)}</div>` : ''}</div>`;
    }
    return f.for ? row.replace('<div class="form-row', `<div data-for="${f.for.join('|')}" class="form-row`) : row;
  }

  function openForm({ title, fields, values = {}, submit = 'Save', onSubmit, dynamic }) {
    const root = $('#modalRoot');
    root.innerHTML = `<div class="overlay"><div class="modal glass" role="dialog" aria-modal="true" aria-label="${esc(title)}"><h2>${esc(title)}</h2>
      <form id="mf" novalidate>${fields.map((f) => fieldHtml(f, values[f.key])).join('')}
      <div class="actions"><button type="button" class="btn ghost" data-close>Cancel</button><button type="submit" class="btn primary">${esc(submit)}</button></div></form></div></div>`;
    const form = $('#mf', root);
    if (dynamic) { dynamic(form); form.addEventListener('change', () => dynamic(form)); }
    const first = form.querySelector('input:not([type=checkbox]),select,textarea'); if (first) first.focus();
    root.onclick = async (e) => {
      if (e.target.closest('[data-close]')) closeModal();
      const b = e.target.closest('[data-browse]');
      if (b) { const p = await api.browseFile(); if (p) form.elements[b.dataset.browse].value = p; }
      const pw = e.target.closest('[data-pw]');
      if (pw) { const i = pw.previousElementSibling; i.type = i.type === 'password' ? 'text' : 'password'; pw.textContent = i.type === 'password' ? 'Show' : 'Hide'; }
    };
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const v = {};
      for (const f of fields) {
        const el = form.elements[f.key];
        v[f.key] = f.type === 'checkbox' ? el.checked : (f.type === 'password' ? el.value : el.value.trim());
        if (f.required && !v[f.key]) { toast(`${f.label} is required.`, 'warn'); el.focus(); return; }
      }
      const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try { const r = await onSubmit(v); if (r !== false) closeModal(); }
      catch (e) { fail(e); }
      finally { btn.disabled = false; }
    });
  }
  function confirmBox(msg, ok = 'Delete') {
    return new Promise((res) => {
      $('#modalRoot').innerHTML = `<div class="overlay"><div class="modal glass" role="alertdialog" aria-modal="true"><h2>Are you sure?</h2><p class="muted">${esc(msg)}</p>
        <div class="actions"><button class="btn ghost" data-r="0">Cancel</button><button class="btn danger" data-r="1">${esc(ok)}</button></div></div></div>`;
      $('#modalRoot').onclick = (e) => { const b = e.target.closest('[data-r]'); if (b) { closeModal(); res(b.dataset.r === '1'); } };
    });
  }
  function showRecommenderCard({ name, email, mobile }) {
    const allForRec = S.reqs.filter((r) => r.type === 'LoR' && normName(r.recommender) === normName(name) && (!email || !r.email || normName(r.email) === normName(email)));
    const resolvedEmail = email || (allForRec.find((r) => r.email) || {}).email || '';
    const resolvedMobile = mobile || (allForRec.find((r) => r.mobile) || {}).mobile || '';
    const pendingCount = allForRec.filter((r) => !isDone(r)).length;
    const doneCount = allForRec.filter(isDone).length;

    const closeIcon = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const copyIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

    const root = $('#modalRoot');
    root.innerHTML = `<div class="overlay"><div class="modal glass" role="dialog" aria-modal="true" aria-label="Recommender details">
      <div class="page-head" style="margin:0 0 14px;align-items:flex-start">
        <div>
          <h2 style="margin:0">${esc(name || 'Recommender not set')}</h2>
          <div class="muted small-t">${doneCount} submitted · ${pendingCount} pending</div>
        </div>
        <button type="button" class="icon-btn" data-close aria-label="Close" title="Close">${closeIcon}</button>
      </div>
      <div class="form-row">
        <label>Email</label>
        <div class="inline">
          <input type="text" readonly value="${esc(resolvedEmail)}" placeholder="Not provided">
          ${resolvedEmail ? `<button type="button" class="btn small ghost" data-copy-val="${esc(resolvedEmail)}" data-copy-label="Email" aria-label="Copy email" title="Copy email">${copyIcon}</button>` : ''}
        </div>
      </div>
      <div class="form-row" style="margin-bottom:0">
        <label>Mobile</label>
        <div class="inline">
          <input type="text" readonly value="${esc(resolvedMobile)}" placeholder="Not provided">
          ${resolvedMobile ? `<button type="button" class="btn small ghost" data-copy-val="${esc(resolvedMobile)}" data-copy-label="Mobile" aria-label="Copy mobile" title="Copy mobile">${copyIcon}</button>` : ''}
        </div>
      </div>
    </div></div>`;

    root.onclick = async (e) => {
      if (e.target.closest('[data-close]') || e.target.classList.contains('overlay')) {
        closeModal();
        return;
      }
      const cp = e.target.closest('[data-copy-val]');
      if (cp) {
        try {
          await navigator.clipboard.writeText(cp.dataset.copyVal);
          toast(`${cp.dataset.copyLabel} copied`);
        } catch {
          toast('Could not copy to clipboard', 'bad');
        }
      }
    };
  }

  /* ---------- dashboard: applications against deadlines ---------- */
  function viewDashboard() {
    const apps = S.universities;
    const active = apps.filter((u) => OPEN.includes(u.status));
    const soon = active.filter((u) => u.deadline && daysUntil(u.deadline) <= 7);
    const activeIds = new Set(active.map((u) => u.id));
    const toDo = S.reqs.filter((r) => activeIds.has(r.uniId) && !isDone(r)).length;
    const lors = S.reqs.filter((r) => r.type === 'LoR' && !isDone(r) && uniById(r.uniId)).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
    const nUnis = new Set(apps.map((u) => normName(u.name))).size;

    const list = (dashAll ? apps : active).slice().sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
    const groups = new Map();
    list.forEach((u) => { const k = normName(u.name); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(u); });
    const board = [...groups.values()].map((g) => `<div class="board-group"><div class="bg-head"><h3>${esc(g[0].name)}</h3><span class="muted small-t">${esc(g[0].country)}</span></div>
      ${g.map((u) => {
        const p = progOf(u.id), hot = u.deadline && OPEN.includes(u.status) && daysUntil(u.deadline) <= 7;
        return `<div class="board-row ${hot ? 'hot' : ''}" data-act="uni-open" data-id="${u.id}" tabindex="0" role="button">
          <div class="t"><b>${esc(u.program || 'Application')}</b> ${OPEN.includes(u.status) ? '' : stBadge(u.status)}</div>
          <div>${u.deadline ? dayBadge(u.deadline) : '<span class="muted small-t">No deadline</span>'}<div class="muted small-t">${esc(u.deadline || '')}</div></div>
          <div>${progBar(p)}</div></div>`;
      }).join('')}</div>`).join('');

    return `<div class="page-head"><div><h1>Dashboard</h1><div class="muted">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div></div></div>
    <div class="grid cards">
      <div class="card glass"><div class="stat-label">Universities</div><div class="stat">${nUnis}</div><div class="muted small-t">${apps.length} application${apps.length === 1 ? '' : 's'}, ${active.length} still open</div></div>
      <div class="card glass ${soon.length ? 'alert' : ''}"><div class="stat-label">Deadlines within 7 days</div><div class="stat">${soon.length}</div><div class="muted small-t">${active.filter((u) => u.deadline).length} open deadlines in total</div></div>
      <div class="card glass"><div class="stat-label">Requirements left</div><div class="stat">${toDo}</div><div class="muted small-t">across ${active.length} open application${active.length === 1 ? '' : 's'}</div></div>
      <div class="card glass"><div class="stat-label">Recommendation letters pending</div><div class="stat">${lors.length}</div><div class="muted small-t">${S.reqs.filter((r) => r.type === 'LoR' && isDone(r)).length} submitted</div></div>
    </div>
    <div class="grid split2" style="margin-top:12px">
      <div class="card glass"><div class="page-head" style="margin:0 0 6px"><h3>Deadline board</h3><label class="chk muted small-t" style="display:flex;gap:6px;align-items:center"><input type="checkbox" data-chg="dash-all" ${dashAll ? 'checked' : ''}> Show submitted and decided</label></div>
        ${board || '<div class="empty">No open applications. Add a university to start tracking its requirements against the deadline.</div>'}</div>
      <div class="card glass"><h3>Letters of recommendation</h3><div class="list">${(() => {
        if (!lors.length) return '<div class="empty">No letters pending.</div>';
        const recGroups = new Map();
        for (const r of lors) {
          const key = r.recommender ? normName(r.recommender) + '|' + normName(r.email) : '__unset__';
          if (!recGroups.has(key)) recGroups.set(key, { name: r.recommender || 'Recommender not set', email: r.email || '', mobile: r.mobile || '', items: [] });
          const g = recGroups.get(key);
          if (!g.email && r.email) g.email = r.email;
          if (!g.mobile && r.mobile) g.mobile = r.mobile;
          g.items.push(r);
        }
        const profileIcon = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><circle cx="8" cy="10" r="2.5"/><path d="M4.5 16.5c.8-2 2.2-3 3.5-3s2.7 1 3.5 3"/><line x1="14" y1="9" x2="19" y2="9"/><line x1="14" y1="13" x2="19" y2="13"/></svg>`;
        return [...recGroups.values()].map((g) => `<div class="board-group">
          <div class="bg-head" style="justify-content:space-between;align-items:center">
            <div style="display:flex;align-items:center;gap:6px">
              <b>${esc(g.name)}</b>
              <button type="button" class="icon-btn" data-act="rec-profile" data-name="${esc(g.name)}" data-email="${esc(g.email)}" data-mobile="${esc(g.mobile)}" title="Recommender details" aria-label="Recommender details">${profileIcon}</button>
            </div>
            <span class="muted small-t">${g.items.length} pending</span>
          </div>
          ${g.items.map((r) => `<div class="item" style="padding:6px 2px">
            <div class="t"><span class="small-t">${esc(uniLabel(uniById(r.uniId)))}</span>${r.dueDate ? `<div class="muted small-t">Due ${esc(r.dueDate)}</div>` : ''}</div>
            <span style="white-space:nowrap">${r.dueDate ? dayBadge(r.dueDate) + ' ' : ''}<span class="badge">${esc(r.status)}</span></span>
          </div>`).join('')}
        </div>`).join('');
      })()}</div></div>
      </div>`;
  }

  /* ---------- universities list (grouped by university) ---------- */
  const uniAcc = {
    name: (u) => normName(u.name) + '|' + normName(u.program), status: (u) => STATUSES.indexOf(u.status), deadline: (u) => u.deadline || '9999-12-31',
    progress: (u) => { const p = progOf(u.id); return p.total ? p.done / p.total : -1; }, fee: (u) => +u.fee || 0
  };
  function uniRow(u, showName) {
    const editIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
    const delIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`;
    return `<tr class="clickable" data-act="uni-open" data-id="${u.id}">
      <td>${showName ? `<b>${esc(u.name)}</b> <span class="muted small-t">${esc(u.country)}</span><div class="sub">${esc(u.program)}</div>` : `<button class="link-btn">${esc(u.program || 'Application')}</button>`}</td>
      <td>${progBar(progOf(u.id))}</td>
      <td>${esc(u.deadline || '—')}<div>${u.deadline && OPEN.includes(u.status) ? dayBadge(u.deadline) : ''}</div></td>
      <td>${u.fee ? money(u.fee) : '—'}<div class="sub">${esc(u.waiverStatus)}${u.waiverNotes ? ': ' + esc(u.waiverNotes) : ''}</div></td>
      <td><select class="mini-sel" data-chg="uni-status" data-id="${u.id}" aria-label="Status">${selOpts(STATUSES, u.status)}</select></td>
      <td><div class="row-actions"><button class="btn small ghost" data-act="uni-edit" data-id="${u.id}" aria-label="Edit" title="Edit">${editIcon}</button><button class="btn small danger ghost" data-act="uni-del" data-id="${u.id}" aria-label="Delete" title="Delete">${delIcon}</button></div></td></tr>`;
  }
  function uniTableHtml() {
    const f = F.uni, q = f.q.toLowerCase();
    let rows = S.universities.filter((u) => (f.status === 'All' || u.status === f.status) && (f.country === 'All' || u.country === f.country) && (!q || [u.name, u.program, u.country].join(' ').toLowerCase().includes(q)));
    rows = sorted(rows, f, uniAcc);
    let body;
    if (!rows.length) body = `<tr><td colspan="6" class="empty">${S.universities.length ? 'No applications match these filters.' : 'No universities yet. Add one and the app will build its requirements checklist.'}</td></tr>`;
    else if (f.group) {
      const g = new Map(); rows.forEach((u) => { const k = normName(u.name); if (!g.has(k)) g.set(k, []); g.get(k).push(u); });
      body = [...g.values()].map((list) => `<tr class="grp"><td colspan="5"><b>${esc(list[0].name)}</b><span class="muted small-t">${esc(list[0].country)} · ${list.length} program${list.length === 1 ? '' : 's'}</span></td><td><div class="row-actions"><button class="btn small ghost" data-act="uni-add-program" data-id="${list[0].id}">Add program</button></div></td></tr>${list.map((u) => uniRow(u, false)).join('')}`).join('');
    } else body = rows.map((u) => uniRow(u, true)).join('');
    return `<div class="glass table-wrap"><table><thead><tr>${th('uni', 'name', f.group ? 'Program' : 'University')}${th('uni', 'progress', 'Requirements')}${th('uni', 'deadline', 'Deadline')}${th('uni', 'fee', 'Fee and waiver')}${th('uni', 'status', 'Status')}<th></th></tr></thead><tbody>${body}</tbody></table></div>`;
  }
  function viewUniversities() {
    if (uniDetail) return viewDetail();
    const f = F.uni, countries = ['All', ...new Set(S.universities.map((u) => u.country).filter(Boolean))];
    return `<div class="page-head"><h1>Universities</h1><button class="btn primary" data-act="uni-add">Add university</button></div>
      <div class="toolbar"><input type="search" placeholder="Search university, program, country" value="${esc(f.q)}" data-inp="f-q" data-t="uni" aria-label="Search">
        <select data-chg="f-sel" data-t="uni" data-k="status" aria-label="Status">${selOpts(['All', ...STATUSES], f.status)}</select>
        <select data-chg="f-sel" data-t="uni" data-k="country" aria-label="Country">${selOpts(countries, f.country)}</select>
        <label class="chk"><input type="checkbox" data-chg="uni-group" ${f.group ? 'checked' : ''}> Group by university</label></div>
      <div id="tblBox">${uniTableHtml()}</div>`;
  }

  /* ---------- requirements (documents, LoRs, scores, everything) ---------- */
  const reqAcc = {
    title: (r) => normName(r.title), type: (r) => REQ_TYPES.indexOf(r.type), uni: (r) => normName(uniLabel(uniById(r.uniId))),
    status: (r) => ALL_STATUS.indexOf(r.status), due: (r) => r.dueDate || '9999-12-31'
  };
  function reqDetails(r) {
    if (r.type === 'LoR') return `${esc(r.recommender) || '<span class="muted">Recommender not set</span>'}<div class="sub">${esc(r.email)}${r.requestDate ? ' · asked ' + esc(r.requestDate) : ''}</div>`;
    if (SCORE_TYPES.includes(r.type)) return r.score ? `<b>${esc(r.score)}</b>` : '<span class="muted">Score not entered</span>';
    return r.notes ? `<span class="sub">${esc(r.notes.slice(0, 80))}</span>` : '';
  }
  function reqRow(r, showUni) {
    const files = (r.localPath ? `<button class="btn small" data-act="req-file" data-id="${r.id}" title="${esc(r.localPath)}">Open file</button><button class="btn small ghost" data-act="req-reveal" data-id="${r.id}">Folder</button>` : '')
      + (r.url ? `<button class="btn small" data-act="req-link" data-id="${r.id}">Open in workspace</button>` : '');
    return `<tr class="${isDone(r) ? 'done' : ''}"><td><select class="mini-sel" data-chg="req-status" data-id="${r.id}" aria-label="Status">${selOpts(statusOpts(r.type), r.status)}</select></td>
      <td><b>${esc(r.title)}</b><div class="sub">${esc(r.type)}</div></td>
      ${showUni ? `<td>${r.uniId ? `<button class="link-btn" data-act="uni-open" data-id="${r.uniId}">${esc(uniLabel(uniById(r.uniId)))}</button>` : '<span class="muted">General</span>'}</td>` : ''}
      <td>${reqDetails(r)}</td><td>${r.dueDate ? esc(r.dueDate) + ' ' + (isDone(r) ? '' : dayBadge(r.dueDate)) : '<span class="muted">—</span>'}</td>
      <td><div class="row-actions" style="justify-content:flex-start">${files || '<span class="muted">—</span>'}</div></td>
      <td><div class="row-actions"><button class="btn small ghost" data-act="req-edit" data-id="${r.id}">Edit</button><button class="btn small danger ghost" data-act="req-del" data-id="${r.id}">Delete</button></div></td></tr>`;
  }
  function reqTableHtml(t) {
    const f = F[t], showUni = t === 'req', q = f.q.toLowerCase();
    let rows = S.reqs.filter((r) => (t === 'det' ? r.uniId === uniDetail : (!f.uni || r.uniId === f.uni))
      && (f.type === 'All' || r.type === f.type)
      && (f.status === 'All' || (f.status === 'Open' ? !isDone(r) : f.status === 'Done' ? isDone(r) : r.status === f.status))
      && (!q || [r.title, r.type, r.recommender, r.email, r.score, r.notes, uniLabel(uniById(r.uniId))].join(' ').toLowerCase().includes(q)));
    rows = sorted(rows, f, reqAcc);
    const cols = 6 + (showUni ? 1 : 0);
    return `<div class="glass table-wrap"><table><thead><tr>${th(t, 'status', 'Status')}${th(t, 'title', 'Requirement')}${showUni ? th(t, 'uni', 'University') : ''}<th>Details</th>${th(t, 'due', 'Needed by')}<th>File / Google link</th><th></th></tr></thead>
      <tbody>${rows.map((r) => reqRow(r, showUni)).join('') || `<tr><td colspan="${cols}" class="empty">${S.reqs.length ? 'Nothing matches these filters.' : 'No requirements yet. Open a university to set up its checklist.'}</td></tr>`}</tbody></table></div>`;
  }
  function reqToolbar(t) {
    const f = F[t];
    return `<div class="toolbar"><input type="search" placeholder="Search requirements, recommenders, scores" value="${esc(f.q)}" data-inp="f-q" data-t="${t}" aria-label="Search">
      <select data-chg="f-sel" data-t="${t}" data-k="type" aria-label="Type">${selOpts(['All', ...REQ_TYPES], f.type)}</select>
      <select data-chg="f-sel" data-t="${t}" data-k="status" aria-label="Status">${selOpts(['All', 'Open', 'Done', ...ALL_STATUS], f.status)}</select>
      ${t === 'req' ? `<select data-chg="f-sel" data-t="req" data-k="uni" aria-label="University">${selOpts([['', 'All universities']].concat(S.universities.map((u) => [u.id, uniLabel(u)])), f.uni)}</select>` : ''}</div>`;
  }

  function viewDetail() {
    const u = uniById(uniDetail);
    if (!u) { uniDetail = null; return viewUniversities(); }
    const p = progOf(u.id);
    return `<div class="page-head"><div><button class="btn small ghost" data-act="uni-back">← All universities</button>
        <h1 style="margin-top:6px">${esc(u.name)}</h1><div class="muted">${esc(u.program)}${u.country ? ' · ' + esc(u.country) : ''}</div></div>
      <div class="tools">${u.appPortalUrl ? `<button class="btn" data-act="uni-portal" data-id="${u.id}" data-which="app">Application portal</button>` : ''}${u.programUrl ? `<button class="btn" data-act="uni-portal" data-id="${u.id}" data-which="program">Program page</button>` : ''}
        <button class="btn" data-act="uni-edit" data-id="${u.id}">Edit details</button><button class="btn primary" data-act="uni-work" data-id="${u.id}">Work through it in the workspace</button></div></div>
    <div class="grid cards">
      <div class="card glass"><div class="stat-label">Status</div><div style="margin-top:8px"><select data-chg="uni-status" data-id="${u.id}" aria-label="Status">${selOpts(STATUSES, u.status)}</select></div></div>
      <div class="card glass ${u.deadline && OPEN.includes(u.status) && daysUntil(u.deadline) <= 7 ? 'alert' : ''}"><div class="stat-label">Deadline</div><div class="stat small">${esc(u.deadline || 'Not set')}</div>${u.deadline ? dayBadge(u.deadline) : ''}</div>
      <div class="card glass"><div class="stat-label">Requirements ready</div><div class="stat small">${p.done} of ${p.total}</div>${progBar(p)}</div>
      <div class="card glass"><div class="stat-label">Application fee</div><div class="stat small">${u.fee ? money(u.fee) : '—'}</div><div class="muted small-t">Waiver: ${esc(u.waiverStatus)}${u.waiverNotes ? ' (' + esc(u.waiverNotes) + ')' : ''}</div></div>
    </div>
    <div class="page-head" style="margin:18px 0 8px"><h2>Requirements</h2><div class="tools"><button class="btn" data-act="req-setup" data-id="${u.id}">Add standard items</button><button class="btn primary" data-act="req-add" data-id="${u.id}">Add requirement</button></div></div>
    ${reqToolbar('det')}<div id="tblBox">${reqTableHtml('det')}</div>`;
  }

  function viewDocuments() {
    const tabs = `<div class="tabbar">${[['files', 'All requirements and documents'], ['notes', 'Scratchpad']].map(([k, l]) => `<button data-act="doc-tab" data-id="${k}" class="${docTab === k ? 'active' : ''}">${l}</button>`).join('')}</div>`;
    if (docTab === 'notes') return `<div class="page-head"><h1>Documents</h1><button class="btn" data-act="note-new">New note</button></div>${tabs}${notesHtml()}`;
    return `<div class="page-head"><div><h1>Documents</h1><div class="muted small-t">Every SoP, letter, score and form across all universities. Open a university to see them in context.</div></div><button class="btn primary" data-act="req-add">Add requirement</button></div>${tabs}${reqToolbar('req')}<div id="tblBox">${reqTableHtml('req')}</div>`;
  }

  /* requirement forms */
  const makeReq = (uniId, type, title, extra = {}) => ({ id: uid(), uniId, type, title, status: 'Not started', localPath: '', url: '', score: '', notes: '', recommender: '', email: '', mobile: '', requestDate: '', dueDate: '', ...extra });

  function reqForm(id, presetUni) {
    const cur = S.reqs.find((r) => r.id === id);
    const recs = getRecommenders();
    const recOpts = [['', 'Enter new recommender']].concat(
      recs.map((r, i) => [String(i), `${r.name}${r.email ? ' (' + r.email + ')' : ''}`])
    );
    openForm({
      title: cur ? 'Edit requirement' : 'Add requirement', values: cur || { uniId: presetUni || '', type: 'SoP' },
      fields: [
        { key: 'uniId', label: 'University', type: 'select', options: [['', 'General (no university)']].concat(S.universities.map((u) => [u.id, uniLabel(u)])) },
        { key: 'type', label: 'Type', type: 'select', options: REQ_TYPES },
        { key: 'title', label: 'Name', placeholder: 'Optional, for example "SoP v3"' },
        { key: 'status', label: 'Status', type: 'select', options: ALL_STATUS },
        ...(recs.length ? [{ key: 'savedRec', label: 'Reuse existing recommender', type: 'select', options: recOpts, for: ['LoR'] }] : []),
        { key: 'recommender', label: 'Recommender name', for: ['LoR'] },
        { key: 'email', label: 'Recommender email', type: 'email', for: ['LoR'] },
        { key: 'mobile', label: 'Recommender mobile', type: 'tel', for: ['LoR'] },
        { key: 'requestDate', label: 'Date requested', type: 'date', for: ['LoR'] },
        { key: 'dueDate', label: 'Letter due date', type: 'date', for: ['LoR'] },
        { key: 'score', label: 'Score', for: SCORE_TYPES, placeholder: 'For example 325 (Q168 V157) or 7.5' },
        { key: 'localPath', label: 'Local file (stays where it is)', type: 'file' },
        { key: 'url', label: 'Google Docs / Sheets link', placeholder: 'https://docs.google.com/…' },
        { key: 'notes', label: 'Notes', type: 'textarea' },
        { key: 'applyAll', label: 'Use this file and score for the same item at all my other universities', type: 'checkbox', for: SHARED, hint: 'Saves re-entering your marksheet, resume and test scores everywhere.' }
      ],
      dynamic: (form) => {
        const t = form.elements.type.value;
        form.querySelectorAll('[data-for]').forEach((row) => { row.hidden = !row.dataset.for.split('|').includes(t); });
        const st = form.elements.status, keep = st.value;
        st.innerHTML = selOpts(statusOpts(t), keep);
        if (form.elements.savedRec && form.elements.savedRec.value !== '') {
          const picked = recs[Number(form.elements.savedRec.value)];
          if (picked) {
            form.elements.recommender.value = picked.name;
            form.elements.email.value = picked.email;
            form.elements.mobile.value = picked.mobile;
          }
          form.elements.savedRec.value = '';
        }
      },
      onSubmit: async (v) => {
        const rec = { ...(cur || makeReq('', v.type, '')), ...v, url: fixUrl(v.url) };
        delete rec.applyAll;
        delete rec.savedRec;
        rec.title = v.title || (v.type === 'LoR' && v.recommender ? 'LoR – ' + v.recommender : v.type);
        upsert(S.reqs, rec);
        let n = 0;
        if (v.applyAll && SHARED.includes(v.type)) {
          S.reqs.forEach((o) => {
            if (o.id !== rec.id && o.type === v.type) { Object.assign(o, { localPath: rec.localPath, url: rec.url, score: rec.score }); if (isDone(rec) && !isDone(o)) o.status = 'Ready'; n++; }
          });
        }
        await persist(); reload(); toast(n ? `Saved, and applied to ${n} other item${n === 1 ? '' : 's'}.` : 'Saved');
      }
    });
  }

  function reqSetup(uniId) {
    const u = uniById(uniId); if (!u) return;
    const others = S.universities.filter((x) => x.id !== uniId && S.reqs.some((r) => r.uniId === x.id));
    openForm({
      title: `Requirements for ${u.name}`, submit: 'Create checklist', values: { sop: true, resume: true, marks: true, gre: true, ielts: true, personal: true, lors: 3 },
      fields: [
        { key: 'from', label: 'Copy from another application (fastest)', type: 'select', options: [['', 'Start with the options below']].concat(others.map((x) => [x.id, uniLabel(x)])), hint: 'Copies the checklist, your recommenders, and the files and scores you already attached to shared items. SoP, letters and video start fresh.' },
        { key: 'lors', label: 'Number of recommendation letters', type: 'number' },
        { key: 'sop', label: 'Statement of Purpose', type: 'checkbox' }, { key: 'resume', label: 'Resume / CV', type: 'checkbox' },
        { key: 'marks', label: 'College marksheet / transcript', type: 'checkbox' }, { key: 'gre', label: 'GRE score and scorecard', type: 'checkbox' },
        { key: 'ielts', label: 'IELTS / TOEFL score and scorecard', type: 'checkbox' }, { key: 'video', label: 'Video essay', type: 'checkbox' },
        { key: 'personal', label: 'Personal details filled in the portal', type: 'checkbox' }, { key: 'form', label: 'Application form', type: 'checkbox' }
      ],
      onSubmit: async (v) => {
        const have = (t) => S.reqs.filter((r) => r.uniId === uniId && r.type === t);
        const add = [];
        if (v.from) {
          for (const s of S.reqs.filter((r) => r.uniId === v.from)) {
            if (s.type !== 'LoR' && s.type !== 'Other' && have(s.type).length) continue;
            const shared = SHARED.includes(s.type);
            add.push(makeReq(uniId, s.type, s.title, shared ? { localPath: s.localPath, url: s.url, score: s.score, status: isDone(s) ? 'Ready' : 'Not started' } : s.type === 'LoR' ? { recommender: s.recommender, email: s.email, mobile: s.mobile || '' } : {}));          }
        } else {
          const want = [['sop', 'SoP', 'Statement of Purpose'], ['resume', 'Resume/CV', 'Resume / CV'], ['marks', 'Marksheet/Transcript', 'College marksheet'], ['gre', 'GRE', 'GRE score and scorecard'], ['ielts', 'IELTS/TOEFL', 'IELTS / TOEFL score and scorecard'], ['video', 'Video essay', 'Video essay'], ['personal', 'Personal details', 'Personal details in portal'], ['form', 'Application form', 'Application form']];
          for (const [k, type, title] of want) {
            if (!v[k] || have(type).length) continue;
            const donor = SHARED.includes(type) ? S.reqs.find((r) => r.type === type && r.uniId !== uniId && (r.localPath || r.url || r.score)) : null;
            add.push(makeReq(uniId, type, title, donor ? { localPath: donor.localPath, url: donor.url, score: donor.score, status: isDone(donor) ? 'Ready' : 'Not started' } : {}));
          }
          const n = Math.max(0, Math.min(10, parseInt(v.lors, 10) || 0));
          for (let i = have('LoR').length + 1; i <= n; i++) add.push(makeReq(uniId, 'LoR', `Recommendation letter ${i}`));
        }
        S.reqs.push(...add);
        await persist(); reload(); toast(add.length ? `Added ${add.length} requirement${add.length === 1 ? '' : 's'}.` : 'Nothing new to add.');
      }
    });
  }

  /* university form */
  function uniForm(id, preset) {
    const cur = uniById(id);
    openForm({
      title: cur ? 'Edit university' : 'Add university', values: cur || preset || {},
      fields: [
        { key: 'name', label: 'University name', required: true }, { key: 'program', label: 'Program' }, { key: 'country', label: 'Country' },
        { key: 'appPortalUrl', label: 'Application portal URL', placeholder: 'https://', hint: 'Where you log in and submit.' },
        { key: 'programUrl', label: 'Program page URL', placeholder: 'https://', hint: 'The department or program requirements page.' },
        { key: 'status', label: 'Status', type: 'select', options: STATUSES, default: 'Researching' },
        { key: 'deadline', label: 'Deadline', type: 'date' }, { key: 'fee', label: 'Application fee (USD)', type: 'number' },
        { key: 'waiverStatus', label: 'Fee waiver', type: 'select', options: WAIVERS, default: 'Not Requested' }, { key: 'waiverNotes', label: 'Waiver code or notes' }
      ],
      onSubmit: async (v) => {
        const rec = { ...(cur || { id: uid() }), ...v, appPortalUrl: fixUrl(v.appPortalUrl), programUrl: fixUrl(v.programUrl), fee: parseFloat(v.fee) || 0 };
        upsert(S.universities, rec);
        await persist(); render(); toast('Saved');
        if (!cur) setTimeout(() => reqSetup(rec.id), 60);
      }
    });
  }

  /* ---------- credentials ---------- */
  const credAcc = { portalName: (c) => normName(c.portalName), uni: (c) => normName(uniLabel(uniById(c.uniId))) };
  function credCards() {
    const f = F.cred, q = f.q.toLowerCase();
    const list = sorted(S.credentials.filter((c) => !q || [c.portalName, c.username, c.portalUrl, uniLabel(uniById(c.uniId))].join(' ').toLowerCase().includes(q)), f, credAcc);
    return `<div class="grid two">${list.map((c) => `<div class="card glass cred">
      <div><h3>${esc(c.portalName || hostOf(c.portalUrl) || 'Portal')}</h3><div class="muted small-t">${esc(c.uniId ? uniLabel(uniById(c.uniId)) : 'General')}${c.portalUrl ? ' · ' + esc(hostOf(c.portalUrl)) : ''}</div></div>
      <div class="field"><span class="k">Username</span><span class="v">${esc(c.username) || '—'}</span><button class="btn small" data-act="cred-copy" data-id="${c.id}" data-field="username" ${c.username ? '' : 'disabled'}>Copy username</button></div>
      <div class="field"><span class="k">Password</span><span class="v">${c.hasPassword ? (revealed[c.id] !== undefined ? esc(revealed[c.id]) : '••••••••••') : 'Not saved'}</span>
        <button class="btn small ghost" data-act="cred-reveal" data-id="${c.id}" ${c.hasPassword ? '' : 'disabled'}>${revealed[c.id] !== undefined ? 'Hide' : 'Show'}</button>
        <button class="btn small" data-act="cred-copy" data-id="${c.id}" data-field="password" ${c.hasPassword ? '' : 'disabled'}>Copy password</button></div>
      <div class="acts">${c.portalUrl ? `<button class="btn small primary" data-act="cred-fill-open" data-id="${c.id}">Open and auto-fill</button><button class="btn small" data-act="cred-open" data-id="${c.id}">Open portal</button>` : ''}
        <button class="btn small ghost" data-act="cred-edit" data-id="${c.id}">Edit</button><button class="btn small danger ghost" data-act="cred-del" data-id="${c.id}">Delete</button></div></div>`).join('')
      || `<div class="card glass empty" style="grid-column:1/-1">${S.credentials.length ? 'No logins match your search.' : 'No logins saved. Add the portal login for a university to keep it here.'}</div>`}</div>`;
  }
  function viewCredentials() {
    const f = F.cred;
    const banner = S.encryptionAvailable
      ? '<div class="banner ok">Passwords are encrypted with your operating system’s secure storage (Windows DPAPI / macOS Keychain) before they are written to disk.</div>'
      : '<div class="banner">Secure storage is not available on this system, so passwords cannot be saved. Usernames still work.</div>';
    return `<div class="page-head"><div><h1>Portal logins</h1><div class="muted small-t">Copied values are cleared from your clipboard after 30 seconds.</div></div><button class="btn primary" data-act="cred-add">Add login</button></div>${banner}
      <div class="toolbar"><input type="search" placeholder="Search portals and usernames" value="${esc(f.q)}" data-inp="f-q" data-t="cred" aria-label="Search">
        <select data-chg="f-sel" data-t="cred" data-k="sort" aria-label="Sort by">${selOpts([['portalName', 'Sort by portal'], ['uni', 'Sort by university']], f.sort)}</select>
        <button class="btn small ghost" data-act="sort" data-t="cred" data-k="${f.sort}">${f.dir === 'asc' ? 'A to Z' : 'Z to A'}</button></div>
      <div id="tblBox">${credCards()}</div>`;
  }
  function credForm(id) {
    const cur = S.credentials.find((c) => c.id === id);
    openForm({
      title: cur ? 'Edit login' : 'Add portal login', values: cur || {},
      fields: [
        { key: 'uniId', label: 'University', type: 'select', options: [['', 'General (no university)']].concat(S.universities.map((u) => [u.id, uniLabel(u)])) },
        { key: 'portalName', label: 'Portal name', required: true }, { key: 'portalUrl', label: 'Portal URL', placeholder: 'https://' },
        { key: 'username', label: 'Username or email' },
        { key: 'password', label: 'Password', type: 'password', placeholder: cur && cur.hasPassword ? 'Leave blank to keep the saved password' : '', hint: 'Encrypted with your OS secure storage before saving.' }
      ],
      onSubmit: async (v) => { S.credentials = await api.saveCred({ ...v, id: cur ? cur.id : undefined, portalUrl: fixUrl(v.portalUrl) }); reload(); toast('Login saved'); }
    });
  }

  /* ---------- scratchpad ---------- */
  function md(src) {
    const inl = (t) => t.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>').replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" data-ext="1">$1</a>');
    let out = '', list = false;
    for (const l of esc(src).split('\n')) {
      let m;
      if ((m = l.match(/^(#{1,3})\s+(.*)/))) { if (list) { out += '</ul>'; list = false; } const k = m[1].length + 2; out += `<h${k}>${inl(m[2])}</h${k}>`; }
      else if ((m = l.match(/^\s*[-*]\s+(.*)/))) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inl(m[1])}</li>`; }
      else { if (list) { out += '</ul>'; list = false; } if (l.trim()) out += `<p>${inl(l)}</p>`; }
    }
    return out + (list ? '</ul>' : '');
  }
  function notesHtml() {
    if (!activeNote || !S.notes.some((n) => n.id === activeNote)) activeNote = S.notes[0] ? S.notes[0].id : null;
    const n = S.notes.find((x) => x.id === activeNote);
    const list = S.notes.map((x) => `<button data-act="note-select" data-id="${x.id}" class="${x.id === activeNote ? 'active' : ''}">${esc(x.title || 'Untitled')}</button>`).join('');
    const ed = n ? `<div class="inline"><input value="${esc(n.title)}" placeholder="Title" data-inp="note-title" aria-label="Note title">
        <button class="btn" data-act="note-mode">${noteMode === 'edit' ? 'Preview' : 'Edit'}</button><button class="btn danger ghost" data-act="note-del" data-id="${n.id}">Delete</button></div>
        ${noteMode === 'edit' ? `<textarea data-inp="note-body" placeholder="Outline an essay or jot down questions for a recommender. Markdown works: # headings, **bold**, - lists." aria-label="Note body">${esc(n.body)}</textarea>` : `<div class="preview">${md(n.body) || '<p class="muted">Nothing to preview.</p>'}</div>`}`
      : '<div class="empty">Create a note for essay outlines and quick thoughts. It saves automatically and stays on this computer.</div>';
    return `<div class="notes"><div class="glass note-list" id="noteList">${list || '<div class="empty">No notes</div>'}</div><div class="glass editor">${ed}</div></div>`;
  }

  const VIEWS = { dashboard: viewDashboard, universities: viewUniversities, credentials: viewCredentials, documents: viewDocuments };
  function refreshBox() {
    const b = $('#tblBox'); if (!b) return;
    b.innerHTML = view === 'universities' ? (uniDetail ? reqTableHtml('det') : uniTableHtml()) : view === 'documents' ? reqTableHtml('req') : view === 'credentials' ? credCards() : '';
  }
  function render() {
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const ws = view === 'workspace';
    $('#workspace').hidden = !ws; $('#view').hidden = ws;
    if (ws) { renderQuick(); renderTabs(); updateNav(); renderSplit(); return; }
    const v = $('#view'), top = v.scrollTop;
    v.innerHTML = VIEWS[view](); v.scrollTop = top;
  }
  const reload = () => { render(); renderSplit(); };
  function setView(v) { view = v; if (v !== 'universities') uniDetail = null; render(); }

  /* ---------- Google: one sign-in shared by every Doc and Sheet ---------- */
  const GOOGLE_DOC = /^https:\/\/(docs|drive|sheets|slides|script)\.google\.com\//i;
  const loginUrl = (to) => 'https://accounts.google.com/ServiceLogin?service=wise&continue=' + encodeURIComponent(to || 'https://docs.google.com/document/u/0/');
  async function refreshGoogle() {
    try { googleIn = (await api.googleStatus()).signedIn; } catch { /* ignore */ }
    $('#gDot').classList.toggle('ok', googleIn);
    $('#gLabel').textContent = googleIn ? 'Google: signed in' : 'Google: not signed in';
    $('#gBtn').textContent = googleIn ? 'Switch account' : 'Sign in once';
  }
  let gTimer = null;
  const scheduleGoogle = () => { clearTimeout(gTimer); gTimer = setTimeout(refreshGoogle, 1200); };

  async function openLink(url, opts = {}) {
    url = normUrl(url); if (!url) return;
    if (GOOGLE_DOC.test(url)) {
      try { const u = new URL(url); if (!u.searchParams.has('authuser')) { u.searchParams.set('authuser', '0'); url = u.toString(); } } catch { /* keep */ }
      await refreshGoogle();
      if (!googleIn) { toast('Sign in to Google once. You will not be asked again unless you switch account.'); url = loginUrl(url); }
    }
    return openTab(url, opts);
  }

  /* ---------- workspace ---------- */
  const tabs = []; let activeId = null;
  const activeTab = () => tabs.find((t) => t.id === activeId);

  function openTab(url, opts = {}) {
    if (view !== 'workspace') { view = 'workspace'; render(); }
    const tab = { id: uid(), url, title: hostOf(url) || 'New tab', ready: false, uniId: opts.uniId || '', credId: opts.credId || '' };
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:uni-apps');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('src', url);
    wv.className = 'off';
    tab.el = wv;
    wv.addEventListener('dom-ready', () => { tab.ready = true; if (tab.id === activeId) updateNav(); });
    wv.addEventListener('page-title-updated', (e) => { tab.title = e.title; renderTabs(); });
    const nav = (e) => { if (e.isMainFrame !== false) { tab.url = e.url; if (tab.id === activeId) updateNav(); if (/google\.com/i.test(hostOf(e.url))) scheduleGoogle(); } };
    wv.addEventListener('did-navigate', nav);
    wv.addEventListener('did-navigate-in-page', nav);
    wv.addEventListener('did-fail-load', (e) => { if (e.isMainFrame && e.errorCode !== -3) toast(`Could not load the page (${e.errorDescription}).`, 'warn'); });
    if (opts.autofill) wv.addEventListener('did-finish-load', () => setTimeout(() => autofill(tab.credId, tab, true), 1200), { once: true });
    $('#webviews').appendChild(wv);
    tabs.push(tab);
    selectTab(tab.id);
    return tab;
  }
  function selectTab(id) {
    activeId = id;
    tabs.forEach((t) => t.el.classList.toggle('off', t.id !== id));
    $('#wsEmpty').hidden = tabs.length > 0;
    const t = activeTab(); if (t && t.uniId) splitUni = t.uniId;
    renderTabs(); updateNav(); renderSplit();
  }
  function closeTab(id) {
    const i = tabs.findIndex((t) => t.id === id); if (i < 0) return;
    tabs[i].el.remove(); tabs.splice(i, 1);
    if (activeId === id) selectTab(tabs.length ? tabs[Math.max(0, i - 1)].id : null); else renderTabs();
    $('#wsEmpty').hidden = tabs.length > 0;
  }
  function renderTabs() {
    $('#tabs').innerHTML = tabs.map((t) => `<div class="tab ${t.id === activeId ? 'active' : ''}" data-act="tab-select" data-id="${t.id}" title="${esc(t.url)}"><span class="n">${esc(t.title)}</span><button data-act="tab-close" data-id="${t.id}" aria-label="Close tab">✕</button></div>`).join('');
  }
  function updateNav() {
    const t = activeTab(), bar = $('#urlBar');
    if (document.activeElement !== bar) bar.value = t ? t.url : '';
    let b = false, f = false;
    try { if (t && t.ready) { b = t.el.canGoBack(); f = t.el.canGoForward(); } } catch { /* not ready */ }
    document.querySelector('[data-act=nav-back]').style.opacity = b ? 1 : .4;
    document.querySelector('[data-act=nav-forward]').style.opacity = f ? 1 : .4;
  }
  function renderQuick() {
    const items = [['Google Docs', 'https://docs.google.com/document/u/0/'], ['Google Sheets', 'https://docs.google.com/spreadsheets/u/0/'], ['Google Drive', 'https://drive.google.com/']];
    S.universities.forEach((u) => { if (u.appPortalUrl) items.push([`${u.name}: application portal`, u.appPortalUrl]); if (u.programUrl) items.push([`${u.name}: program page`, u.programUrl]); });
    S.reqs.filter((r) => r.url).forEach((r) => items.push([`${r.title} (${uniLabel(uniById(r.uniId))})`, r.url]));
    $('#quickOpen').innerHTML = '<option value="">Open saved link</option>' + items.map(([l, u]) => `<option value="${esc(u)}">${esc(l)}</option>`).join('');
  }
  async function autofill(credId, tab, silent) {
    tab = tab || activeTab();
    if (!tab || !tab.ready) return toast('Open a portal page in the workspace first.', 'warn');
    let id = credId || tab.credId;
    if (!id) {
      const h = hostOf(tab.url);
      const c = S.credentials.find((x) => hostOf(x.portalUrl) === h) || (tab.uniId && S.credentials.find((x) => x.uniId === tab.uniId));
      id = c && c.id;
    }
    if (!id) return toast('No saved login matches this page. Add one under Portal logins.', 'warn');
    try {
      const r = await api.autofill(id, tab.el.getWebContentsId());
      if (r.user || r.password) toast(r.password ? 'Login filled in. Check it, then sign in.' : 'Username filled in. Continue to the password step and fill again.');
      else if (!silent) toast('No login form found on this page yet.', 'warn');
    } catch (e) { fail(e); }
  }

  function renderSplit() {
    const pane = $('#splitPane');
    $('#splitBtn').classList.toggle('primary', split);
    if (!split) { pane.hidden = true; return; }
    pane.hidden = false;
    if (!uniById(splitUni)) splitUni = (S.universities[0] || {}).id || '';
    const u = uniById(splitUni);
    const head = `<select data-chg="split-uni" aria-label="Application">${S.universities.map((x) => `<option value="${x.id}"${x.id === splitUni ? ' selected' : ''}>${esc(uniLabel(x))}</option>`).join('') || '<option>No universities yet</option>'}</select>
      <div class="seg"><button data-act="split-mode" data-id="checklist" class="${splitMode === 'checklist' ? 'active' : ''}">Requirements</button><button data-act="split-mode" data-id="passwords" class="${splitMode === 'passwords' ? 'active' : ''}">Logins</button></div>`;
    let body = '<div class="empty">Add a university to see its requirements here.</div>';
    if (u && splitMode === 'checklist') {
      const p = progOf(u.id), rs = S.reqs.filter((r) => r.uniId === u.id).sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || REQ_TYPES.indexOf(a.type) - REQ_TYPES.indexOf(b.type));
      body = `<div>${stBadge(u.status)} ${u.deadline ? dayBadge(u.deadline) : ''}</div><div>${progBar(p)}</div>
        <div class="hdr-row">${u.appPortalUrl ? `<button class="btn small" data-act="uni-portal" data-id="${u.id}" data-which="app">Application portal</button>` : ''}${u.programUrl ? `<button class="btn small" data-act="uni-portal" data-id="${u.id}" data-which="program">Program page</button>` : ''}<button class="btn small ghost" data-act="uni-open" data-id="${u.id}">Full details</button></div>
        ${rs.map((r) => `<div class="check ${isDone(r) ? 'done' : ''}"><div class="t"><b>${esc(r.title)}</b><span class="muted small-t">${esc(r.type)}${r.recommender ? ' · ' + esc(r.recommender) : ''}${r.score ? ' · ' + esc(r.score) : ''}</span>
          <div class="row-actions" style="justify-content:flex-start;margin-top:4px;flex-wrap:wrap"><select class="mini-sel" data-chg="req-status" data-id="${r.id}" aria-label="Status">${selOpts(statusOpts(r.type), r.status)}</select>${r.url ? `<button class="btn small" data-act="req-link" data-id="${r.id}">Open</button>` : ''}${r.localPath ? `<button class="btn small ghost" data-act="req-file" data-id="${r.id}">File</button>` : ''}<button class="btn small ghost" data-act="req-edit" data-id="${r.id}">Edit</button></div></div></div>`).join('') || '<div class="empty">No requirements yet.</div>'}`;
    } else if (u) {
      body = S.credentials.filter((c) => c.uniId === u.id).map((c) => `<div class="cred" style="padding:0"><h3>${esc(c.portalName)}</h3>
        <div class="field"><span class="k">User</span><span class="v">${esc(c.username) || '—'}</span><button class="btn small" data-act="cred-copy" data-id="${c.id}" data-field="username">Copy</button></div>
        <div class="field"><span class="k">Password</span><span class="v">${revealed[c.id] !== undefined ? esc(revealed[c.id]) : '••••••••'}</span><button class="btn small ghost" data-act="cred-reveal" data-id="${c.id}">${revealed[c.id] !== undefined ? 'Hide' : 'Show'}</button><button class="btn small" data-act="cred-copy" data-id="${c.id}" data-field="password">Copy</button></div>
        <div class="acts"><button class="btn small primary" data-act="cred-fill" data-id="${c.id}">Fill current page</button></div></div>`).join('') || '<div class="empty">No logins saved for this application.</div>';
    }
    pane.innerHTML = head + body;
  }

  /* ---------- actions ---------- */
  const reqById = (id) => S.reqs.find((r) => r.id === id);
  const H = {
    'uni-add': () => uniForm(), 'uni-edit': (id) => uniForm(id),
    'uni-add-program': (id) => { const u = uniById(id); uniForm(null, { name: u.name, country: u.country, appPortalUrl: u.appPortalUrl, programUrl: '' }); },
    'uni-open': (id) => { view = 'universities'; uniDetail = id; render(); },
    'uni-back': () => { uniDetail = null; render(); },
    'uni-del': async (id) => {
      if (!(await confirmBox('Deleting an application also removes its requirements and saved logins.'))) return;
      S.universities = S.universities.filter((u) => u.id !== id); S.reqs = S.reqs.filter((r) => r.uniId !== id);
      if (uniDetail === id) uniDetail = null;
      await persist(); reload(); toast('Deleted');
    },
    'uni-portal': (id, el) => { const u = uniById(id); const url = el && el.dataset.which === 'program' ? u.programUrl : u.appPortalUrl; if (url) openLink(url, { uniId: u.id, credId: el.dataset.which === 'program' ? undefined : (S.credentials.find((c) => c.uniId === u.id) || {}).id }); },
    'uni-work': (id) => {
      const u = uniById(id); split = true; splitMode = 'checklist'; splitUni = id;
      if (u.appPortalUrl && !tabs.some((t) => t.uniId === id)) openLink(u.appPortalUrl, { uniId: id, credId: (S.credentials.find((c) => c.uniId === id) || {}).id }); else setView('workspace');
    },
    sort: (id, el) => { const f = F[el.dataset.t], k = el.dataset.k; if (f.sort === k) f.dir = f.dir === 'asc' ? 'desc' : 'asc'; else { f.sort = k; f.dir = 'asc'; } render(); },

    'req-add': (id) => reqForm(null, id || (view === 'universities' ? uniDetail : '')), 'req-edit': (id) => reqForm(id), 'req-setup': (id) => reqSetup(id),
    'req-del': async (id) => { if (await confirmBox('This removes the requirement only. Your file stays where it is.', 'Remove')) { S.reqs = S.reqs.filter((r) => r.id !== id); await persist(); reload(); } },
    'req-file': async (id) => { const err = await api.openFile(reqById(id).localPath); if (err) toast('Could not open the file: ' + err, 'bad'); },
    'req-reveal': (id) => api.revealFile(reqById(id).localPath),
    'req-link': (id) => { const r = reqById(id); openLink(r.url, { uniId: r.uniId }); },
    'rec-profile': (_id, el) => { showRecommenderCard({name: el.dataset.name, email: el.dataset.email,mobile: el.dataset.mobile});},

    'cred-add': () => credForm(), 'cred-edit': (id) => credForm(id),
    'cred-del': async (id) => { if (await confirmBox('This removes the saved login and its encrypted password.')) { S.credentials = await api.deleteCred(id); delete revealed[id]; reload(); toast('Deleted'); } },
    'cred-copy': async (id, el) => { if (await api.copyCred(id, el.dataset.field)) toast('Copied. Your clipboard clears in 30 seconds.'); },
    'cred-reveal': async (id) => {
      if (revealed[id] !== undefined) { delete revealed[id]; return reload(); }
      revealed[id] = await api.revealPassword(id); reload();
      setTimeout(() => { delete revealed[id]; reload(); }, 15000);
    },
    'cred-open': (id) => { const c = S.credentials.find((x) => x.id === id); if (c && c.portalUrl) openLink(c.portalUrl, { uniId: c.uniId, credId: c.id }); },
    'cred-fill-open': (id) => { const c = S.credentials.find((x) => x.id === id); if (c && c.portalUrl) openLink(c.portalUrl, { uniId: c.uniId, credId: c.id, autofill: true }); },
    'cred-fill': (id) => autofill(id, activeTab()),

    'doc-tab': (id) => { docTab = id; render(); },
    'note-new': async () => { const n = { id: uid(), title: 'Untitled note', body: '', updated: Date.now() }; S.notes.unshift(n); activeNote = n.id; noteMode = 'edit'; await persist(); render(); },
    'note-select': (id) => { activeNote = id; render(); },
    'note-mode': () => { noteMode = noteMode === 'edit' ? 'preview' : 'edit'; render(); },
    'note-del': async (id) => { if (await confirmBox('Delete this note?')) { S.notes = S.notes.filter((n) => n.id !== id); activeNote = null; await persist(); render(); } },

    'tab-new': () => openForm({ title: 'New tab', submit: 'Open', fields: [{ key: 'url', label: 'Web address or search', required: true }], onSubmit: (v) => { openLink(v.url); } }),
    'tab-select': (id) => selectTab(id), 'tab-close': (id) => closeTab(id),
    'nav-back': () => { const t = activeTab(); try { if (t && t.el.canGoBack()) t.el.goBack(); } catch { /* */ } },
    'nav-forward': () => { const t = activeTab(); try { if (t && t.el.canGoForward()) t.el.goForward(); } catch { /* */ } },
    'nav-reload': () => { const t = activeTab(); try { if (t) t.el.reload(); } catch { /* */ } },
    'nav-external': () => { const t = activeTab(); if (t) api.openExternal(t.url); },
    'autofill-active': () => autofill(null, activeTab()),
    'split-toggle': () => { split = !split; renderSplit(); },
    'split-mode': (id) => { splitMode = id; renderSplit(); },

    'google-btn': async () => {
      if (!googleIn) return void openTab(loginUrl());
      if (!(await confirmBox('This signs the app’s browser out of Google so you can sign in with a different account. Your saved links and files are not affected.', 'Switch account'))) return;
      await api.googleSwitch();
      tabs.filter((t) => /google\.com/i.test(hostOf(t.url))).forEach((t) => closeTab(t.id));
      await refreshGoogle(); openTab(loginUrl());
    },

    'export-json': () => openForm({
      title: 'Export backup (JSON)', submit: 'Choose file', fields: [{ key: 'pass', label: 'Passphrase for saved passwords (optional)', type: 'password', hint: 'Leave blank to leave passwords out of the file. With 8+ characters, passwords are included and encrypted with this passphrase.' }],
      onSubmit: async (v) => { const r = await api.exportBackup({ format: 'json', passphrase: v.pass || null }); if (r.canceled) return false; toast(r.passwordsIncluded ? 'Backup saved with encrypted passwords.' : 'Backup saved without passwords.'); }
    }),
    'export-csv': async () => { const r = await api.exportBackup({ format: 'csv' }); if (!r.canceled) toast('CSV saved.'); },
    import: async () => {
      if (!(await confirmBox('Importing replaces your current universities, requirements, notes and logins.', 'Choose backup'))) return;
      handleImport(await api.importBackup());
    }
  };

  function handleImport(res) {
    if (res.canceled) return;
    if (res.needPassphrase) {
      return openForm({
        title: 'This backup includes passwords', submit: 'Import', fields: [{ key: 'pass', label: 'Passphrase', type: 'password', required: true, hint: res.wrong ? 'That passphrase did not work. Try again.' : '' }],
        onSubmit: async (v) => { const r = await api.importBackup(v.pass); if (r.needPassphrase) { toast('Wrong passphrase.', 'bad'); return false; } applyImported(r.data); }
      });
    }
    applyImported(res.data);
  }
  function applyImported(d) { S = d; activeNote = null; uniDetail = null; reload(); toast('Backup imported.'); }

  const C = {
    'uni-status': async (id, el) => { uniById(id).status = el.value; await persist(); reload(); toast('Status updated'); },
    'req-status': async (id, el) => { reqById(id).status = el.value; await persist(); reload(); },
    'f-sel': (id, el) => { F[el.dataset.t][el.dataset.k] = el.value; render(); },
    'uni-group': (id, el) => { F.uni.group = el.checked; render(); },
    'dash-all': (id, el) => { dashAll = el.checked; render(); },
    'split-uni': (id, el) => { splitUni = el.value; renderSplit(); }
  };
  let noteTimer = null;
  const I = {
    'f-q': (el) => { F[el.dataset.t].q = el.value; refreshBox(); },
    'note-title': (el) => { S.notes.find((x) => x.id === activeNote).title = el.value; const b = $('#noteList .active'); if (b) b.textContent = el.value || 'Untitled'; saveNoteSoon(); },
    'note-body': (el) => { S.notes.find((x) => x.id === activeNote).body = el.value; saveNoteSoon(); }
  };
  function saveNoteSoon() { clearTimeout(noteTimer); noteTimer = setTimeout(persist, 600); }

  /* ---------- wiring ---------- */
  document.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-act]');
    if (a && H[a.dataset.act]) {
      if (a.dataset.act === 'uni-open' && e.target.closest('select,button:not(.link-btn)') && e.target.closest('tr.clickable') && !e.target.closest('.link-btn') && a.tagName === 'TR') return;
      try { await H[a.dataset.act](a.dataset.id, a, e); } catch (err) { fail(err); }
      return;
    }
    const o = e.target.closest('[data-open]'); if (o) { openLink(o.dataset.open); return; }
    const x = e.target.closest('a[data-ext]'); if (x) { e.preventDefault(); openLink(x.getAttribute('href')); }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const r = e.target.closest && e.target.closest('.board-row[data-act]'); if (r) H['uni-open'](r.dataset.id); } });
  document.addEventListener('change', async (e) => {
    const el = e.target.closest('[data-chg]');
    if (el && C[el.dataset.chg]) { try { await C[el.dataset.chg](el.dataset.id, el); } catch (err) { fail(err); } }
  });
  document.addEventListener('input', (e) => { const el = e.target.closest('[data-inp]'); if (el && I[el.dataset.inp]) I[el.dataset.inp](el); });
  $('#nav').addEventListener('click', (e) => { const b = e.target.closest('[data-view]'); if (b) { uniDetail = null; setView(b.dataset.view); } });
  $('#urlBar').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const url = normUrl(e.target.value); if (!url) return;
    const t = activeTab();
    if (!t) openLink(url); else { t.url = url; try { t.el.loadURL(url).catch(() => {}); } catch { t.el.setAttribute('src', url); } }
    e.target.blur();
  });
  $('#quickOpen').addEventListener('change', (e) => { if (e.target.value) openLink(e.target.value); e.target.value = ''; });

  (async function boot() {
    try { S = await api.loadData(); } catch (e) { fail(e); }
    api.onOpenTab((url) => openLink(url, { uniId: (activeTab() || {}).uniId }));
    api.onNavigate((v) => setView(v));
    render();
    refreshGoogle();
  })();
})();
