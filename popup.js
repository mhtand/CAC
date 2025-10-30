// --- TIMER + SESSION-SCOPED SITE SELECTION ---
let uiInterval = null;

function populateSiteDropdown(userSites) {
    const select = document.getElementById('sessionSiteSelect');
    select.innerHTML = '';
    (userSites || []).forEach(site => {
        const opt = document.createElement('option');
        opt.value = site;
        opt.textContent = site;
        select.appendChild(opt);
    });
    enableSimpleMultiSelect(select);
}

function getSelectedSites() {
    const sel = document.getElementById('sessionSiteSelect');
    return Array.from(sel.selectedOptions).map(o => o.value);
}

document.getElementById('addSiteBtn').addEventListener('click', () => {
    const input = document.getElementById('newSiteInput');
    let value = (input.value || '').trim().toLowerCase();
    if (!value) return;
    // normalize
    value = value.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    chrome.storage.local.get(['userSites'], (res) => {
        const set = new Set(res.userSites || []);
        set.add(value);
        const userSites = Array.from(set).sort();
        chrome.storage.local.set({ userSites }, () => {
            populateSiteDropdown(userSites);
            input.value = '';
        });
    });
});

document.getElementById('startStudy').addEventListener('click', () => {
    const minutes = parseInt(document.getElementById('studyMinutes').value);
    const breaks = parseInt(document.getElementById('breakMinutes').value);
    const cycles = parseInt(document.getElementById('cycles').value) || 1;
    const selectedSites = getSelectedSites();

    if (isNaN(minutes) || minutes <= 0) {
        alert('Enter a valid study time.');
        return;
    }
    if (!selectedSites.length) {
        if (!confirm('No sites selected to block. Start anyway?')) return;
    }

    const session = {
        running: true,
        phase: 'study',
        phaseStart: Date.now(),
        phaseDuration: minutes * 60,
        studyDuration: minutes * 60,
        breakDuration: (isNaN(breaks) ? 0 : breaks) * 60,
        cyclesLeft: cycles,
        blockedDomains: selectedSites
    };

    chrome.storage.local.set({ session }, () => {
        chrome.runtime.sendMessage({ action: 'startSession', session });
    });

    document.getElementById('status').innerText = `Timer started...`;
});

document.getElementById('stopSession').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'stopSession' }, () => {
        chrome.storage.local.set({ session: { running: false } }, () => {
            // Clear selection so user must select again next session
            const sel = document.getElementById('sessionSiteSelect');
            Array.from(sel.options).forEach(o => (o.selected = false));
            document.getElementById('status').innerText = 'Not running';
        });
    });
});

// --- INIT ON POPUP OPEN ---
document.addEventListener('DOMContentLoaded', () => {
    chrome.storage.local.get(['userSites', 'session'], (res) => {
        populateSiteDropdown(res.userSites || []);

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

// Allow multi-select with simple clicks (no Ctrl/Cmd)
function enableSimpleMultiSelect(selectEl) {
    if (!selectEl || selectEl._simpleMultiEnabled) return;
    selectEl.addEventListener('mousedown', function (e) {
        if (e.target && e.target.tagName === 'OPTION') {
            e.preventDefault();
            const option = e.target;
            option.selected = !option.selected;
        }
    });
    selectEl._simpleMultiEnabled = true;
}
