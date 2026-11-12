// Profiles, their personal landmarks, and walk logs (transcripts, GPS, tool calls), kept on the phone.
// Storage can be blocked (private browsing), so every access is guarded.
const KEY = 'local.profiles';
const WALKS = 'local.walks';

function read(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}

export function profileNames() {
  return Object.keys(read(KEY, {}));
}

export function getProfile(name) {
  const all = read(KEY, {});
  all[name] ??= { name, landmarks: [] };
  write(KEY, all);
  return all[name];
}

export function saveLandmark(name, landmark) {
  const all = read(KEY, {});
  all[name] ??= { name, landmarks: [] };
  all[name].landmarks.push({ ...landmark, id: Date.now().toString(36), created: new Date().toISOString() });
  write(KEY, all);
  return all[name].landmarks.length;
}

// --- Walk logs ---------------------------------------------------------------------

export class WalkLog {
  constructor(meta) {
    this.data = { ...meta, id: Date.now().toString(36), started: new Date().toISOString(), events: [] };
    this.saveSoon = throttle(() => this.save(), 5000);
  }
  add(type, payload) {
    this.data.events.push({ t: Date.now(), type, ...payload });
    this.saveSoon(); // saved as the walk goes, so closing the page loses at most a few seconds
  }
  save() {
    const walks = read(WALKS, []);
    const i = walks.findIndex(w => w.id === this.data.id);
    if (i >= 0) walks[i] = this.data; else walks.push(this.data);
    if (!write(WALKS, walks)) write(WALKS, walks.slice(-5)); // storage full: keep the latest walks
  }
}

function throttle(fn, ms) {
  let timer = null;
  return () => { timer ??= setTimeout(() => { timer = null; fn(); }, ms); };
}

// Walks saved before ids existed are identified by their start time.
const walkId = w => w.id || w.started;

export function walksOf(profile) {
  return read(WALKS, []).filter(w => w.profile === profile)
    .map(w => ({ ...w, id: walkId(w) }))
    .sort((a, b) => b.started.localeCompare(a.started));
}

export function deleteWalk(id) {
  write(WALKS, read(WALKS, []).filter(w => walkId(w) !== id));
}

// The conversation as readable lines: transcript fragments merged per speaker turn.
export function transcriptOf(walk) {
  const lines = [];
  for (const e of walk.events) {
    if (e.type === 'phase') lines.push({ who: 'note', text: '— heading back —' });
    if (e.type !== 'say' || e.who === 'note') continue;
    const last = lines.at(-1);
    if (last && last.who === e.who) last.text += e.text; else lines.push({ who: e.who, text: e.text });
  }
  return lines.map(l => ({ ...l, text: l.text.trim() })).filter(l => l.text);
}

export function exportWalks() {
  const blob = new Blob([JSON.stringify({ profiles: read(KEY, {}), walks: read(WALKS, []) }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `local-walks-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}
