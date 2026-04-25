// background.js — Detoxify Service Worker
// All session logic lives here so it survives popup close.

const API_KEY = 'AIzaSyCTWd_OCu-rIyKJjilBtKxhKEBWs07iRV4';
const YOUTUBE_SEARCH_URL = 'https://www.googleapis.com/youtube/v3/search';

let sessionState = {
  running: false,
  stopRequested: false,
  currentTabId: null,
  progress: 0,
  label: '',
  logs: []
};

function pushLog(msg, type = 'default') {
  const now = new Date().toLocaleTimeString('en-GB');
  sessionState.logs.unshift({ time: now, msg, type });
  if (sessionState.logs.length > 30) sessionState.logs.pop();
  // Broadcast to popup if it's open
  chrome.runtime.sendMessage({ type: 'LOG', payload: { time: now, msg, type } }).catch(() => {});
}

function pushProgress(pct, label) {
  sessionState.progress = pct;
  sessionState.label    = label;
  chrome.runtime.sendMessage({ type: 'PROGRESS', payload: { pct, label } }).catch(() => {});
}

function pushStatus(status) {
  sessionState.running = status === 'running';
  chrome.runtime.sendMessage({ type: 'STATUS', payload: { status } }).catch(() => {});
}

async function fetchVideoIds(topic, count) {
  const fetchCount = Math.min(count + 3, 20);
  const params = new URLSearchParams({
    key: API_KEY,
    part: 'snippet',
    q: `${topic} tutorial`,
    type: 'video',
    maxResults: fetchCount,
    videoDuration: 'long',
    relevanceLanguage: 'en'
  });
  const res  = await fetch(`${YOUTUBE_SEARCH_URL}?${params}`);
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || 'YouTube API request failed');
  }
  const data = await res.json();
  return (data.items || [])
    .filter(i => i.id?.videoId)
    .map(i => i.id.videoId)
    .slice(0, count);
}

function openTab(videoId) {
  return new Promise(resolve => {
    chrome.tabs.create({ url: `https://www.youtube.com/watch?v=${videoId}`, active: false }, tab => resolve(tab.id));
  });
}

function closeTab(tabId) {
  return chrome.tabs.remove(tabId).catch(() => {});
}

// Use chrome.alarms for time-keeping so the service worker stays alive
function sleepAlarm(ms) {
  return new Promise(resolve => {
    const alarmName = 'detoxify-sleep-' + Date.now();
    chrome.alarms.create(alarmName, { delayInMinutes: ms / 60000 });
    const listener = (alarm) => {
      if (alarm.name === alarmName) {
        chrome.alarms.onAlarm.removeListener(listener);
        resolve();
      }
    };
    chrome.alarms.onAlarm.addListener(listener);
  });
}

// For short sleeps (< 1 min), alarms have 1min minimum, so we use offscreen keep-alive trick
// Instead we'll use a recursive setTimeout via keep-alive pings
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Keep service worker alive during the session by setting an alarm
function keepAlive() {
  chrome.alarms.create('detoxify-keepalive', { periodInMinutes: 0.4 });
}
function stopKeepAlive() {
  chrome.alarms.clear('detoxify-keepalive');
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'detoxify-keepalive') {
    // Just wakes the service worker up — no action needed
    console.log('[Detoxify] Keep-alive ping');
  }
});

async function runSession(topic, videoCount, watchPerVidSec) {
  const watchPerVidMs = watchPerVidSec * 1000;

  sessionState.stopRequested = false;
  sessionState.logs          = [];
  keepAlive();
  pushStatus('running');
  pushLog(`Session: ${videoCount} videos × ${watchPerVidSec}s each.`, 'info');
  pushProgress(0, 'Fetching video list...');

  try {
    pushLog(`Searching YouTube for "${topic}" videos...`, 'info');
    const videoIds = await fetchVideoIds(topic, videoCount);

    if (!videoIds.length) throw new Error('No videos found. Try a different topic.');
    pushLog(`Found ${videoIds.length} videos — starting session.`, 'success');

    for (let i = 0; i < videoIds.length; i++) {
      if (sessionState.stopRequested) break;

      const vidLabel = `Video ${i + 1} / ${videoIds.length}`;
      pushLog(`▶ ${vidLabel} — watching for ${watchPerVidSec}s...`);
      pushProgress((i / videoIds.length) * 100, vidLabel);

      const tabId = await openTab(videoIds[i]);
      sessionState.currentTabId = tabId;

      // Wait in 500ms chunks so abort is responsive AND service worker stays awake
      const chunk = 500;
      let elapsed = 0;
      while (elapsed < watchPerVidMs && !sessionState.stopRequested) {
        await sleep(chunk);
        elapsed += chunk;
        const innerPct = ((i + elapsed / watchPerVidMs) / videoIds.length) * 100;
        pushProgress(innerPct, `${vidLabel} — ${Math.round(elapsed / 1000)}s / ${watchPerVidSec}s`);
      }

      await closeTab(tabId);
      sessionState.currentTabId = null;
      pushLog(`✓ ${vidLabel} complete.`, 'success');
    }

    if (sessionState.stopRequested) {
      pushLog('Session aborted by user.', 'warn');
      pushProgress(sessionState.progress, 'Aborted.');
    } else {
      pushLog(`🎉 All ${videoIds.length} videos watched! Algorithm updated.`, 'success');
      pushProgress(100, `Done — ${videoIds.length} videos watched.`);
    }

  } catch (err) {
    pushLog(`ERROR: ${err.message}`, 'error');
    pushProgress(0, 'Session failed.');
  } finally {
    stopKeepAlive();
    pushStatus('idle');
  }
}

// ── Message handler from popup ────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'START') {
    const { topic, videoCount, watchPerVidSec } = message.payload;
    if (!sessionState.running) {
      runSession(topic, videoCount, watchPerVidSec);
    }
    sendResponse({ ok: true });
  }

  if (message.type === 'STOP') {
    sessionState.stopRequested = true;
    if (sessionState.currentTabId) {
      closeTab(sessionState.currentTabId);
      sessionState.currentTabId = null;
    }
    sendResponse({ ok: true });
  }

  if (message.type === 'GET_STATE') {
    sendResponse({ state: sessionState });
  }

  return true; // keep channel open for async
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Detoxify] Extension installed.');
});
