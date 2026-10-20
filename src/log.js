// On-screen log: there are no Safari developer tools on the iPhone without a Mac.
const el = () => document.getElementById('log');

export function log(...parts) {
  const line = `${new Date().toLocaleTimeString()}  ${parts.map(p => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}`;
  console.log(line);
  const pre = el();
  if (pre) pre.textContent = `${line}\n${pre.textContent}`.slice(0, 20000);
}

window.addEventListener('error', e => log('ERROR', e.message));
window.addEventListener('unhandledrejection', e => log('ERROR', String(e.reason)));
