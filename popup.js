// popup.js — UI only. All session logic runs in background.js.

const detoxBtn      = document.getElementById('detoxBtn');
const stopBtn       = document.getElementById('stopBtn');
const topicInput    = document.getElementById('topicInput');
const videoCountEl  = document.getElementById('videoCount');
const watchDurEl    = document.getElementById('watchDuration');
const totalCalcEl   = document.getElementById('totalCalc');
const logBox        = document.getElementById('logBox');
const ytBadge       = document.getElementById('ytBadge');
const badgeText     = document.getElementById('badgeText');
const progressWrap  = document.getElementById('progressWrap');
const progressFill  = document.getElementById('progressFill');
const progressLbl   = document.getElementById('progressLabel');
const progressPct   = document.getElementById('progressPct');

// ── Live session calculator ───────────────────────────────
function updateTotalCalc() {
  const count    = parseInt(videoCountEl.value) || 0;
  const perVid   = parseInt(watchDurEl.value)   || 0;
  const totalSec = count * perVid;
  const mins     = Math.floor(totalSec / 60);
  const secs     = totalSec % 60;
  totalCalcEl.textContent = mins > 0
    ? `Total session: ~${mins}m ${secs > 0 ? secs + 's' : ''}`
    : `Total session: ~${totalSec}s`;
}
videoCountEl.addEventListener('input', updateTotalCalc);
watchDurEl.addEventListener('input',   updateTotalCalc);
updateTotalCalc();

// ── Log renderer ──────────────────────────────────────────
function renderLog(time, msg, type = 'default') {
  const line = document.createElement('div');
  line.className = 'log-line';
  line.innerHTML = `<span class="log-time">${time}</span><span class="log-msg ${type}">${msg}</span>`;
  logBox.prepend(line);
  while (logBox.children.length > 25) logBox.removeChild(logBox.lastChild);
}

// ── Progress update ───────────────────────────────────────
function setProgress(pct, label) {
  progressFill.style.width = pct + '%';
  progressPct.textContent  = Math.round(pct) + '%';
  progressLbl.textContent  = label;
}

// ── Sync UI with background state ────────────────────────
function syncState(state) {
  const running = state.running;

  detoxBtn.disabled = running;
  detoxBtn.classList.toggle('running', running);
  detoxBtn.querySelector('span').textContent = running ? '⏳ RUNNING...' : '⚡ INITIATE DETOX';
  stopBtn.classList.toggle('visible', running);
  progressWrap.classList.toggle('visible', running || state.progress > 0);

  setProgress(state.progress || 0, state.label || '');

  // Replay logs into UI
  logBox.innerHTML = '';
  const logs = (state.logs || []).slice().reverse(); // oldest first for prepend
  logs.reverse().forEach(l => renderLog(l.time, l.msg, l.type));
}

// ── YouTube session check ─────────────────────────────────
async function checkYouTubeSession() {
  try {
    const cookie = await chrome.cookies.get({ url: 'https://www.youtube.com', name: 'SID' });
    if (cookie?.value) {
      ytBadge.className     = 'badge connected';
      badgeText.textContent = 'YouTube session active';
    } else {
      ytBadge.className     = 'badge disconnected';
      badgeText.textContent = 'Not logged into YouTube';
      detoxBtn.disabled     = true;
    }
  } catch (e) {
    ytBadge.className     = 'badge disconnected';
    badgeText.textContent = 'Cookie check failed';
    detoxBtn.disabled     = true;
  }
}

// ── Listen for live updates from background ───────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'LOG') {
    const { time, msg, type } = message.payload;
    renderLog(time, msg, type);
  }
  if (message.type === 'PROGRESS') {
    const { pct, label } = message.payload;
    setProgress(pct, label);
    progressWrap.classList.add('visible');
  }
  if (message.type === 'STATUS') {
    const running = message.payload.status === 'running';
    detoxBtn.disabled = running;
    detoxBtn.classList.toggle('running', running);
    detoxBtn.querySelector('span').textContent = running ? '⏳ RUNNING...' : '⚡ INITIATE DETOX';
    stopBtn.classList.toggle('visible', running);
  }
});

// ── Button handlers ───────────────────────────────────────
detoxBtn.addEventListener('click', () => {
  const topic        = topicInput.value.trim();
  const videoCount   = Math.max(1, Math.min(20, parseInt(videoCountEl.value) || 5));
  const watchPerVidSec = Math.max(5, Math.min(300, parseInt(watchDurEl.value) || 30));

  if (!topic) { renderLog(new Date().toLocaleTimeString('en-GB'), 'Please enter a topic.', 'warn'); return; }

  chrome.runtime.sendMessage({
    type: 'START',
    payload: { topic, videoCount, watchPerVidSec }
  });
});

stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'STOP' });
  stopBtn.disabled    = true;
  stopBtn.textContent = 'Aborting...';
  setTimeout(() => {
    stopBtn.disabled    = false;
    stopBtn.textContent = '■ ABORT SESSION';
  }, 2000);
});

// ── Init: restore state if session is already running ─────
chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
  if (response?.state) syncState(response.state);
});

checkYouTubeSession();
