// Session log: sends text events to main.py, which appends them to
// logs/latest.jsonl on this machine. Events only; never frames or audio.
const session = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const FLUSH_MS = 1000, MAX_BUFFERED = 1000, MAX_REPEATS = 3;
let buffer = [];
const seen = new Map();

export const sessionId = session;
export const round = (value, digits = 1) =>
  Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;

export function log(event, data = {}) {
  buffer.push(JSON.stringify({ t: new Date().toISOString(), ms: Math.round(performance.now()), session, event, ...data }));
  if (buffer.length > MAX_BUFFERED) buffer.splice(0, buffer.length - MAX_BUFFERED);
}

// Logs a repeating message only the first few times, so one noisy source cannot flood the file.
function logLimited(event, text, data = {}) {
  const count = (seen.get(text) || 0) + 1;
  seen.set(text, count);
  if (count <= MAX_REPEATS) log(event, { text, ...data, ...(count === MAX_REPEATS ? { note: 'further repeats suppressed' } : {}) });
}

export function logError(where, error) {
  logLimited('error', String(error?.message || error), { where, stack: String(error?.stack || '').split('\n').slice(0, 6).join(' | ') });
}

function flush(leaving = false) {
  if (!buffer.length) return;
  const body = buffer.join('\n') + '\n';
  buffer = [];
  if (leaving && navigator.sendBeacon) navigator.sendBeacon('/log', body);
  else fetch('/log', { method: 'POST', body, keepalive: true }).catch(() => { /* server stopped: drop */ });
}

setInterval(flush, FLUSH_MS);
addEventListener('pagehide', () => { log('page.hide'); flush(true); });
document.addEventListener('visibilitychange', () => log('page.visibility', { state: document.visibilityState }));
addEventListener('error', e => logError('window', e.error || e.message));
addEventListener('unhandledrejection', e => logError('promise', e.reason));

// Mirror console warnings and errors (MediaPipe and Three.js report problems there).
for (const level of ['warn', 'error']) {
  const original = console[level].bind(console);
  console[level] = (...args) => {
    original(...args);
    logLimited(`console.${level}`, args.map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ').slice(0, 500));
  };
}
