// --- TIMER FOUNDATION WITH BACKGROUND PERSISTENCE ---
let uiInterval = null;

document.getElementById('startStudy').addEventListener('click', () => {
    const minutes = parseInt(document.getElementById('studyMinutes').value);
    const breaks = parseInt(document.getElementById('breakMinutes').value);
    const cycles = parseInt(document.getElementById('cycles').value) || 1;

    if (isNaN(minutes) || minutes <= 0) {
        alert('Enter a valid study time.');
        return;
    }

    const session = {
        running: true,
        phase: 'study',
        phaseStart: Date.now(),
        phaseDuration: minutes * 60,
        studyDuration: minutes * 60,
        breakDuration: (isNaN(breaks) ? 0 : breaks) * 60,
        cyclesLeft: cycles
    };

    chrome.storage.local.set({ session }, () => {
        chrome.runtime.sendMessage({ action: 'startSession', session });
    });

    document.getElementById('status').innerText = `Timer started...`;
});

// --- SAVE DOMAIN PREFERENCES ---
document.getElementById('saveDomains').addEventListener('click', () => {
    const domains = [];
    if (document.getElementById('chk_youtube').checked) domains.push('youtube.com');
    if (document.getElementById('chk_netflix').checked) domains.push('netflix.com');

    const custom = document.getElementById('customDomains').value.trim();
    if (custom) {
        custom.split(',').map(s => s.trim()).forEach(d => domains.push(d));
    }

    chrome.storage.local.set({ trackedDomains: domains }, () => {
        alert('Saved site settings.');
    });
});

// --- RESTORE DOMAINS + SESSION ON POPUP OPEN ---
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['trackedDomains', 'session'], (res) => {
        const tracked = res.trackedDomains || [];
        document.getElementById('chk_youtube').checked = tracked.includes('youtube.com');
        document.getElementById('chk_netflix').checked = tracked.includes('netflix.com');
        document.getElementById('customDomains').value =
            tracked.filter(d => d !== 'youtube.com' && d !== 'netflix.com').join(', ');

        const session = res.session;
        if (!session || !session.running) {
            document.getElementById('status').innerText = 'Not running';
            return;
        }

        const now = Date.now();
        const phaseEnd = session.phaseStart + session.phaseDuration * 1000;
        let remaining = Math.max(0, Math.floor((phaseEnd - now) / 1000));
        document.getElementById('status').innerText =
            `${session.phase === 'study' ? 'Study' : 'Break'} • ${Math.floor(remaining/60)}:${(remaining%60).toString().padStart(2,'0')}`;

        if (uiInterval) clearInterval(uiInterval);
        uiInterval = setInterval(() => {
            chrome.storage.local.get('session', (r) => {
                const s = r.session;
                if (!s || !s.running) {
                    document.getElementById('status').innerText = 'Not running';
                    clearInterval(uiInterval);
                    return;
                }
                const now2 = Date.now();
                const end = s.phaseStart + s.phaseDuration * 1000;
                let rem = Math.max(0, Math.floor((end - now2) / 1000));
                document.getElementById('status').innerText =
                    `${s.phase === 'study' ? 'Study' : 'Break'} • ${Math.floor(rem/60)}:${(rem%60).toString().padStart(2,'0')}`;
            });
        }, 1000);
    });
});
