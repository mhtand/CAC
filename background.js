// --- SESSION-SCOPED BLOCKING DURING STUDY PHASE ---
function getHostname(href) {
    try {
        const u = new URL(href);
        return u.hostname.replace('www.', '').toLowerCase();
    } catch (e) {
        return '';
    }
}

function shouldBlockUrl(href, session) {
    if (!href || !session || !session.running) return false;
    if (session.phase !== 'study') return false;
    if (!Array.isArray(session.blockedDomains) || session.blockedDomains.length === 0) return false;
    // ignore internal pages
    if (href.startsWith('chrome://') || href.startsWith('chrome-extension://') || href.startsWith('edge://') || href.startsWith('about:') || href.startsWith('data:')) return false;
    const host = getHostname(href);
    return session.blockedDomains.some(d => {
        const dom = String(d || '').toLowerCase();
        if (!dom) return false;
        return host === dom || host.endsWith('.' + dom);
    });
}

function redirectToBlocked(tabId, blockedHost) {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Site Blocked</title><style>body{font-family:Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#111;color:#fff} .card{background:#1f1f1f;padding:24px;border-radius:12px;max-width:520px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.4)} h1{margin:0 0 8px;font-size:22px} p{margin:0 0 16px;color:#ddd} a{color:#61dafb}</style></head><body><div class="card"><h1>Blocked during study</h1><p>${blockedHost} is blocked for the current study session.</p><p>Use the extension popup to stop the session or wait for a break.</p><p><a href="about:blank">Go back</a></p></div></body></html>`;
    const dataUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
    chrome.tabs.update(tabId, { url: dataUrl });
}

function enforceBlockingOnTab(tab) {
    if (!tab || !tab.id || !tab.url) return;
    chrome.storage.local.get('session', (res) => {
        const s = res.session;
        if (shouldBlockUrl(tab.url, s)) {
            const host = getHostname(tab.url);
            maybeAlertOnTab(tab.id, host);
        }
    });
}

function enforceBlockingAcrossAllTabs() {
    chrome.tabs.query({}, (tabs) => {
        for (const t of tabs) enforceBlockingOnTab(t);
    });
}

// --- Alert (no blocking) with cooldown to prevent spam ---
const alertCooldownMs = 20000; // 20s per tab+host
const lastAlertByTabHost = {};

function maybeAlertOnTab(tabId, host) {
    const key = `${tabId}::${host}`;
    const now = Date.now();
    const last = lastAlertByTabHost[key] || 0;
    if (now - last < alertCooldownMs) return;
    lastAlertByTabHost[key] = now;
    chrome.scripting.executeScript({
        target: { tabId },
        func: (message) => {
            try { alert(message); } catch (e) {}
        },
        args: ["You shouldn't be on this site right now..."]
    }).catch(() => {});
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (!tab) return;
    if (changeInfo.url || changeInfo.status === 'loading' || changeInfo.status === 'complete') {
        enforceBlockingOnTab(tab);
    }
});

chrome.tabs.onActivated.addListener((activeInfo) => {
    chrome.tabs.get(activeInfo.tabId, (tab) => enforceBlockingOnTab(tab));
});

// --- TIMER / ALARM FOUNDATION ---
chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (!msg || !msg.action) return;

    if (msg.action === 'startSession') {
        const s = msg.session;
        const when = s.phaseStart + s.phaseDuration * 1000;
        chrome.alarms.create('phaseEnd', { when });
        chrome.storage.local.set({ session: s }, () => {
            // Enforce immediately on all open tabs
            chrome.tabs.query({}, (tabs) => {
                for (const t of tabs) enforceBlockingOnTab(t);
            });
        });
        sendResponse({ ok: true });
        return true;
    }
    if (msg.action === 'stopSession') {
        chrome.alarms.clear('phaseEnd');
        chrome.storage.local.set({ session: { running: false } }, () => {});
        sendResponse({ ok: true });
        return true;
    }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'phaseEnd') return;
    chrome.storage.local.get('session', (res) => {
        const s = res.session;
        if (!s || !s.running) return;

        const now = Date.now();
        const cyclesLeft = typeof s.cyclesLeft === 'number' ? s.cyclesLeft : 1;

        if (s.phase === 'study') {
            if ((s.breakDuration || 0) > 0) {
                // Switch to break
                const next = {
                    ...s,
                    phase: 'break',
                    phaseStart: now,
                    phaseDuration: s.breakDuration
                };
                chrome.storage.local.set({ session: next }, () => {
                    chrome.alarms.create('phaseEnd', { when: next.phaseStart + next.phaseDuration * 1000 });
                    alertAllTabs('Study phase ended. Break started.');
                    // During break, alerts naturally won't fire due to phase check.
                });
            } else {
                // No break: count cycle complete and either start next study or stop
                const nextCycles = Math.max(0, cyclesLeft - 1);
                if (nextCycles > 0) {
                    const next = {
                        ...s,
                        phase: 'study',
                        phaseStart: now,
                        phaseDuration: s.studyDuration,
                        cyclesLeft: nextCycles
                    };
                    chrome.storage.local.set({ session: next }, () => {
                        chrome.alarms.create('phaseEnd', { when: next.phaseStart + next.phaseDuration * 1000 });
                        alertAllTabs('Study phase ended. Next study cycle started.');
                        enforceBlockingAcrossAllTabs();
                    });
                } else {
                    chrome.storage.local.set({ session: { running: false } }, () => {
                        alertAllTabs('Session completed.');
                    });
                }
            }
        } else if (s.phase === 'break') {
            const nextCycles = Math.max(0, cyclesLeft - 1);
            if (nextCycles > 0) {
                const next = {
                    ...s,
                    phase: 'study',
                    phaseStart: now,
                    phaseDuration: s.studyDuration,
                    cyclesLeft: nextCycles
                };
                chrome.storage.local.set({ session: next }, () => {
                    chrome.alarms.create('phaseEnd', { when: next.phaseStart + next.phaseDuration * 1000 });
                    alertAllTabs('Break ended. Study started.');
                    enforceBlockingAcrossAllTabs();
                });
            } else {
                chrome.storage.local.set({ session: { running: false } }, () => {
                    alertAllTabs('Session completed.');
                });
            }
        }
    });
});

function alertAllTabs(message) {
    chrome.tabs.query({}, (tabs) => {
        for (const t of tabs) {
            chrome.scripting.executeScript({
                target: { tabId: t.id },
                func: (m) => alert(m),
                args: [message]
            }).catch(()=>{});
        }
    });
}
