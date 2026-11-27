// The iPhone app's own copy of the saved games.
// In the App Store app, iOS can clear a web view's storage when the phone runs short of space. So the app also
// keeps every Hull and Honor save (the autosave, the three slots and the before-the-fight copy) in one file in its
// Documents folder, which iOS never clears and which goes into the phone's backups. In a browser there's no such
// folder and this does nothing. The file is written a moment after the last change, to a spare name first and then
// moved into place, so a half-written file is never the one loaded.
const PREFIX = 'hullandhonor.';
const FILE = 'hullandhonor-saves.json', SPARE = 'hullandhonor-saves.writing.json', DIR = 'DOCUMENTS';
const q = { busy: false, dirty: false, timer: null, ready: false };

function files() {
  try { const C = window.Capacitor; return (C && C.isNativePlatform && C.isNativePlatform() && C.Plugins && C.Plugins.Filesystem) || null; } catch (e) { return null; }
}

function snapshot() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out[k] = localStorage.getItem(k);
    }
  } catch (e) { /* ignore */ }
  return out;
}

function flush() {
  const fs = files();
  if (!fs || !q.ready || q.busy || !q.dirty) return;
  q.dirty = false; q.busy = true;
  const text = JSON.stringify(snapshot());
  fs.writeFile({ path: SPARE, data: text, directory: DIR, encoding: 'utf8' })
    .then(() => fs.rename({ from: SPARE, to: FILE, directory: DIR, toDirectory: DIR }))
    .catch(() => { /* the web storage still has it */ })
    .then(() => { q.busy = false; if (q.dirty) flush(); });
}

// Call after any save is written or removed.
export function backupSaves() {
  if (!files()) return;
  q.dirty = true;
  clearTimeout(q.timer);
  q.timer = setTimeout(flush, 800);
}

// At startup in the app: if the web storage has no saves but the file does, the storage was cleared, so the saves
// are put back and the page reloads with them. Calls then() when the game can start normally.
export function restoreSaves(then) {
  const fs = files();
  if (!fs) { then(); return; }
  const done = () => { q.ready = true; flush(); then(); };
  if (Object.keys(snapshot()).length) { done(); return; }
  Promise.race([
    fs.readFile({ path: FILE, directory: DIR, encoding: 'utf8' }).then(r => (r && typeof r.data === 'string' ? r.data : null), () => null),
    new Promise(res => setTimeout(() => res(null), 2500)),
  ]).then(text => {
    let saved = null;
    try { saved = text ? JSON.parse(text) : null; } catch (e) { saved = null; }
    if (!saved || !Object.keys(saved).length) { done(); return; }
    try {
      for (const [k, v] of Object.entries(saved)) if (k.startsWith(PREFIX)) localStorage.setItem(k, v);
      if (!Object.keys(snapshot()).length) throw new Error('storage refused');
    } catch (e) { done(); return; }
    location.reload();
  }, done);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { clearTimeout(q.timer); flush(); } });
}
