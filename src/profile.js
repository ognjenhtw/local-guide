// Profiles, their personal landmarks, and walk logs, kept on the phone.
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

// --- Walk logs: what the research needs afterwards ---------------------------

export class WalkLog {
  constructor(meta) {
    this.data = { ...meta, started: new Date().toISOString(), events: [] };
  }
  add(type, payload) {
    this.data.events.push({ t: Date.now(), type, ...payload });
  }
  save() {
    const walks = read(WALKS, []);
    const i = walks.findIndex(w => w.started === this.data.started);
    if (i >= 0) walks[i] = this.data; else walks.push(this.data);
    if (!write(WALKS, walks)) write(WALKS, walks.slice(-5)); // storage full: keep the latest walks
  }
}

export function exportWalks() {
  const blob = new Blob([JSON.stringify({ profiles: read(KEY, {}), walks: read(WALKS, []) }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `local-walks-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
}
