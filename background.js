let siteTimers = {};
let trackedDomains = ['youtube.com', 'netflix.com']; // defaults

chrome.storage.local.get(['siteTimers','trackedDomains'], (res) => {
    if (res.siteTimers) siteTimers = res.siteTimers;
    if (res.trackedDomains) trackedDomains = res.trackedDomains;
});

// --- SITE TRACKING LOGIC ---
function isDomainTracked(domain) {
    if (!domain) return false;
    return trackedDomains.includes(domain.replace('www.','').toLowerCase());
}
function saveSiteTimers() {
    chrome.storage.local.set({ siteTimers });
}
setInterval(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0] || !tabs[0].url) return;
        const url = new URL(tabs[0].url);
        const domain = url.hostname.replace('www.', '').toLowerCase();

        if (isDomainTracked(domain)) {
            if (!siteTimers[domain]) siteTimers[domain] = 0;
            siteTimers[domain]++;
            if (siteTimers[domain] % 5 === 0) saveSiteTimers();

            const limit = 30 * 60;
            if (siteTimers[domain] === limit) {
                chrome.scripting.executeScript({
                    target: { tabId: tabs[0].id },
                    func: (m) => alert(m),
                    args: [`Time limit reached for ${domain}`]
                });
            }
        }
    });
}, 1000);

// --- TIMER / ALARM FOUNDATION ---
chrome.runtime.onMessage.addListener((msg, _, sendResponse) => {
    if (!msg || !msg.action) return;

    if (msg.action === 'startSession') {
        const s = msg.session;
        const when = s.phaseStart + s.phaseDuration * 1000;
        chrome.alarms.create('phaseEnd', { when });
        chrome.storage.local.set({ session: s });
        sendResponse({ ok: true });
        return true;
    }
    if (msg.action === 'stopSession') {
        chrome.alarms.clear('phaseEnd');
        chrome.storage.local.set({ session: { running: false } });
        sendResponse({ ok: true });
        return true;
    }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== 'phaseEnd') return;
    chrome.storage.local.get('session', (res) => {
        const s = res.session;
        if (!s || !s.running) return;
        alertAllTabs('Timer phase ended!');
        // (You will later expand: switch phase, decrement cycles, etc.)
        chrome.storage.local.set({ session: { running: false } });
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
