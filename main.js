'use strict';
const {
  app, BrowserWindow, ipcMain, safeStorage, shell, dialog, clipboard,
  Notification, webContents, session
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PARTITION = 'persist:uni-apps';
const CHROME = '131.0.0.0';
const UA = process.platform === 'darwin'
  ? `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`
  : `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME} Safari/537.36`;
app.userAgentFallback = UA; // standard desktop Chrome UA so Google sign-in / Docs editing work

if (process.platform === 'win32') app.setAppUserModelId('com.example.unihub');
if (!app.requestSingleInstanceLock()) { app.quit(); }

let mainWindow = null;
let db = null;
let dbFile = '';
let pendingImport = null;
let clipTimer = null;
let lastCopied = null;

/* ---------- storage ---------- */
const str = (v, max = 2000) => (typeof v === 'string' ? v.slice(0, max) : '');
const arr = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object').slice(0, 5000) : []);
const emptyDb = () => ({ universities: [], reqs: [], notes: [], credentials: [], notified: {} });

const TYPE_MAP = { Transcript: 'Marksheet/Transcript' };
const LOR_MAP = { 'Not Requested': 'Not started', Requested: 'Requested', 'In Progress': 'In progress', Submitted: 'Submitted' };
const blankReq = (o) => ({ id: crypto.randomUUID(), uniId: '', type: 'Other', title: '', status: 'Not started', localPath: '', url: '', score: '', notes: '', recommender: '', email: '', mobile: '', requestDate: '', dueDate: '', ...o });

// Accepts current data and older formats (separate documents / LoRs lists, single portalUrl).
function migrate(d) {
  const universities = arr(d.universities).map((u) => {
    const { portalUrl, ...r } = u;
    return { ...r, appPortalUrl: u.appPortalUrl || portalUrl || '', programUrl: u.programUrl || '' };
  });
  let reqs;
  if (Array.isArray(d.reqs)) reqs = arr(d.reqs);
  else {
    reqs = arr(d.documents).map((x) => blankReq({
      id: x.id || crypto.randomUUID(), uniId: x.uniId || '', type: TYPE_MAP[x.type] || x.type || 'Other', title: x.title || 'Document',
      status: x.done ? 'Ready' : 'Not started', localPath: x.localPath || '', url: x.url || ''
    }));
    for (const l of arr(d.lors)) {
      reqs.push(blankReq({
        id: l.id || crypto.randomUUID(), uniId: l.uniId || '', type: 'LoR', title: 'LoR – ' + (l.recommender || 'recommender'),
        recommender: l.recommender || '', email: l.email || '', mobile: l.mobile || '', requestDate: l.requestDate || '', dueDate: l.dueDate || '', status: LOR_MAP[l.status] || 'Not started'
      }));
    }
  }
  return { universities, reqs, notes: arr(d.notes) };
}
const stripCred = (c) => { const { appId, ...rest } = c; return rest; };

function loadDb() {
  try {
    const raw = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
    db = { ...emptyDb(), ...migrate(raw), credentials: arr(raw.credentials).map(stripCred), notified: raw.notified || {} };
  } catch { db = emptyDb(); }
}
function saveDb() {
  const tmp = dbFile + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, dbFile);
}
const credMeta = (c) => { const { passwordEnc, ...rest } = c; return { ...rest, hasPassword: !!passwordEnc }; };
const publicDb = () => ({
  universities: db.universities, reqs: db.reqs, notes: db.notes,
  credentials: db.credentials.map(credMeta),
  encryptionAvailable: safeStorage.isEncryptionAvailable()
});
const isDone = (r) => r.status === 'Submitted' || (r.type !== 'LoR' && r.status === 'Ready');

function encryptPw(pw) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this system, so passwords cannot be saved.');
  return safeStorage.encryptString(pw).toString('base64');
}
function decryptPw(c) {
  if (!c || !c.passwordEnc) return '';
  try { return safeStorage.decryptString(Buffer.from(c.passwordEnc, 'base64')); } catch { return ''; }
}

/* ---------- clipboard with auto-clear ---------- */
function copySecure(text) {
  clipboard.writeText(text);
  lastCopied = text;
  clearTimeout(clipTimer);
  clipTimer = setTimeout(clearClipboardIfOurs, 30000);
}
function clearClipboardIfOurs() {
  if (lastCopied !== null && clipboard.readText() === lastCopied) clipboard.clear();
  lastCopied = null;
}

/* ---------- window ---------- */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1020, minHeight: 640,
    backgroundColor: '#090A0F', title: 'Application Hub', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: true, webviewTag: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.webContents.on('will-attach-webview', (e, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.webSecurity = true;
    params.partition = PARTITION;
    if (params.src && !/^https?:\/\//i.test(params.src)) e.preventDefault();
  });
  mainWindow.on('closed', () => { mainWindow = null; });
  setTimeout(checkDeadlines, 6000);
}

app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() === 'webview') {
    wc.setUserAgent(UA);
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/accounts\.google\.com\//i.test(url)) return { action: 'allow' };
      if (/^https?:\/\//i.test(url) && mainWindow) mainWindow.webContents.send('open-tab', url);
      return { action: 'deny' };
    });
  }
});

app.on('second-instance', () => {
  if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); }
});
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('will-quit', clearClipboardIfOurs);

app.whenReady().then(() => {
  dbFile = path.join(app.getPath('userData'), 'university-data.json');
  loadDb();
  session.fromPartition(PARTITION).setUserAgent(UA);
  createWindow();
  setInterval(checkDeadlines, 30 * 60 * 1000);
});

/* ---------- notifications ---------- */
const endOfDay = (d) => new Date(d + 'T23:59:59').getTime();

function checkDeadlines() {
  if (!db || !Notification.isSupported()) return;
  const now = Date.now();
  const items = [];
  for (const u of db.universities) {
    if (u.deadline && ['Researching', 'Drafting'].includes(u.status)) {
      const open = db.reqs.filter((r) => r.uniId === u.id && !isDone(r)).length;
      items.push({
        key: 'u' + u.id, due: endOfDay(u.deadline), title: `Deadline: ${u.name}`,
        what: `${u.name}${u.program ? ' (' + u.program + ')' : ''}${open ? ` still has ${open} open requirement${open === 1 ? '' : 's'} and` : ''}`
      });
    }
  }
  for (const r of db.reqs) {
    if (r.type === 'LoR' && r.dueDate && !isDone(r)) {
      const u = db.universities.find((x) => x.id === r.uniId);
      items.push({ key: 'l' + r.id, due: endOfDay(r.dueDate), title: `LoR due: ${r.recommender || 'recommender'}`, what: `The recommendation letter${u ? ' for ' + u.name : ''}` });
    }
  }
  let changed = false;
  for (const it of items) {
    const hrs = (it.due - now) / 36e5;
    if (hrs < 0 || Number.isNaN(hrs)) continue;
    const th = [24, 72, 168].find((t) => hrs <= t);
    if (!th) continue;
    const nk = `${it.key}:${it.due}:${th}`;
    if (db.notified[nk]) continue;
    for (const t of [24, 72, 168]) if (t >= th) db.notified[`${it.key}:${it.due}:${t}`] = true;
    changed = true;
    const when = th === 24 ? 'within 24 hours' : th === 72 ? 'within 3 days' : 'within 7 days';
    const n = new Notification({ title: it.title, body: `${it.what} is due ${when}.` });
    n.on('click', () => {
      if (!mainWindow) return;
      mainWindow.show(); mainWindow.focus(); mainWindow.webContents.send('navigate', 'dashboard');
    });
    n.show();
  }
  if (changed) saveDb();
}

/* ---------- IPC: data ---------- */
ipcMain.handle('data:load', () => publicDb());

ipcMain.handle('data:save', (_e, p) => {
  db.universities = arr(p.universities);
  db.reqs = arr(p.reqs);
  db.notes = arr(p.notes);
  const ids = new Set(db.universities.map((u) => u.id));
  db.reqs = db.reqs.filter((r) => !r.uniId || ids.has(r.uniId));
  db.credentials = db.credentials.filter((c) => !c.uniId || ids.has(c.uniId));
  saveDb();
  checkDeadlines();
  return db.credentials.map(credMeta);
});

/* ---------- IPC: credentials ---------- */
ipcMain.handle('cred:save', (_e, c) => {
  const existing = c.id ? db.credentials.find((x) => x.id === c.id) : null;
  const rec = existing || { id: crypto.randomUUID() };
  rec.uniId = str(c.uniId, 100);
  rec.portalName = str(c.portalName, 200);
  rec.portalUrl = str(c.portalUrl, 1000);
  rec.username = str(c.username, 300);
  if (typeof c.password === 'string' && c.password.length) rec.passwordEnc = encryptPw(c.password);
  if (!existing) db.credentials.push(rec);
  saveDb();
  return db.credentials.map(credMeta);
});

ipcMain.handle('cred:delete', (_e, id) => {
  db.credentials = db.credentials.filter((c) => c.id !== id);
  saveDb();
  return db.credentials.map(credMeta);
});

ipcMain.handle('cred:reveal', (_e, id) => decryptPw(db.credentials.find((c) => c.id === id)));

ipcMain.handle('cred:copy', (_e, id, field) => {
  const c = db.credentials.find((x) => x.id === id);
  if (!c) return false;
  const text = field === 'password' ? decryptPw(c) : c.username;
  if (!text) return false;
  copySecure(text);
  return true;
});

ipcMain.handle('cred:autofill', async (_e, id, wcId) => {
  const c = db.credentials.find((x) => x.id === id);
  const wc = webContents.fromId(wcId);
  if (!c || !wc || wc.session !== session.fromPartition(PARTITION)) throw new Error('Open the portal in a workspace tab first.');
  const script = `(function(u,p){
    const vis=e=>!!(e.offsetWidth||e.offsetHeight||e.getClientRects().length);
    const set=(el,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;el.focus();s.call(el,v);el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));};
    const inputs=[...document.querySelectorAll('input')].filter(vis);
    const pw=inputs.find(i=>i.type==='password');
    const textual=i=>['text','email','tel',''].includes(i.type);
    let user=null;
    if(pw){user=inputs.slice(0,inputs.indexOf(pw)).reverse().find(textual);}
    else{user=inputs.find(i=>i.type==='email')||inputs.find(textual);}
    if(user&&u)set(user,u);
    if(pw&&p)set(pw,p);
    return {user:!!user,password:!!pw};
  })(${JSON.stringify(c.username)},${JSON.stringify(decryptPw(c))})`;
  return wc.executeJavaScript(script, true);
});

/* ---------- IPC: one-time Google sign-in (shared by every Docs / Sheets / Drive tab) ---------- */
const GOOGLE_AUTH_COOKIES = ['SID', '__Secure-1PSID', '__Secure-3PSID', 'SAPISID'];
ipcMain.handle('google:status', async () => {
  const cookies = await session.fromPartition(PARTITION).cookies.get({ domain: 'google.com' });
  return { signedIn: cookies.some((c) => GOOGLE_AUTH_COOKIES.includes(c.name)) };
});
ipcMain.handle('google:switch', async () => {
  const ses = session.fromPartition(PARTITION);
  const all = await ses.cookies.get({});
  for (const c of all) {
    if (/google|youtube|gstatic/i.test(c.domain)) {
      try { await ses.cookies.remove(`${c.secure ? 'https' : 'http'}://${c.domain.replace(/^\./, '')}${c.path}`, c.name); } catch { /* ignore */ }
    }
  }
  await ses.clearStorageData({
    storages: ['localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
    origins: ['https://accounts.google.com', 'https://docs.google.com', 'https://drive.google.com', 'https://www.google.com']
  });
  return true;
});
app.on('before-quit', () => { try { session.fromPartition(PARTITION).flushStorageData(); } catch { /* ignore */ } });

/* ---------- IPC: files & shell ---------- */
ipcMain.handle('file:browse', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Documents', extensions: ['docx', 'doc', 'pdf', 'txt', 'md', 'rtf', 'xlsx', 'pptx'] }, { name: 'All files', extensions: ['*'] }]
  });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('file:open', async (_e, p) => (typeof p === 'string' && p ? shell.openPath(p) : 'No file path'));
ipcMain.handle('file:reveal', (_e, p) => { if (typeof p === 'string' && p) shell.showItemInFolder(p); return true; });
ipcMain.handle('shell:external', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) { shell.openExternal(url); return true; }
  return false;
});

/* ---------- IPC: backup ---------- */
function packSecrets(obj, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
}
function unpackSecrets(box, pass) {
  const key = crypto.scryptSync(pass, Buffer.from(box.salt, 'base64'), 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'));
  d.setAuthTag(Buffer.from(box.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(box.data, 'base64')), d.final()]).toString('utf8'));
}
const csvCell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // spreadsheet formula-injection guard
  return '"' + s.replace(/"/g, '""') + '"';
};

ipcMain.handle('backup:export', async (_e, { format, passphrase } = {}) => {
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === 'csv') {
    const r = await dialog.showSaveDialog(mainWindow, { defaultPath: `applications-${stamp}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled) return { canceled: true };
    const cols = ['name', 'program', 'country', 'appPortalUrl', 'programUrl', 'status', 'deadline', 'fee', 'waiverStatus', 'waiverNotes'];
    const lines = [cols.concat(['requirementsDone', 'requirementsTotal']).join(',')].concat(db.universities.map((u) => {
      const mine = db.reqs.filter((x) => x.uniId === u.id);
      return cols.map((k) => csvCell(u[k])).concat([mine.filter(isDone).length, mine.length]).join(',');
    }));
    fs.writeFileSync(r.filePath, '\ufeff' + lines.join('\r\n'));
    return { path: r.filePath };
  }
  const r = await dialog.showSaveDialog(mainWindow, { defaultPath: `application-hub-backup-${stamp}.json`, filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return { canceled: true };
  const out = {
    app: 'application-hub', version: 2, exportedAt: new Date().toISOString(),
    universities: db.universities, reqs: db.reqs, notes: db.notes,
    credentials: db.credentials.map(credMeta)
  };
  if (passphrase) {
    if (passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters.');
    const secrets = {};
    for (const c of db.credentials) if (c.passwordEnc) secrets[c.id] = decryptPw(c);
    out.secrets = packSecrets(secrets, passphrase);
  }
  fs.writeFileSync(r.filePath, JSON.stringify(out, null, 2));
  return { path: r.filePath, passwordsIncluded: !!passphrase };
});

function applyImport(data, passphrase) {
  let secrets = {};
  if (data.secrets) {
    if (!passphrase) return { needPassphrase: true };
    try { secrets = unpackSecrets(data.secrets, passphrase); }
    catch { return { needPassphrase: true, wrong: true }; }
  }
  const m = migrate(data);
  db.universities = m.universities; db.reqs = m.reqs; db.notes = m.notes;
  db.notified = {};
  db.credentials = arr(data.credentials).map((c) => {
    const rec = {
      id: str(c.id, 100) || crypto.randomUUID(), uniId: str(c.uniId, 100), portalName: str(c.portalName, 200),
      portalUrl: str(c.portalUrl, 1000), username: str(c.username, 300)
    };
    if (secrets[rec.id] && safeStorage.isEncryptionAvailable()) rec.passwordEnc = encryptPw(secrets[rec.id]);
    return rec;
  });
  saveDb();
  return { data: publicDb() };
}

ipcMain.handle('backup:import', async (_e, passphrase) => {
  if (passphrase === undefined || passphrase === null) {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'JSON backup', extensions: ['json'] }] });
    if (r.canceled) return { canceled: true };
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')); } catch { throw new Error('That file is not a valid JSON backup.'); }
    if (!parsed || parsed.app !== 'application-hub') throw new Error('That file is not an Application Hub backup.');
    pendingImport = parsed;
    return applyImport(parsed, '');
  }
  if (!pendingImport) throw new Error('No import in progress.');
  const res = applyImport(pendingImport, passphrase);
  if (res.data) pendingImport = null;
  return res;
});
