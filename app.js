// Version: 1.1.1
// ===== FIREBASE CONFIGURATION =====
// Wklej tutaj swój obiekt konfiguracji Firebase z konsoli Firebase
const firebaseConfig = {
    apiKey: "AIzaSyDyZcEpL_OD0s_gQUjZk2qRAQuyxiVm7d0",
    authDomain: "vanstev-app.firebaseapp.com",
    projectId: "vanstev-app",
    storageBucket: "vanstev-app.firebasestorage.app",
    messagingSenderId: "914077920403",
    appId: "1:914077920403:web:8ea9134b39024cf65df166"
};

// Inicjalizacja Firebase (Compat)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// ===== DATA =====
let locations = [];
let deletedLocations = [];
let pendingLat = null, pendingLng = null;
let editLat = null, editLng = null;
let map, markers = {};
let editingId = null;
let locToDelete = null;
let currentUser = null;
let eurToPln = 4.3; // Default fallback rate
let addingType = 'location'; // 'location' or 'project'
let activeProjectId = null;
let activeQuarterId = null;
let currentAddSelectedIds = [];
let currentEditSelectedIds = [];
let roadDistances = {}; // Cache for road distances

// Notes System State
let notes = [];
let notesUnsub = null;
let currentAdminTab = 'users';

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Section collapse state
let isProjectsCollapsed = true;
let isQuartersCollapsed = true;
let isOfficesCollapsed = true;

// ===== LOGIN =====
const USER_PASSWORDS = {
    'admin': '750ee58c151661747a47476a661c5f3e3c236cf42f4856e56cb8ad595f7bd374',
    'radek': '82cfe82688b0ef2bc5cd88854e1a3d4b627f79d878cc3fd119e33f7e4448f7b5',
    'szymon': '72950ec1858c1d95000953c35ea95f0884df163be120bd85ebb0f8d46d112cf5',
    'kasia': 'f4dffa41bf4265d1f4abd393c189fb4daa2f683d4bb6e466825aba503f39635c',
    'tomek': '4b83834397c4a635e2863ab2acfcf80988be1dc06f8668bace9d163be4836276',
    'przemek': '9fe44b2b25fc98b9b8caf76b72fbdae3417102aaa4e2a71e6234fcb1f6f07e91',
    'mirek': '78133133a699cf3e0a5117a2f2f53ec5c4e5088250d9fe53059ac9a47b290acc',
    'dominik': 'a7b84e257f645a915b35f908c39a96787811ac047a688d7e1cb0fc14d73f68f8'
};

async function hashPassword(password) {
    const msgUint8 = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function doLogin() {
    const user = document.getElementById('loginEmail').value.trim().toLowerCase();
    const pass = document.getElementById('loginPass').value.trim();
    const err = document.getElementById('loginErr');

    let isAuthorized = false;
    if (USER_PASSWORDS[user]) {
        const hashedPass = await hashPassword(pass);
        if (USER_PASSWORDS[user] === hashedPass) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
        err.style.display = 'block';
        return;
    }
    const userName = user.charAt(0).toUpperCase() + user.slice(1);
    sessionStorage.setItem('vs_user', userName);
    localStorage.setItem('vs_saved_login', user);
    localStorage.setItem('vs_saved_pass', pass);
    
    // Resetuj status wymuszonego wylogowania przy nowym logowaniu
    db.collection('users').doc(userName).set({ forceLogout: false }, { merge: true });
    
    document.getElementById('loginScreen').style.display = 'none';
    const loader = document.getElementById('loadingScreen');
    loader.style.display = 'flex';
    document.getElementById('loadingGreeting').textContent = `Hej ${userName}`;
    
    // Start animations
    setTimeout(() => {
        loader.style.opacity = '1';
        document.getElementById('loadingGreeting').style.opacity = '1';
        document.getElementById('loadingGreeting').style.transform = 'translateY(0)';
        document.getElementById('loadingSubtitle').style.opacity = '1';
        document.getElementById('loadingSubtitle').style.transform = 'translateY(0)';
        document.getElementById('loadingBarWrap').style.opacity = '1';
        document.getElementById('loadingBarWrap').style.transform = 'translateY(0)';
        
        setTimeout(() => {
            document.getElementById('loadingBar').style.width = '100%';
        }, 100);
    }, 50);

    setTimeout(() => {
        loader.style.opacity = '0';
        setTimeout(() => {
            loader.style.display = 'none';
            setupApp(userName);
        }, 800);
    }, 7000);
}

function setupApp(userName) {
    currentUser = userName;
    document.getElementById('loginErr').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    document.getElementById('tbUserEmail').textContent = currentUser;
    if (currentUser === 'Admin') {
        document.getElementById('adminBtn').style.display = 'block';
    } else {
        document.getElementById('adminBtn').style.display = 'none';
    }

    // Monitoruj czy Admin wymusił wylogowanie
    if (window.vsLogoutMonitor) window.vsLogoutMonitor();
    window.vsLogoutMonitor = db.collection('users').doc(currentUser).onSnapshot(doc => {
        const data = doc.data();
        if (data && data.forceLogout === true) {
            console.log("Zdalne wylogowanie wymuszone przez Admina.");
            doLogout();
        }
    });

    // Aktualizuj status użytkownika
    const userRef = db.collection('users').doc(currentUser);
    userRef.set({
        lastLogin: firebase.firestore.FieldValue.serverTimestamp(),
        lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
        online: true
    }, { merge: true });

    // Heartbeat - co 5 minut aktualizuj lastSeen, by Admin widział czy ktoś nadal siedzi
    if (window.vsHeartbeat) clearInterval(window.vsHeartbeat);
    window.vsHeartbeat = setInterval(() => {
        if (currentUser) {
            db.collection('users').doc(currentUser).update({
                lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                online: true
            });
        }
    }, 5 * 60 * 1000);

    logActivity('Zalogowano', 'System');

    initMap();
    initDataSync();
    initNotesSync();
    initCertificatesSync();
    renderStats();
    fetchExchangeRate();
}

async function fetchExchangeRate() {
    try {
        const response = await fetch('https://api.nbp.pl/api/exchangerates/rates/a/eur/?format=json');
        const data = await response.json();
        if (data && data.rates && data.rates[0].mid) {
            eurToPln = data.rates[0].mid;
            renderStats(); // Re-render with new rate
        }
    } catch (err) {
        console.warn("Nie udało się pobrać kursu walut:", err);
    }
}

// Obsługa wylogowania przy zamknięciu karty
window.addEventListener('beforeunload', () => {
    if (currentUser) {
        // Używamy sendBeacon lub synchronicznego XHR jeśli to możliwe, 
        // ale w Firebase najlepiej po prostu zaktualizować status przy ponownym wejściu
        db.collection('users').doc(currentUser).set({ online: false }, { merge: true });
    }
});

document.getElementById('loginPass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('loginEmail')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

function doLogout() {
    if (currentUser) {
        logActivity('Wylogowano', 'Przez użytkownika');
        db.collection('users').doc(currentUser).set({
            online: false,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
    }
    if (window.vsHeartbeat) clearInterval(window.vsHeartbeat);
    if (window.vsLogoutMonitor && typeof window.vsLogoutMonitor === 'function') {
        window.vsLogoutMonitor();
        window.vsLogoutMonitor = null;
    }
    if (notesUnsub) {
        notesUnsub();
        notesUnsub = null;
    }
    sessionStorage.removeItem('vs_user');
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    
    const savedLogin = localStorage.getItem('vs_saved_login');
    const savedPass = localStorage.getItem('vs_saved_pass');
    if (savedLogin && savedPass) {
        document.getElementById('loginEmail').value = savedLogin;
        document.getElementById('loginPass').value = savedPass;
    } else {
        document.getElementById('loginEmail').value = '';
        document.getElementById('loginPass').value = '';
    }
}

// ===== THEME =====
function toggleTheme() {
    const isLight = document.body.classList.toggle('light-mode');
    localStorage.setItem('vs_theme', isLight ? 'light' : 'dark');
    updateThemeUI();
    updateMapTheme();
}

function updateThemeUI() {
    const isLight = document.body.classList.contains('light-mode');
    const btn = document.getElementById('themeToggle');
    if (btn) {
        btn.innerHTML = isLight ? '☀️ Tryb Jasny' : '🌙 Tryb Ciemny';
    }
}

let layersControl = null;
let googleRoadmap, googleSatellite, standardLayer;

function updateMapTheme() {
    if (!map) return;
    const isLight = document.body.classList.contains('light-mode');
    
    if (!googleRoadmap) {
        googleRoadmap = L.tileLayer('http://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            maxZoom: 20,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            attribution: '&copy; Google'
        });
        googleSatellite = L.tileLayer('http://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
            maxZoom: 20,
            subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
            attribution: '&copy; Google'
        });
    }

    const url = isLight
        ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    if (standardLayer) {
        standardLayer.setUrl(url);
    } else {
        standardLayer = L.tileLayer(url, {
            attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
            subdomains: 'abcd', maxZoom: 19
        });
    }

    if (!layersControl) {
        const baseMaps = {
            "Standardowy": standardLayer,
            "Google Mapa": googleRoadmap,
            "Google Satelita": googleSatellite
        };
        googleSatellite.addTo(map);
        layersControl = L.control.layers(baseMaps).addTo(map);
    }
}

// Apply theme on load
if (localStorage.getItem('vs_theme') === 'light') {
    document.body.classList.add('light-mode');
}

// Apply session on load
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = sessionStorage.getItem('vs_user');
    if (savedUser) {
        setupApp(savedUser);
    } else {
        const savedLogin = localStorage.getItem('vs_saved_login');
        const savedPass = localStorage.getItem('vs_saved_pass');
        if (savedLogin && savedPass) {
            document.getElementById('loginEmail').value = savedLogin;
            document.getElementById('loginPass').value = savedPass;
        }
    }
    setupInactivityTimeout();
});

let inactivityTimer;
function resetInactivityTimeout() {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        if (currentUser) {
            console.log("Wylogowanie z powodu nieaktywności (30 min)");
            doLogout();
        }
    }, 30 * 60 * 1000); // 30 minutes
}
function setupInactivityTimeout() {
    ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'].forEach(evt => 
        document.addEventListener(evt, resetInactivityTimeout, true)
    );
    resetInactivityTimeout();
}

// ===== MAP =====
function initMap() {
    if (map) return;
    map = L.map('map', { center: [52.5, 5.0], zoom: 7, zoomControl: true });
    updateMapTheme();
    updateThemeUI();
    map.on('click', onMapClick);
    map.on('zoomend', updateProjectIcons);
    reloadMarkers();

    setTimeout(() => {
        const leftControls = document.querySelector('.map-left-controls');
        if (leftControls && window.L) {
            L.DomEvent.disableClickPropagation(leftControls);
            L.DomEvent.disableScrollPropagation(leftControls);
        }
    }, 150);
}

let tempMarker = null;

function onMapClick(e) {
    // If the click originated from any map UI controls or modals, ignore it completely
    if (e.originalEvent && e.originalEvent.target) {
        if (e.originalEvent.target.closest('.map-left-controls, .map-notes-wrap, .notes-popover, .notes-circle-btn, .map-legend, .modal-box, .modal-overlay')) {
            return;
        }
    }

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    if (editingId) {
        editLat = lat; editLng = lng;
        if (tempMarker) map.removeLayer(tempMarker);
        tempMarker = L.marker([lat, lng], { icon: makeTempIcon(), draggable: false }).addTo(map);

        document.getElementById('eCoordDisplay').style.display = 'block';
        document.getElementById('eCoordTxt').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
        fillAddressFields('edit', lat, lng);
        return;
    }

    pendingLat = lat; pendingLng = lng;
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker([lat, lng], { icon: makeTempIcon(), draggable: false }).addTo(map);

    document.getElementById('typeModal').style.display = 'flex';
}

function selectAddMode(type) {
    document.getElementById('typeModal').style.display = 'none';
    setAddModeUI(type);
    document.getElementById('coordDisplay').style.display = 'block';
    document.getElementById('coordTxt').textContent = pendingLat.toFixed(5) + ', ' + pendingLng.toFixed(5);
    fillAddressFields('add', pendingLat, pendingLng);
    switchTab('add');
}

function closeTypeModal() {
    document.getElementById('typeModal').style.display = 'none';
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
    pendingLat = null; pendingLng = null;
}

function setAddModeUI(type) {
    addingType = type;
    const isLoc = type === 'location';
    document.getElementById('modeLocBtn').className = isLoc ? 'active' : '';
    document.getElementById('modeLocBtn').style.background = isLoc ? 'var(--accent)' : 'transparent';
    document.getElementById('modeLocBtn').style.color = isLoc ? '#fff' : 'var(--muted)';

    document.getElementById('modeProjBtn').className = !isLoc ? 'active' : '';
    document.getElementById('modeProjBtn').style.background = !isLoc ? 'var(--accent)' : 'transparent';
    document.getElementById('modeProjBtn').style.color = !isLoc ? '#fff' : 'var(--muted)';

    document.getElementById('locSpecificFields').style.display = isLoc ? 'block' : 'none';
    document.getElementById('projSpecificFields').style.display = !isLoc ? 'block' : 'none';

    document.getElementById('addFormTitleText').textContent = isLoc ? 'Dodaj lokalizację' : 'Dodaj projekt';

    if (!isLoc) {
        if (type === 'project') {
            document.getElementById('fProjOccSearch').value = '';
            currentAddSelectedIds = [];
        }
        renderLinkedLocations('fLinkedLocations', []);
    }
}

function renderLinkedLocations(containerId, selectedIds, filterQuery = '') {
    const c = document.getElementById(containerId);
    if (!c) return;
    const q = filterQuery.toLowerCase().trim();

    const locs = locations.filter(l => {
        if (l.isArchived) return false;
        if (l.type === 'project') return false;
        if (!q) return true;

        // Match location name
        if (l.name.toLowerCase().includes(q)) return true;

        // Match occupants
        if (l.people && l.people.some(p => {
            const name = typeof p === 'string' ? p : p.name;
            return name.toLowerCase().includes(q);
        })) return true;

        return false;
    }).sort((a, b) => (a.locNumber || 0) - (b.locNumber || 0));

    if (locs.length === 0) {
        c.innerHTML = `<span style="color:var(--muted); padding:10px; font-style:italic;">${q ? 'Nie znaleziono pasujących lokalizacji' : 'Brak dostępnych lokalizacji'}</span>`;
        return;
    }

    const formatOccupant = (p) => {
        if (typeof p === 'string') return `<span style="display:inline-block; border:1px solid var(--border); background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; margin:1px;">${p}</span>`;
        const driverIcon = p.isDriver ? ' 🚗' : '';
        const plate = p.isDriver && p.carPlate ? ` (${p.carPlate})` : '';
        const car = p.isDriver && p.carDesc ? ` (${p.carDesc})` : '';
        const vDays = getVacationDaysLeft(p.vacationEnd);
        const sDays = getSickLeaveDaysLeft(p.sickLeaveEnd);
        let statusText = '';
        if (vDays > 0) {
            statusText = ` 🌴 (${vDays}d)`;
        } else if (sDays > 0) {
            statusText = ` 🏥 (${sDays}d)`;
        }
        return `<span style="display:inline-block; border:1px solid var(--border); background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; margin:1px;">${p.name}${driverIcon}${plate}${car}${statusText}</span>`;
    };

    c.innerHTML = locs.map(l => {
        const isChecked = selectedIds.includes(l.id) ? 'checked' : '';
        const occupants = l.people && l.people.length > 0
            ? l.people.map(p => formatOccupant(p)).join('')
            : '<span style="color:var(--muted); font-style:italic;">brak mieszkańców</span>';

        return `<label class="linked-loc-item ${isChecked ? 'highlighted' : ''}" style="display:flex; flex-direction:column; gap:6px; cursor:pointer; padding:10px; border-radius:10px; border:1px solid transparent; transition: all 0.2s; margin-bottom:6px; background: var(--bg);">
            <div style="display:flex; align-items:center; gap:8px;">
                <input type="checkbox" value="${l.id}" ${isChecked} class="linked-loc-cb" onchange="toggleLinkedLocationHighlight(this, '${l.id}')" style="width:18px; height:18px; margin:0; cursor:pointer;">
                <span style="font-weight:700; font-size:14px;"><span style="color:var(--accent);">[#${l.locNumber || '?'}]</span> ${l.name}</span>
                <span style="font-size:10px; color:var(--muted); margin-left:auto; background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:20px;">👥 ${l.people ? l.people.length : 0}/${l.capacity}</span>
            </div>
            <div style="font-size:11px; color:var(--muted); padding-left:26px; display:flex; flex-wrap:wrap; gap:2px;">${occupants}</div>
        </label>`;
    }).join('');
}

function triggerLinkedLocSearch(mode) {
    if (mode === 'add') {
        const q = document.getElementById('fProjOccSearch').value;
        renderLinkedLocations('fLinkedLocations', currentAddSelectedIds, q);
    } else {
        const q = document.getElementById('eProjOccSearch').value;
        renderLinkedLocations('eLinkedLocations', currentEditSelectedIds, q);
    }
}

function toggleLinkedLocationHighlight(checkbox, locId) {
    const mode = checkbox.closest('#fLinkedLocations') ? 'add' : 'edit';
    const label = checkbox.closest('.linked-loc-item');

    if (checkbox.checked) {
        label.classList.add('highlighted');
        if (mode === 'add') {
            if (!currentAddSelectedIds.includes(locId)) currentAddSelectedIds.push(locId);
        } else {
            if (!currentEditSelectedIds.includes(locId)) currentEditSelectedIds.push(locId);
        }
    } else {
        label.classList.remove('highlighted');
        if (mode === 'add') {
            currentAddSelectedIds = currentAddSelectedIds.filter(id => id !== locId);
        } else {
            currentEditSelectedIds = currentEditSelectedIds.filter(id => id !== locId);
        }
    }
    updateMarkerHighlight(locId, checkbox.checked);
}

function updateMarkerHighlight(locId, isHighlighted) {
    const marker = markers[locId];
    if (!marker) return;
    const loc = locations.find(l => l.id === locId);
    if (!loc) return;
 
    if (isHighlighted) {
        // Highlighted icon (Gold/Yellow)
        marker.setIcon(makeIcon('#fbbf24'));
        marker.setZIndexOffset(1000);
    } else {
        // Back to normal
        const color = getMarkerColor(loc);
        marker.setIcon(makeIcon(color));
        marker.setZIndexOffset(0);
    }
}

function clearAllMarkerHighlights() {
    locations.forEach(l => {
        if (l.type !== 'project') updateMarkerHighlight(l.id, false);
    });
}

function getSelectedLinkedLocations() {
    return currentAddSelectedIds;
}

function getEditSelectedLinkedLocations() {
    return currentEditSelectedIds;
}

function fillAddressFields(mode, lat, lng) {
    const prefix = mode === 'add' ? 'f' : 'e';
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&accept-language=pl`)
        .then(r => r.json())
        .then(data => {
            const a = data.address || {};
            document.getElementById(prefix + 'Zip').value = a.postcode || '';
            document.getElementById(prefix + 'City').value = a.city || a.town || a.village || '';
            document.getElementById(prefix + 'Street').value = a.road || a.pedestrian || '';
            document.getElementById(prefix + 'HouseNum').value = a.house_number || '';
        })
        .catch(() => {
            console.error("Błąd pobierania adresu");
        });
}

function onTempMarkerDrag(e) {
    const latlng = e.target.getLatLng();
    const lat = latlng.lat;
    const lng = latlng.lng;

    if (editingId) {
        editLat = lat; editLng = lng;
        document.getElementById('eCoordDisplay').style.display = 'block';
        document.getElementById('eCoordTxt').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
        fillAddressFields('edit', lat, lng);
    } else {
        pendingLat = lat; pendingLng = lng;
        document.getElementById('coordDisplay').style.display = 'block';
        document.getElementById('coordTxt').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
        fillAddressFields('add', lat, lng);
    }
}

function geocodeManual(mode) {
    const prefix = mode === 'add' ? 'f' : 'e';
    const zip = document.getElementById(prefix + 'Zip').value.trim();
    const city = document.getElementById(prefix + 'City').value.trim();
    const street = document.getElementById(prefix + 'Street').value.trim();
    const num = document.getElementById(prefix + 'HouseNum').value.trim();

    const query = `${street} ${num}, ${zip} ${city}`.trim();
    if (query.length < 5) return;

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`)
        .then(r => r.json())
        .then(data => {
            if (data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lon = parseFloat(data[0].lon);

                map.setView([lat, lon], 18);
                if (tempMarker) map.removeLayer(tempMarker);
                tempMarker = L.marker([lat, lon], { icon: makeTempIcon(), draggable: false }).addTo(map);


                if (mode === 'edit') {
                    editLat = lat; editLng = lon;
                    document.getElementById('eCoordDisplay').style.display = 'block';
                    document.getElementById('eCoordTxt').textContent = lat.toFixed(5) + ', ' + lon.toFixed(5);
                } else {
                    pendingLat = lat; pendingLng = lon;
                    document.getElementById('coordDisplay').style.display = 'block';
                    document.getElementById('coordTxt').textContent = lat.toFixed(5) + ', ' + lon.toFixed(5);
                }
            } else {
                alert("Nie znaleziono lokalizacji dla tego adresu.");
            }
        })
        .catch(err => console.error("Błąd geokodowania:", err));
}

function makeTempIcon() {
    return L.divIcon({
        className: '',
        html: `<div style="position:relative;width:32px;height:38px;">
            <div style="width:32px;height:32px;border-radius:6px;background:#E8621A;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(232,98,26,0.5);border:2px solid #fff;">
                <span style="color:#fff;font-family:'Barlow Condensed',Impact,sans-serif;font-weight:900;font-size:20px;line-height:1;">V</span>
            </div>
            <div style="width:0;height:0;border-left:8px solid transparent;border-right:8px solid transparent;border-top:10px solid #E8621A;margin:0 auto;"></div>
        </div>`,
        iconSize: [32, 42],
        iconAnchor: [16, 42],
        popupAnchor: [0, -44]
    });
}

function makeIcon(color = '#E8621A') {
    return L.divIcon({
        className: '',
        html: `<div style="position:relative;width:34px;height:42px;">
            <div style="width:34px;height:34px;border-radius:7px;background:${color};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 18px rgba(0,0,0,0.3);border:2.5px solid #fff;">
                <span style="color:#fff;font-family:'Barlow Condensed',Impact,sans-serif;font-weight:900;font-size:22px;line-height:1;">V</span>
            </div>
            <div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:11px solid ${color};margin:0 auto;"></div>
        </div>`,
        iconSize: [34, 45],
        iconAnchor: [17, 45],
        popupAnchor: [0, -47]
    });
}

function makeProjectIcon(name = 'PROJEKT', isArchived = false) {
    const bg = isArchived ? '#64748b' : '#3b82f6';
    return L.divIcon({
        className: '',
        html: `<div style="position:relative; transform: translate(-50%, -100%); display:flex; flex-direction:column; align-items:center;">
            <div style="background:${bg}; color:white; padding:5px 14px; border-radius:30px; font-family:'Barlow Condensed', sans-serif; font-weight:800; font-size:14px; white-space:nowrap; box-shadow:0 6px 20px rgba(0,0,0,0.45); border:2.5px solid #fff; line-height:1; text-transform:uppercase; letter-spacing:0.5px;">
                ${name}${isArchived ? ' (ARCHIWUM)' : ''}
            </div>
            <div style="width:0; height:0; border-left:7px solid transparent; border-right:7px solid transparent; border-top:10px solid ${bg}; margin-top:-1px; filter: drop-shadow(0 4px 4px rgba(0,0,0,0.2));"></div>
        </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        popupAnchor: [0, -40]
    });
}

function makeProjectFactoryIcon(isArchived = false) {
    const bg = isArchived ? '#64748b' : '#3b82f6';
    return L.divIcon({
        className: '',
        html: `<div style="position:relative;width:34px;height:42px;">
            <div style="width:34px;height:34px;border-radius:12px;background:${bg};display:flex;align-items:center;justify-content:center;box-shadow:0 4px 18px rgba(0,0,0,0.3);border:2.5px solid #fff;">
                <span style="font-size:18px;">🏭</span>
            </div>
            <div style="width:0;height:0;border-left:9px solid transparent;border-right:9px solid transparent;border-top:11px solid ${bg};margin:0 auto;"></div>
        </div>`,
        iconSize: [34, 45],
        iconAnchor: [17, 45],
        popupAnchor: [0, -47]
    });
}

function reloadMarkers(data = null) {
    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};
    const dataToUse = (data || locations).filter(l => !l.isArchived);
    dataToUse.forEach(loc => addMarker(loc));
}

// ===== SEARCH =====
async function performSearch() {
    const query = document.getElementById('addressSearch').value.trim();
    if (query.length < 3) return;

    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.innerHTML = '<div style="padding:10px; font-size:12px; color:var(--muted);">Szukanie...</div>';
    resultsDiv.classList.add('active');

    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=1`);
        const data = await response.json();

        if (data.length === 0) {
            resultsDiv.innerHTML = '<div style="padding:10px; font-size:12px; color:var(--muted);">Nie znaleziono adresu.</div>';
            return;
        }

        resultsDiv.innerHTML = data.map(item => {
            const cleanAddr = item.display_name.replace(/'/g, "\\'");
            return `<div class="search-item" onclick="selectSearchResult(${item.lat}, ${item.lon}, '${cleanAddr}')">
                ${item.display_name}
            </div>`;
        }).join('');
    } catch (err) {
        resultsDiv.innerHTML = '<div style="padding:10px; font-size:12px; color:var(--danger);">Błąd połączenia.</div>';
    }
}

function handleSearchKey(e) {
    if (e.key === 'Enter') {
        e.preventDefault();
        performSearch();
    }
}

function selectSearchResult(lat, lon, addr) {
    const resultsDiv = document.getElementById('searchResults');
    resultsDiv.classList.remove('active');
    document.getElementById('addressSearch').value = '';

    map.setView([lat, lon], 18);
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker([lat, lon], { icon: makeTempIcon(), draggable: false }).addTo(map);


    if (editingId) {
        editLat = lat; editLng = lon;
        document.getElementById('eCoordDisplay').style.display = 'block';
        document.getElementById('eCoordTxt').textContent = lat.toFixed(5) + ', ' + lon.toFixed(5);
        fillAddressFields('edit', lat, lon);
    } else {
        pendingLat = lat; pendingLng = lon;
        document.getElementById('typeModal').style.display = 'flex';
    }
}

document.addEventListener('click', (e) => {
    const container = document.querySelector('.search-container');
    const resultsDiv = document.getElementById('searchResults');
    if (container && !container.contains(e.target) && resultsDiv) {
        resultsDiv.classList.remove('active');
    }
});

function updateProjectIcons() {
    const zoom = map.getZoom();
    locations.forEach(loc => {
        if (loc.type === 'project' && markers[loc.id]) {
            const isArchived = !!loc.isArchived;
            const icon = zoom >= 11 ? makeProjectIcon(loc.name, isArchived) : makeProjectFactoryIcon(isArchived);
            markers[loc.id].setIcon(icon);
            // Label icon has 0,0 size/anchor, so we need to adjust Z-index for labeling
            if (zoom >= 11) markers[loc.id].setZIndexOffset(1000);
            else markers[loc.id].setZIndexOffset(0);
        }
    });
}

function addMarker(loc) {
    let m;
    if (loc.isArchived) {
        if (loc.type === 'project') {
            const zoom = map.getZoom();
            const icon = zoom >= 11 ? makeProjectIcon(loc.name, true) : makeProjectFactoryIcon(true);
            m = L.marker([loc.lat, loc.lng], { icon: icon }).addTo(map);
            if (zoom >= 11) m.setZIndexOffset(1000);
        } else {
            const color = getMarkerColor(loc);
            m = L.marker([loc.lat, loc.lng], { icon: makeIcon(color) }).addTo(map);
        }
    } else if (loc.type === 'project') {
        const zoom = map.getZoom();
        const icon = zoom >= 11 ? makeProjectIcon(loc.name) : makeProjectFactoryIcon();
        m = L.marker([loc.lat, loc.lng], { icon: icon }).addTo(map);
        if (zoom >= 11) m.setZIndexOffset(1000);
    } else {
        const color = getMarkerColor(loc);
        m = L.marker([loc.lat, loc.lng], { icon: makeIcon(color) }).addTo(map);
    }
    m.bindPopup(makePopupHtml(loc));
    m.on('click', () => { focusLocation(loc.id); });
    markers[loc.id] = m;
}

function makePopupHtml(loc) {
    if (loc.isArchived) {
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');
        const addrHtml = fullAddr ? `<div class="popup-row">🏡 <span style="font-size:11px;">${fullAddr}</span></div>` : '';
        const addedByHtml = loc.addedBy ? `<div class="popup-row" style="opacity:0.6; font-size:11px;">✍️ Dodał(a): <span>${loc.addedBy}</span></div>` : '';

        if (loc.type === 'project') {
            const linkedNames = (loc.linkedLocations || [])
                .map(id => locations.find(x => x.id === id))
                .filter(l => l)
                .map(l => `[#${l.locNumber || '?'}] ${l.name}`)
                .join('<br>');

            return `<div style="min-width:220px;padding:4px;">
                <div class="popup-name" style="color:var(--muted);"><span style="font-size:10px; background:var(--muted); color:white; padding:1px 5px; border-radius:3px; margin-right:6px; vertical-align:middle; font-weight:800;">PROJEKT</span>${loc.name}</div>
                <span class="badge" style="background:rgba(100,116,139,0.15); color:var(--muted); border:1px solid rgba(100,116,139,0.3); margin-bottom:8px;">Archiwum (Zakończony projekt)</span>
                ${addrHtml}
                <div class="popup-row" style="font-size:11px;">📌 <span>${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</span></div>
                ${addedByHtml}
                ${loc.notes ? `<div style="margin-top:6px; font-size:11px; color:var(--text); padding:4px 6px; background:var(--bg); border-radius:4px;">📝 ${loc.notes}</div>` : ''}
                <div style="margin-top:8px; font-size:11px; color:var(--muted); font-weight:600;">PRZYPISANE LOKALIZACJE:</div>
                <div style="font-size:12px; margin-top:4px;">${linkedNames || '<span style="color:var(--muted)">Brak</span>'}</div>
            </div>`;
        }

        const dateFromStr = fmtDate(loc.dateFrom);
        const dateToStr = loc.isIndefinite ? 'Nieokreślony' : fmtDate(loc.dateTo);
        const cost = calcArchiveCost(loc);
        const houseIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px; color: var(--muted);"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;
        const numPrefix = loc.locNumber ? `<span style="color:var(--muted); font-size:13px; font-weight:normal;">[#${loc.locNumber}]</span> ` : '';
        return `<div style="min-width:220px;padding:4px;">
            <div class="popup-name" style="color: var(--muted);">${loc.type === 'office' ? '🏢' : houseIcon} ${numPrefix}${loc.name}</div>
            <span class="badge" style="background:rgba(100,116,139,0.15); color:var(--muted); border:1px solid rgba(100,116,139,0.3); margin-bottom:8px;">Archiwum (Zakończony wynajem)</span>
            ${addrHtml}
            <div class="popup-row">📅 Okres: <span>${dateFromStr} → ${dateToStr}</span></div>
            <div class="popup-row">💰 Koszt: <strong style="color:var(--accent);">€${cost.toFixed(2)}</strong> <span style="font-size:10px; color:var(--muted); margin-left:4px;">(~${fmtPLN(cost * eurToPln, 0)} PLN)</span></div>
            <div class="popup-row" style="font-size:11px;">📌 <span>${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</span></div>
            ${addedByHtml}
        </div>`;
    }

    if (loc.type === 'project') {
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');
        const addrHtml = fullAddr ? `<div class="popup-row">🏡 <span style="font-size:11px;">${fullAddr}</span></div>` : '';
        const addedByHtml = loc.addedBy ? `<div class="popup-row" style="opacity:0.6; font-size:11px;">✍️ Dodał(a): <span>${loc.addedBy}</span></div>` : '';

        const linkedNames = (loc.linkedLocations || [])
            .map(id => locations.find(x => x.id === id))
            .filter(l => l && !l.isArchived)
            .map(l => {
                const distKey = `${loc.id}_${l.id}`;
                const dist = roadDistances[distKey];

                let distHtml = '';
                // Only trigger/show distance in popup if this project is active
                if (activeProjectId === loc.id) {
                    if (dist === undefined) { fetchRoadDistance(loc, l); }
                    distHtml = (dist === undefined || dist === null) ? ` <span style="font-size:9px; color:var(--muted); opacity:0.7;">(liczenie...)</span>` :
                        (dist !== '—' ? ` <span style="color:var(--blue); font-weight:700;">(${dist} km)</span>` : '');
                }
                return `[#${l.locNumber || '?'}] ${l.name}${distHtml}`;
            }).join('<br>');

        return `<div style="min-width:220px;padding:4px;">
            <div class="popup-name" style="color:var(--blue);"><span style="font-size:10px; background:var(--blue); color:white; padding:1px 5px; border-radius:3px; margin-right:6px; vertical-align:middle; font-weight:800;">PROJEKT</span>${loc.name}</div>
            <span class="badge badge-blue" style="margin-bottom:8px;">Aktywny projekt</span>
            ${addrHtml}
            <div class="popup-row" style="font-size:11px;">📌 <span>${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</span></div>
            ${addedByHtml}
            <div style="margin-top:8px; font-size:11px; color:var(--muted); font-weight:600;">PRZYPISANE LOKALIZACJE:</div>
            <div style="font-size:12px; margin-top:4px;">${linkedNames || '<span style="color:var(--muted)">Brak</span>'}</div>
        </div>`;
    }

    if (loc.type === 'office') {
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');
        const addrHtml = fullAddr ? `<div class="popup-row">🏡 <span style="font-size:11px;">${fullAddr}</span></div>` : '';
        const addedByHtml = loc.addedBy ? `<div class="popup-row" style="opacity:0.6; font-size:11px;">✍️ Dodał(a): <span>${loc.addedBy}</span></div>` : '';

        return `<div style="min-width:220px;padding:4px;">
            <div class="popup-name" style="color:#a855f7;"><span style="font-size:10px; background:#a855f7; color:white; padding:1px 5px; border-radius:3px; margin-right:6px; vertical-align:middle; font-weight:800;">BIURO</span>${loc.name}</div>
            <span class="badge" style="background:rgba(168,85,247,0.15); color:#a855f7; border:1px solid rgba(168,85,247,0.3); margin-bottom:8px;">Biuro firmowe</span>
            ${addrHtml}
            <div class="popup-row" style="font-size:11px;">📌 <span>${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</span></div>
            ${addedByHtml}
            ${loc.notes ? `<div class="popup-row" style="margin-top:4px; font-style:italic; color:var(--muted);">📝 Uwagi: <span>${loc.notes}</span></div>` : ''}
        </div>`;
    }

    const formatPerson = (p) => {
        if (typeof p === 'string') return `<span class="person-chip" style="border-radius:4px;">${p}</span>`;
        const plate = p.isDriver && p.carPlate ? ` <span class="car-plate">${p.carPlate}</span>` : '';
        const carLink = p.isDriver && p.carDesc ? ` <span style="font-size:11px; opacity:0.8; margin-left:4px;">(${p.carDesc})</span>` : '';
        const driverIcon = p.isDriver ? '<span style="margin-left:8px;">🚗</span>' : '';
        const isWorking = p.isWorking !== false;
        const vDays = getVacationDaysLeft(p.vacationEnd);
        const isOnVacation = vDays > 0;
        const sDays = getSickLeaveDaysLeft(p.sickLeaveEnd);
        const isOnSickLeave = sDays > 0;
        let workIcon = '';
        if (isOnVacation) {
            workIcon = `<span style="margin-right:4px;">🌴 ${vDays}d</span>`;
        } else if (isOnSickLeave) {
            workIcon = `<span style="margin-right:4px;">🏥 ${sDays}d</span>`;
        } else if (!isWorking) {
            workIcon = '<span style="margin-right:4px;">❌</span>';
        }
        const vacationText = '';
        let cls = '';
        if (isOnVacation) cls = 'on-vacation';
        else if (isOnSickLeave) cls = 'on-sick-leave';
        else if (!isWorking) cls = 'not-working';
        return `<span class="person-chip ${cls}" style="border-radius:4px;">${workIcon}${p.name}${driverIcon}${plate}${carLink}${vacationText}</span>`;
    };

    const peopleHtml = loc.people && loc.people.length > 0
        ? loc.people.map(p => formatPerson(p)).join('')
        : '<span style="color:var(--muted);font-size:12px;font-style:italic;">brak mieszkańców</span>';

    const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');
    const addrHtml = fullAddr ? `<div class="popup-row">🏡 <span style="font-size:11px;">${fullAddr}</span></div>` : '';
    const days = calcDays(loc.dateFrom, loc.dateTo);
    const months = days ? (days / 30).toFixed(1) : null;
    const totalCost = months ? (parseFloat(months) * parseFloat(loc.price || 0)) : null;
    const dateToFmt = loc.isIndefinite ? 'Nieokreślony' : fmtDate(loc.dateTo);
    const dateHtml = (loc.dateFrom || loc.dateTo || loc.isIndefinite) ? `
        <div class="popup-row">📅 <span>${fmtDate(loc.dateFrom)} → ${dateToFmt}</span></div>
        ${months ? `<div class="popup-row">⏱ <span>${months} m-cy • €${totalCost.toFixed(2)} szac.</span></div>` : ''}` : '';
    const rs = rentalStatus(loc);
    const caregiverHtml = loc.caregiver ? `<div class="popup-row">👤 Opiekun: <span>${loc.caregiver}</span></div>` : '';
    const addedByHtml = loc.addedBy ? `<div class="popup-row" style="opacity:0.6; font-size:11px;">✍️ Dodał(a): <span>${loc.addedBy}</span></div>` : '';
    const houseIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px; color: var(--accent);"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;
    const numPrefix = loc.locNumber ? `<span style="color:var(--muted); font-size:13px; font-weight:normal;">[#${loc.locNumber}]</span> ` : '';
    return `<div style="min-width:220px;padding:4px;">
        <div class="popup-name">${houseIcon} ${numPrefix}${loc.name}</div>
        <div style="margin-bottom:6px; display:flex; gap:4px; flex-wrap:wrap;">
            <span class="rental-badge ${rs.cls}">${rs.label}</span>
            ${loc.caregiver ? `<span class="caregiver-badge">👤 ${loc.caregiver}</span>` : ''}
        </div>
        ${addrHtml}
        ${caregiverHtml}
        ${dateHtml}
        <div class="popup-row">👥 Miejsc: <span>${loc.capacity}</span></div>
        ${loc.noticePeriod ? `<div class="popup-row">⏳ Wypowiedzenie: <span>${loc.noticePeriod}</span></div>` : ''}
        ${(() => {
            if (!activeProjectId) return '';
            const p = locations.find(x => x.id === activeProjectId);
            if (!p || p.type !== 'project' || !(p.linkedLocations || []).includes(loc.id)) return '';

            const distKey = `${p.id}_${loc.id}`;
            const dist = roadDistances[distKey];
            if (dist === undefined) { fetchRoadDistance(p, loc); return `<div class="popup-row">🛣️ Do projektu ${p.name}: <span style="font-size:10px; color:var(--muted);">liczenie...</span></div>`; }
            return `<div class="popup-row">🛣️ Do projektu ${p.name}: <strong style="color:var(--blue);">${dist} km</strong></div>`;
        })()}
        <div class="popup-row">💸 Wydano (do dziś): <strong style="color:var(--accent);">€${calcSpentSoFar(loc.dateFrom, loc.price).toFixed(2)}</strong></div>
        <div class="popup-row" style="margin-bottom:2px;">
            💰 Koszt: <strong style="color:var(--accent);">€${parseFloat(loc.price || 0).toFixed(2)}</strong>
            <span style="font-size:10px; color:var(--muted); margin-left:8px;">(~${fmtPLN(parseFloat(loc.price || 0) * eurToPln, 2)} PLN)</span>
        </div>
        <div class="popup-row" style="font-size:11px;">📌 <span>${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</span></div>
        ${addedByHtml}
        ${loc.notes ? `<div class="popup-row" style="margin-top:4px; font-style:italic; color:var(--muted);">📝 Uwagi: <span>${loc.notes}</span></div>` : ''}
        <div class="popup-people"><div style="font-size:11px;color:var(--muted);margin-bottom:4px;font-weight:600;">MIESZKAŃCY</div>${peopleHtml}</div>
    </div>`;
}

// ===== HELPERS =====
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// Real-time synchronization
function initDataSync() {
    db.collection('locations').orderBy('createdAt', 'asc').onSnapshot(snapshot => {
        const rawDocs = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        // Podaj unikatowe numery tym, którzy ich nie mają
        let updatePromises = [];
        let currentMax = rawDocs.reduce((max, l) => Math.max(max, l.locNumber || 0), 0);

        rawDocs.forEach(doc => {
            if (doc.type !== 'project' && !doc.locNumber) {
                currentMax++;
                updatePromises.push(db.collection('locations').doc(doc.id).update({ locNumber: currentMax }));
            }
        });

        if (updatePromises.length > 0) {
            Promise.all(updatePromises).then(() => console.log("Zaktualizowano brakujące numery lokalizacji"));
        }

        locations = rawDocs.filter(l => !l.isDeleted);
        deletedLocations = rawDocs.filter(l => l.isDeleted);
        applyFilters();
        renderStats();
        renderArchive();
        if (currentUser === 'Admin') renderAdminPanel();
    }, error => {
        console.error("Błąd synchronizacji:", error);
    });
}

function logActivity(action, details, extraData = null, changes = null) {
    if (!currentUser) return;
    const docData = {
        user: currentUser,
        action: action,
        details: details,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };
    if (extraData) {
        docData.extraData = extraData;
    }
    if (changes) {
        docData.changes = changes;
    }
    db.collection('activity').add(docData);
}

function calcDays(from, to) {
    if (!from || !to) return null;
    const d = (new Date(to) - new Date(from)) / 86400000;
    return d > 0 ? Math.round(d) : null;
}

function getVacationDaysLeft(vacationEnd) {
    if (!vacationEnd) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(vacationEnd);
    end.setHours(0, 0, 0, 0);
    const diffTime = end - today;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays > 0 ? diffDays : 0;
}

function getSickLeaveDaysLeft(sickLeaveEnd) {
    if (!sickLeaveEnd) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const end = new Date(sickLeaveEnd);
    end.setHours(0, 0, 0, 0);
    const diffTime = end - today;
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24)) + 1;
    return diffDays > 0 ? diffDays : 0;
}

function getMarkerColor(loc) {
    if (loc.isArchived) return '#64748b'; // Muted grey
    if (loc.type === 'office') return '#a855f7'; // Purple
    if (loc.name && loc.name.toUpperCase().includes('VANSTEV - BIURO')) return '#a855f7';

    const occ = loc.people ? loc.people.length : 0;
    const isFull = occ >= loc.capacity;
    const hasNotWorking = loc.people && loc.people.some(p => p.isWorking === false);
    const hasVacation = loc.people && loc.people.some(p => getVacationDaysLeft(p.vacationEnd) > 0);
    const hasSickLeave = loc.people && loc.people.some(p => getSickLeaveDaysLeft(p.sickLeaveEnd) > 0);

    if (hasSickLeave) return '#60a5fa'; // Light Blue
    if (hasVacation) return '#fbbf24'; // Yellow
    if (hasNotWorking) return '#ff0000'; // Red
    if (isFull) return '#E8621A'; // Orange
    return '#10b981'; // Green
}

function calcSpentSoFar(from, monthlyPrice) {
    if (!from || !monthlyPrice) return 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const start = new Date(from); start.setHours(0, 0, 0, 0);
    if (today < start) return 0;
    const diffDays = Math.round((today - start) / 86400000) + 1;
    return (diffDays / 30) * parseFloat(monthlyPrice);
}

async function fetchRoadDistance(project, quarter) {
    if (!project.lat || !project.lng || !quarter.lat || !quarter.lng) return;
    const key = `${project.id}_${quarter.id}`;

    // Only fetch for the currently active project
    if (activeProjectId !== project.id) {
        if (roadDistances[key] === null) delete roadDistances[key];
        return;
    }

    if (roadDistances[key] !== undefined) return;

    roadDistances[key] = null;

    // Stagger requests to avoid OSRM demo server rate limits (demo.project-osrm.org is strict)
    await new Promise(r => setTimeout(r, Math.random() * 2000));

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${quarter.lng},${quarter.lat};${project.lng},${project.lat}?overview=false`;
        const resp = await fetch(url);
        const data = await resp.json();
        if (data.routes && data.routes[0]) {
            const distKm = (data.routes[0].distance / 1000).toFixed(1);
            roadDistances[key] = distKm;
            // Trigger UI refresh while keeping current user view/filters
            if (typeof applyFilters === 'function') applyFilters();
            else renderList();
        } else {
            roadDistances[key] = '—';
            if (typeof applyFilters === 'function') applyFilters();
        }
    } catch (e) {
        console.error("Dist fetch failed", e);
        roadDistances[key] = '—';
        if (typeof applyFilters === 'function') applyFilters();
    }
}

function rentalStatus(loc) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    if (!loc.dateFrom && !loc.dateTo && !loc.isIndefinite) return { cls: 'rb-nodates', label: 'Brak dat wynajmu' };
    const from = loc.dateFrom ? new Date(loc.dateFrom) : null;
    if (loc.isIndefinite) {
        if (from && today < from) return { cls: 'rb-upcoming', label: '📅 Nadchodzi (Nieokreślony)' };
        return { cls: 'rb-active', label: '✅ Aktywny (Czas nieokreślony)' };
    }
    const to = loc.dateTo ? new Date(loc.dateTo) : null;
    if (from && to) {
        if (today < from) {
            const daysLeft = Math.round((from - today) / 86400000);
            return { cls: 'rb-upcoming', label: `📅 Nadchodzi za ${daysLeft} dni` };
        }
        if (today > to) return { cls: 'rb-expired', label: '⏹ Zakończony' };
        const daysLeft = Math.round((to - today) / 86400000);
        return { cls: 'rb-active', label: `✅ Aktywny • jeszcze ${daysLeft} dni` };
    }
    if (from && today >= from) return { cls: 'rb-active', label: '✅ Aktywny' };
    return { cls: 'rb-nodates', label: '📅 Częściowe daty' };
}

function toggleIndefinite(mode) {
    const isChecked = document.getElementById(mode === 'add' ? 'fIndefinite' : 'eIndefinite').checked;
    const dateInput = document.getElementById(mode === 'add' ? 'fDateTo' : 'eDateTo');
    if (dateInput) {
        dateInput.disabled = isChecked;
        if (isChecked) dateInput.value = '';
    }
    if (mode === 'add') updateTotalCost(); else updateEditTotalCost();
}

function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    return dt.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtPLN(val, dec = 0) {
    if (isNaN(val)) return '0';
    let parts = parseFloat(val).toFixed(dec).split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return parts.join(',');
}

function updateTotalCost() {
    const price = parseFloat(document.getElementById('fPrice').value);
    const from = document.getElementById('fDateFrom').value;
    const to = document.getElementById('fDateTo').value;
    const isIndefinite = document.getElementById('fIndefinite').checked;
    const bar = document.getElementById('fTotalCost');
    if (isIndefinite && !isNaN(price) && price > 0) {
        bar.style.display = 'block';
        bar.textContent = `💰 Koszt miesięczny: €${price.toFixed(2)}`;
        return;
    }
    const days = calcDays(from, to);
    if (days && !isNaN(price) && price > 0) {
        const months = (days / 30).toFixed(1);
        bar.style.display = 'block';
        bar.textContent = `💰 Szac. koszt (${months} m-cy): €${(months * price).toFixed(2)}`;
    } else bar.style.display = 'none';
}

function updateEditTotalCost() {
    const price = parseFloat(document.getElementById('ePrice').value);
    const from = document.getElementById('eDateFrom').value;
    const to = document.getElementById('eDateTo').value;
    const isIndefinite = document.getElementById('eIndefinite').checked;
    const bar = document.getElementById('eTotalCost');
    if (isIndefinite && !isNaN(price) && price > 0) {
        bar.style.display = 'block';
        bar.textContent = `💰 Koszt miesięczny: €${price.toFixed(2)}`;
        return;
    }
    const days = calcDays(from, to);
    if (days && !isNaN(price) && price > 0) {
        const months = (days / 30).toFixed(1);
        bar.style.display = 'block';
        bar.textContent = `💰 Szac. koszt (${months} m-cy): €${(months * price).toFixed(2)}`;
    } else bar.style.display = 'none';
}

// ===== ADD FORM =====
let addPeople = []; // Array of objects {name, isDriver, carPlate, carDesc}

function addNewPerson() {
    addPeople.push({ name: '', isDriver: false, carPlate: '', carDesc: '', isWorking: true });
    renderPeopleInputs('addPeopleList', addPeople, 'add');
}

function renderPeopleInputs(containerId, arr, mode) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    arr.forEach((p, i) => {
        if (typeof p === 'string') {
            arr[i] = { name: p, isDriver: false, carPlate: '', carDesc: '', isWorking: true };
            p = arr[i];
        }
        if (p.isWorking === undefined) p.isWorking = true;
        
        const row = document.createElement('div');
        row.className = 'people-row';
        const vDays = getVacationDaysLeft(p.vacationEnd);
        const sDays = getSickLeaveDaysLeft(p.sickLeaveEnd);
        row.innerHTML = `
            <input type="text" value="${p.name}" placeholder="Imię i nazwisko" oninput="updatePersonField('${mode}',${i},'name',this.value)"/>
            <div style="display:flex; flex-direction:column; gap:2px;">
                <label class="driver-checkbox-wrap">
                    <input type="checkbox" ${p.isDriver ? 'checked' : ''} onchange="updatePersonField('${mode}',${i},'isDriver',this.checked); renderPeopleInputs('${containerId}', ${mode === 'add' ? 'addPeople' : 'editPeople'}, '${mode}')"/>
                    Kierowca
                </label>
                <label class="driver-checkbox-wrap">
                    <input type="checkbox" ${p.isWorking !== false ? 'checked' : ''} onchange="updatePersonField('${mode}',${i},'isWorking',this.checked); renderPeopleInputs('${containerId}', ${mode === 'add' ? 'addPeople' : 'editPeople'}, '${mode}')"/>
                    Pracuje
                </label>
                <label class="driver-checkbox-wrap">
                    <input type="checkbox" ${vDays > 0 ? 'checked' : ''} onchange="toggleVacation('${mode}',${i},this.checked,'${containerId}')"/>
                    Urlop
                </label>
                ${vDays > 0 ? `
                    <div style="display:flex; align-items:center; gap:2px; margin-top:2px;">
                        <input type="number" min="1" value="${vDays}" style="width:45px; height:18px; padding:2px; font-size:10px; border-radius:3px; border:1px solid var(--border); background:var(--bg); color:var(--text);" oninput="updateVacationDays('${mode}',${i},this.value)"/>
                        <span style="font-size:9px; color:var(--muted);">dni</span>
                    </div>
                ` : ''}
                <label class="driver-checkbox-wrap">
                    <input type="checkbox" ${sDays > 0 ? 'checked' : ''} onchange="toggleSickLeave('${mode}',${i},this.checked,'${containerId}')"/>
                    Chorobowe
                </label>
                ${sDays > 0 ? `
                    <div style="display:flex; align-items:center; gap:2px; margin-top:2px;">
                        <input type="number" min="1" value="${sDays}" style="width:45px; height:18px; padding:2px; font-size:10px; border-radius:3px; border:1px solid var(--border); background:var(--bg); color:var(--text);" oninput="updateSickLeaveDays('${mode}',${i},this.value)"/>
                        <span style="font-size:9px; color:var(--muted);">dni</span>
                    </div>
                ` : ''}
            </div>
            ${p.isDriver ? `
                <input type="text" value="${p.carPlate || ''}" placeholder="Nr rej." style="width:80px; text-transform:uppercase;" oninput="updatePersonField('${mode}',${i},'carPlate',this.value.toUpperCase())"/>
                <input type="text" value="${p.carDesc || ''}" placeholder="Samochód" style="width:100px;" oninput="updatePersonField('${mode}',${i},'carDesc',this.value)"/>
            ` : '<div></div><div></div>'}
            <button onclick="removePerson('${mode}',${i})">×</button>
        `;
        c.appendChild(row);
    });
}

function updatePersonField(mode, idx, field, val) {
    const arr = mode === 'add' ? addPeople : editPeople;
    if (arr[idx]) arr[idx][field] = val;
}

function removePerson(mode, idx) {
    if (mode === 'add') { addPeople.splice(idx, 1); renderPeopleInputs('addPeopleList', addPeople, 'add'); }
    else { editPeople.splice(idx, 1); renderPeopleInputs('editPeopleList', editPeople, 'edit'); }
}

function toggleVacation(mode, idx, isChecked, containerId) {
    const arr = mode === 'add' ? addPeople : editPeople;
    if (!arr[idx]) return;
    if (isChecked) {
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
        arr[idx].vacationEnd = endDate.toISOString().split('T')[0];
        arr[idx].sickLeaveEnd = null;
    } else {
        arr[idx].vacationEnd = null;
    }
    renderPeopleInputs(containerId, arr, mode);
}

function updateVacationDays(mode, idx, daysVal) {
    const arr = mode === 'add' ? addPeople : editPeople;
    if (!arr[idx]) return;
    const days = parseInt(daysVal);
    if (isNaN(days) || days <= 0) {
        arr[idx].vacationEnd = null;
    } else {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + days - 1);
        endDate.setHours(23, 59, 59, 999);
        arr[idx].vacationEnd = endDate.toISOString().split('T')[0];
    }
}

function toggleSickLeave(mode, idx, isChecked, containerId) {
    const arr = mode === 'add' ? addPeople : editPeople;
    if (!arr[idx]) return;
    if (isChecked) {
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
        arr[idx].sickLeaveEnd = endDate.toISOString().split('T')[0];
        arr[idx].vacationEnd = null;
    } else {
        arr[idx].sickLeaveEnd = null;
    }
    renderPeopleInputs(containerId, arr, mode);
}

function updateSickLeaveDays(mode, idx, daysVal) {
    const arr = mode === 'add' ? addPeople : editPeople;
    if (!arr[idx]) return;
    const days = parseInt(daysVal);
    if (isNaN(days) || days <= 0) {
        arr[idx].sickLeaveEnd = null;
    } else {
        const endDate = new Date();
        endDate.setDate(endDate.getDate() + days - 1);
        endDate.setHours(23, 59, 59, 999);
        arr[idx].sickLeaveEnd = endDate.toISOString().split('T')[0];
    }
}

function toggleLegend(event) {
    if (event) event.stopPropagation();
    const legend = document.getElementById('mapLegend');
    if (legend) {
        legend.classList.toggle('collapsed');
    }
}

function saveLocation() {
    const type = addingType || 'location';
    const name = document.getElementById('fName').value.trim();
    const zip = document.getElementById('fZip').value.trim();
    const city = document.getElementById('fCity').value.trim();
    const street = document.getElementById('fStreet').value.trim();
    const houseNum = document.getElementById('fHouseNum').value.trim();

    if (pendingLat === null) { showFormErr('Kliknij na mapę aby wybrać lokalizację.'); return; }
    if (!name) { showFormErr('Podaj nazwę.'); return; }

    const locData = {
        type, name, zip, city, street, houseNum,
        lat: pendingLat, lng: pendingLng,
        addedBy: currentUser,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (type === 'location') {
        const capacity = parseInt(document.getElementById('fCapacity').value);
        const price = parseFloat(document.getElementById('fPrice').value);
        if (!capacity || capacity < 1) { showFormErr('Podaj liczbę miejsc.'); return; }
        if (isNaN(price) || price < 0) { showFormErr('Podaj prawidłową cenę.'); return; }

        const maxLocNum = locations.filter(l => l.type !== 'project').reduce((max, l) => Math.max(max, l.locNumber || 0), 0);

        Object.assign(locData, {
            locNumber: maxLocNum + 1,
            capacity, price,
            caregiver: document.getElementById('fCaregiver').value,
            noticePeriod: document.getElementById('fNoticePeriod').value,
            dateFrom: document.getElementById('fDateFrom').value,
            dateTo: document.getElementById('fDateTo').value,
            isIndefinite: document.getElementById('fIndefinite').checked,
            isArchived: document.getElementById('fRentalEnded')?.checked || false,
            people: [...addPeople].filter(p => p.name.trim()),
            notes: document.getElementById('fNotes').value.trim()
        });
    } else {
        const isArchived = document.getElementById('fProjRentalEnded')?.checked || false;
        const notes = (document.getElementById('fProjNotes')?.value || '').trim();
        Object.assign(locData, {
            linkedLocations: getSelectedLinkedLocations(),
            isArchived,
            notes
        });
    }

    db.collection('locations').add(locData)
        .then(() => {
            logActivity(type === 'project' ? 'Dodano projekt' : 'Dodano lokalizację', name);
            if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
            resetForm();
            switchTab(locData.isArchived ? 'archive' : 'list');
        })
        .catch(err => showFormErr("Błąd zapisu: " + err.message));
}

function showFormErr(msg) {
    const e = document.getElementById('formErr');
    e.textContent = '⚠️ ' + msg; e.style.display = 'block';
}

function resetForm() {
    ['fName', 'fZip', 'fCity', 'fStreet', 'fHouseNum', 'addressSearch', 'fCapacity', 'fPrice', 'fCaregiver', 'fNoticePeriod', 'fDateFrom', 'fDateTo', 'fNotes', 'fProjNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('fTotalCost').style.display = 'none';
    document.getElementById('formErr').style.display = 'none';
    document.getElementById('coordDisplay').style.display = 'none';
    document.getElementById('fIndefinite').checked = false;
    document.getElementById('fDateTo').disabled = false;
    const fRentalEndedCb = document.getElementById('fRentalEnded');
    if (fRentalEndedCb) fRentalEndedCb.checked = false;
    const fProjRentalEndedCb = document.getElementById('fProjRentalEnded');
    if (fProjRentalEndedCb) fProjRentalEndedCb.checked = false;
    addPeople = []; renderPeopleInputs('addPeopleList', addPeople, 'add');
    pendingLat = null; pendingLng = null;
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
    clearAllMarkerHighlights();
}

function toggleSection(section) {
    if (section === 'projects') isProjectsCollapsed = !isProjectsCollapsed;
    else if (section === 'quarters') isQuartersCollapsed = !isQuartersCollapsed;
    else if (section === 'offices') isOfficesCollapsed = !isOfficesCollapsed;
    renderList();
}

// ===== LIST =====
function renderList(filteredLocs = null) {
    const list = document.getElementById('locList');
    const empty = document.getElementById('emptyState');
    const count = document.getElementById('locCount');

    const data = (filteredLocs || locations).filter(l => !l.isArchived);

    const projects = data.filter(l => l.type === 'project').sort((a, b) => a.name.localeCompare(b.name));
    const quarters = data.filter(l => l.type !== 'project' && l.type !== 'office').sort((a, b) => (a.locNumber || 0) - (b.locNumber || 0));
    const offices = data.filter(l => l.type === 'office' || (l.type !== 'project' && l.name && l.name.toUpperCase().includes('VANSTEV - BIURO'))).sort((a, b) => a.name.localeCompare(b.name));

    count.textContent = data.length + ' wpis' + (data.length === 1 ? '' : data.length < 5 ? 'y' : 'ów');

    if (!data.length) {
        list.innerHTML = '';
        empty.style.display = 'block';
        return;
    }
    empty.style.display = 'none';

    const houseIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px; color: var(--accent);"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;

    const formatPerson = (p) => {
        if (typeof p === 'string') return `<span class="person-chip" style="border-radius:4px;">${p}</span>`;
        const plate = p.isDriver && p.carPlate ? ` <span class="car-plate">${p.carPlate}</span>` : '';
        const car = p.isDriver && p.carDesc ? ` <span style="font-size:11px; opacity:0.8; margin-left:4px;">(${p.carDesc})</span>` : '';
        const driverIcon = p.isDriver ? '<span style="margin-left:8px;">🚗</span>' : '';
        const isWorking = p.isWorking !== false;
        const vDays = getVacationDaysLeft(p.vacationEnd);
        const isOnVacation = vDays > 0;
        const sDays = getSickLeaveDaysLeft(p.sickLeaveEnd);
        const isOnSickLeave = sDays > 0;
        let workIcon = '';
        if (isOnVacation) {
            workIcon = `<span style="margin-right:4px;">🌴 ${vDays}d</span>`;
        } else if (isOnSickLeave) {
            workIcon = `<span style="margin-right:4px;">🏥 ${sDays}d</span>`;
        } else if (!isWorking) {
            workIcon = '<span style="margin-right:4px;">❌</span>';
        }
        const vacationText = '';
        let cls = '';
        if (isOnVacation) cls = 'on-vacation';
        else if (isOnSickLeave) cls = 'on-sick-leave';
        else if (!isWorking) cls = 'not-working';
        return `<span class="person-chip ${cls}" style="border-radius:4px;">${workIcon}${p.name}${driverIcon}${plate}${car}${vacationText}</span>`;
    };

    const toggleDetailsHtml = (id) => {
        return `<button class="expand-btn" onclick="toggleDetails('${id}', event)">
            🔽 Rozwiń
        </button>`;
    };

    const renderProjectCard = (loc) => {
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');
        const linkedNames = (loc.linkedLocations || [])
            .map(id => locations.find(x => x.id === id))
            .filter(l => l && !l.isArchived)
            .map(l => {
                const distKey = `${loc.id}_${l.id}`;
                const dist = roadDistances[distKey];

                let distHtml = '';
                // Only calculate/show distance if this project is the active one
                if (loc.id === activeProjectId) {
                    if (dist === undefined) { fetchRoadDistance(loc, l); }
                    distHtml = (dist === undefined || dist === null) ? ` <span style="font-size:9px; color:var(--muted); opacity:0.7;">(liczenie...)</span>` :
                        (dist !== '—' ? ` <strong style="margin-left:4px; color:var(--blue); font-size:11px;">(${dist} km)</strong>` : '');
                }
                return `<span class="person-chip" style="border-radius:4px; border-color:var(--blue); color:var(--blue);font-weight:700;">[#${l.locNumber || '?'}] ${l.name}${distHtml}</span>`;
            }).join('');
        return `<div class="loc-card" id="card-${loc.id}" onclick="focusLoc('${loc.id}')" style="border-left:4px solid var(--blue);">
            <div class="loc-card-head">
                <div class="loc-name"><span style="font-size:10px; background:var(--blue); color:white; padding:1px 5px; border-radius:3px; margin-right:6px; vertical-align:middle; font-weight:800;">PROJEKT</span>${loc.name}</div>
                <div class="loc-actions">
                    <button class="act-btn edit" title="Edytuj" onclick="openEdit('${loc.id}',event)">✏️</button>
                    <button class="act-btn archive" title="Przenieś do archiwum" onclick="toggleArchiveLocation('${loc.id}', true, event)">📁</button>
                    <button class="act-btn del" title="Usuń" onclick="deleteLocation('${loc.id}',event)">🗑️</button>
                </div>
            </div>
            ${fullAddr ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">📍 ${fullAddr}</div>` : ''}
            <div class="loc-badges" style="margin-top:8px;"><span class="badge badge-blue">Projekt</span></div>
            
            ${toggleDetailsHtml(loc.id)}
            
            <div class="loc-card-details" id="details-${loc.id}">
                <div style="margin-top:8px; font-size:11px; color:var(--muted);">✍️ Dodane przez: <strong>${loc.addedBy || 'System'}</strong></div>
                ${loc.notes ? `<div style="margin-top:6px; font-size:11px; padding:6px; background:var(--bg); border-radius:6px; border-left:3px solid var(--blue);">📝 <em>${loc.notes}</em></div>` : ''}
                <div class="loc-people" style="margin-top:8px;"><div class="loc-people-title">Przypisane lokalizacje</div>${linkedNames || '<span style="color:var(--muted);font-size:12px;">Brak</span>'}</div>
            </div>
        </div>`;
    };

    const renderQuarterCard = (loc) => {
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');
        const numPrefix = loc.locNumber ? `<span style="color:var(--muted); font-size:13px; font-weight:normal;">[#${loc.locNumber}]</span> ` : '';
        const people = loc.people && loc.people.length ? loc.people.map(p => formatPerson(p)).join('') : '<span style="color:var(--muted);font-size:12px;">Brak osób</span>';
        const rs = rentalStatus(loc); const days = calcDays(loc.dateFrom, loc.dateTo);
        const months = days ? (days / 30).toFixed(1) : null;
        const totalCost = months ? (months * parseFloat(loc.price || 0)) : null;
        const dateToFmt = loc.isIndefinite ? 'Nieokreślony' : fmtDate(loc.dateTo);
        const occ = loc.people ? loc.people.length : 0;
        const hasNotWorking = loc.people && loc.people.some(p => p.isWorking === false);
        const nwClass = hasNotWorking ? 'not-working' : '';
        return `<div class="loc-card ${nwClass}" id="card-${loc.id}" onclick="focusLoc('${loc.id}')">
            <div class="loc-card-head"><div class="loc-name">${houseIcon} ${numPrefix}${loc.name}</div><div class="loc-actions"><button class="act-btn edit" title="Edytuj" onclick="openEdit('${loc.id}',event)">✏️</button><button class="act-btn archive" title="Przenieś do archiwum" onclick="toggleArchiveLocation('${loc.id}', true, event)">📁</button><button class="act-btn del" title="Usuń" onclick="deleteLocation('${loc.id}',event)">🗑️</button></div></div>
            ${fullAddr ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">📍 ${fullAddr}</div>` : ''}
            <div class="loc-badges" style="margin-top:8px;">
                <span class="rental-badge ${rs.cls}">${rs.label}</span>
                <span class="badge badge-amber">👥 ${occ}/${loc.capacity}</span>
                <span class="badge badge-green">💸 €${parseFloat(loc.price || 0).toFixed(0)}</span>
            </div>
            
            ${toggleDetailsHtml(loc.id)}
            
            <div class="loc-card-details" id="details-${loc.id}">
                ${(loc.dateFrom || loc.dateTo || loc.isIndefinite) ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;">📅 ${fmtDate(loc.dateFrom)} → ${dateToFmt}${months ? ` &bull; ${months} m-cy &bull; <strong style="color:var(--accent);">€${totalCost.toFixed(2)}</strong>` : ''}</div>` : ''}
                <div class="loc-badges" style="margin-top:8px;">
                    ${loc.caregiver ? `<span class="caregiver-badge">👤 ${loc.caregiver}</span>` : ''}
                    <span class="badge badge-amber">👥 ${loc.capacity} miejsc</span>
                    <span class="badge badge-green">💸 €${parseFloat(loc.price || 0).toFixed(2)} <small>(~${fmtPLN(parseFloat(loc.price || 0) * eurToPln, 0)} PLN)</small></span>
                    ${loc.noticePeriod ? `<span class="badge" style="background:rgba(147,51,234,0.15); color:#a855f7; border:1px solid rgba(147,51,234,0.3);">⏳ ${loc.noticePeriod}</span>` : ''}
                    <span class="badge" style="background:rgba(232,98,26,0.1); color:var(--accent); border:1px solid rgba(232,98,26,0.2);">💰 Wydano: €${calcSpentSoFar(loc.dateFrom, loc.price).toFixed(2)}</span>
                </div>
                <div style="margin-top:8px; font-size:11px; color:var(--muted);">✍️ Dodane przez: <strong>${loc.addedBy || 'System'}</strong></div>
                ${loc.notes ? `<div style="margin-top:6px; font-size:11px; padding:6px; background:var(--bg); border-radius:6px; border-left:3px solid var(--accent);">📝 <em>${loc.notes}</em></div>` : ''}
                <div class="loc-people" style="margin-top:8px;"><div class="loc-people-title">Mieszkańcy</div>${people}</div>
            </div>
        </div>`;
    };

    const renderOfficeCard = (loc) => {
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');
        return `<div class="loc-card" id="card-${loc.id}" onclick="focusLoc('${loc.id}')" style="border-left:4px solid #a855f7;">
            <div class="loc-card-head"><div class="loc-name"><span style="font-size:10px; background:#a855f7; color:white; padding:1px 5px; border-radius:3px; margin-right:6px; vertical-align:middle; font-weight:800;">BIURO</span>${loc.name}</div><div class="loc-actions"><button class="act-btn edit" title="Edytuj" onclick="openEdit('${loc.id}',event)">✏️</button><button class="act-btn archive" title="Przenieś do archiwum" onclick="toggleArchiveLocation('${loc.id}', true, event)">📁</button><button class="act-btn del" title="Usuń" onclick="deleteLocation('${loc.id}',event)">🗑️</button></div></div>
            ${fullAddr ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">📍 ${fullAddr}</div>` : ''}
            <div class="loc-badges" style="margin-top:8px;"><span class="badge" style="background:rgba(168,85,247,0.15); color:#a855f7; border:1px solid rgba(168,85,247,0.3);">Biuro</span></div>
            
            ${toggleDetailsHtml(loc.id)}
            
            <div class="loc-card-details" id="details-${loc.id}">
                <div style="margin-top:8px; font-size:11px; color:var(--muted);">✍️ Dodane przez: <strong>${loc.addedBy || 'System'}</strong></div>
                ${loc.notes ? `<div style="margin-top:6px; font-size:11px; padding:6px; background:var(--bg); border-radius:6px; border-left:3px solid #a855f7;">📝 <em>${loc.notes}</em></div>` : ''}
            </div>
        </div>`;
    };

    let html = '';

    if (quarters.length > 0) {
        html += `
            <div class="list-section-header ${isQuartersCollapsed ? 'collapsed' : ''}" onclick="toggleSection('quarters')">
                <div class="list-section-title">🏠 Kwatery (${quarters.length})</div>
                <div class="list-section-arrow">▼</div>
            </div>
            <div class="list-section-content ${isQuartersCollapsed ? 'collapsed' : ''}">
                ${quarters.map(q => renderQuarterCard(q)).join('')}
            </div>
        `;
    }

    if (projects.length > 0) {
        html += `
            <div class="list-section-header ${isProjectsCollapsed ? 'collapsed' : ''}" onclick="toggleSection('projects')">
                <div class="list-section-title">🏭 Projekty (${projects.length})</div>
                <div class="list-section-arrow">▼</div>
            </div>
            <div class="list-section-content ${isProjectsCollapsed ? 'collapsed' : ''}">
                ${projects.map(p => renderProjectCard(p)).join('')}
            </div>
        `;
    }

    if (offices.length > 0) {
        html += `
            <div class="list-section-header ${isOfficesCollapsed ? 'collapsed' : ''}" onclick="toggleSection('offices')">
                <div class="list-section-title">🏢 Biura (${offices.length})</div>
                <div class="list-section-arrow">▼</div>
            </div>
            <div class="list-section-content ${isOfficesCollapsed ? 'collapsed' : ''}">
                ${offices.map(o => renderOfficeCard(o)).join('')}
            </div>
        `;
    }

    list.innerHTML = html;
}

function focusLoc(id) {
    focusLocation(id);
}

function toggleDetails(id, event) {
    event?.stopPropagation();
    const details = document.getElementById(`details-${id}`);
    const btn = event?.currentTarget;
    if (details) {
        const isActive = details.classList.toggle('active');
        if (btn) {
            btn.innerHTML = isActive ? '🔼 Zwiń' : '🔽 Rozwiń';
            btn.classList.toggle('active', isActive);
        }
    }
}

function toggleSidebarHeight() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}

function highlightCard(id) {
    const loc = locations.find(l => l.id === id);
    if (loc) {
        if (loc.type === 'project' && isProjectsCollapsed) {
            isProjectsCollapsed = false;
            renderList();
        } else if (loc.type !== 'project' && isQuartersCollapsed) {
            isQuartersCollapsed = false;
            renderList();
        }
    }

    document.querySelectorAll('.loc-card').forEach(c => c.classList.remove('selected'));
    const card = document.getElementById('card-' + id);
    if (card) {
        card.classList.add('selected');
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        if (!loc || !loc.isArchived) {
            switchTab('list');
        }
    }
}

function toggleArchiveLocation(id, shouldArchive, e) {
    e?.stopPropagation();
    const loc = locations.find(l => l.id === id);
    if (!loc) return;

    const actionText = shouldArchive ? 'przenieść do archiwum' : 'przywrócić z archiwum';
    const typeText = loc.type === 'project' ? 'projekt' : (loc.type === 'office' ? 'biuro' : 'kwaterę');
    
    if (!confirm(`Czy na pewno chcesz ${actionText} ${typeText} "${loc.name}"?`)) {
        return;
    }

    db.collection('locations').doc(id).update({
        isArchived: shouldArchive,
        archivedAt: shouldArchive ? firebase.firestore.FieldValue.serverTimestamp() : null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    }).then(() => {
        logActivity(
            shouldArchive ? 'Przeniesiono do archiwum' : 'Przywrócono z archiwum',
            `${loc.name} (${loc.type || 'location'})`
        );
        if (shouldArchive) {
            if (activeProjectId === id || activeQuarterId === id) {
                clearProjectFilter();
            }
        }
    }).catch(err => {
        alert("Błąd: " + err.message);
    });
}

function deleteLocation(id, e) {
    e?.stopPropagation();
    locToDelete = id;
    document.getElementById('confirmDeleteModal').classList.add('open');
}

function closeConfirmDelete() {
    locToDelete = null;
    document.getElementById('confirmDeleteModal').classList.remove('open');
}

document.getElementById('confirmDeleteBtn')?.addEventListener('click', () => {
    if (!locToDelete) return;
    const loc = locations.find(l => l.id === locToDelete);
    const locName = loc?.name || 'Nieznana';
    db.collection('locations').doc(locToDelete).update({ isDeleted: true })
        .then(() => {
            logActivity('Usunięto lokalizację', locName, loc);
            closeConfirmDelete();
        })
        .catch(err => {
            alert("Błąd usuwania: " + err.message);
            closeConfirmDelete();
        });
});

// ===== EDIT =====
let editPeople = [];

function openEdit(id, e) {
    e?.stopPropagation(); const loc = locations.find(l => l.id === id); if (!loc) return;
    editingId = id;
    map.setView([loc.lat, loc.lng], 15);
    if (markers[id]) markers[id].openPopup();
    document.getElementById('eName').value = loc.name || '';
    document.getElementById('eZip').value = loc.zip || '';
    document.getElementById('eCity').value = loc.city || '';
    document.getElementById('eStreet').value = loc.street || '';
    document.getElementById('eHouseNum').value = loc.houseNum || '';

    document.getElementById('eType').value = loc.type || 'location';
    if (currentUser === 'Admin') {
        document.getElementById('adminTypeField').style.display = 'block';
    } else {
        document.getElementById('adminTypeField').style.display = 'none';
    }

    toggleEditType();

    editLat = loc.lat;
    editLng = loc.lng;
    document.getElementById('eCoordDisplay').style.display = 'block';
    document.getElementById('eCoordTxt').textContent = editLat.toFixed(5) + ', ' + editLng.toFixed(5);
    document.getElementById('eNotes').value = loc.notes || '';

    document.getElementById('editModal').classList.add('open');
}

function addEditPerson() { editPeople.push({ name: '', isDriver: false, carPlate: '', carDesc: '', isWorking: true }); renderPeopleInputs('editPeopleList', editPeople, 'edit'); }

function toggleEditType() {
    const type = document.getElementById('eType').value;
    const loc = locations.find(l => l.id === editingId);
    if (!loc) return;

    if (type === 'project') {
        document.getElementById('eLocSpecificFields').style.display = 'none';
        document.getElementById('eProjSpecificFields').style.display = 'block';
        document.getElementById('eProjOccSearch').value = '';
        currentEditSelectedIds = [...(loc.linkedLocations || [])];
        renderLinkedLocations('eLinkedLocations', currentEditSelectedIds);
        currentEditSelectedIds.forEach(lid => updateMarkerHighlight(lid, true));

        const isProjArchived = !!loc.isArchived;
        const eProjRentalEndedCb = document.getElementById('eProjRentalEnded');
        if (eProjRentalEndedCb) eProjRentalEndedCb.checked = isProjArchived;
        const eProjNotesEl = document.getElementById('eProjNotes');
        if (eProjNotesEl) eProjNotesEl.value = loc.notes || '';
    } else {
        // location or office
        document.getElementById('eLocSpecificFields').style.display = 'block';
        document.getElementById('eProjSpecificFields').style.display = 'none';

        // Hide capacity and people for office
        const isOffice = (type === 'office');
        document.getElementById('eCapacitySection').style.display = isOffice ? 'none' : 'block';
        document.getElementById('ePeopleSection').style.display = isOffice ? 'none' : 'block';

        document.getElementById('eCapacity').value = loc.capacity || '';
        document.getElementById('ePrice').value = loc.price || 0;
        document.getElementById('eCaregiver').value = loc.caregiver || '';
        document.getElementById('eNoticePeriod').value = loc.noticePeriod || '';
        document.getElementById('eDateFrom').value = loc.dateFrom || '';
        document.getElementById('eDateTo').value = loc.dateTo || '';
        const isIndef = !!loc.isIndefinite;
        document.getElementById('eIndefinite').checked = isIndef;
        document.getElementById('eDateTo').disabled = isIndef;

        const isRentalEnded = !!loc.isArchived;
        const eRentalEndedCb = document.getElementById('eRentalEnded');
        if (eRentalEndedCb) eRentalEndedCb.checked = isRentalEnded;

        editPeople = (loc.people || []).map(p => {
            if (typeof p === 'string') return { name: p, isDriver: false, carPlate: '', carDesc: '', isWorking: true };
            return { carPlate: '', carDesc: '', isWorking: true, ...p };
        });
        renderPeopleInputs('editPeopleList', editPeople, 'edit');
        updateEditTotalCost();
    }
}

function saveEdit() {
    const type = document.getElementById('eType').value;
    const name = document.getElementById('eName').value.trim();
    const zip = document.getElementById('eZip').value.trim();
    const city = document.getElementById('eCity').value.trim();
    const street = document.getElementById('eStreet').value.trim();
    const houseNum = document.getElementById('eHouseNum').value.trim();

    if (!name) { alert('Wypełnij nazwę.'); return; }

    const updatedData = {
        name, zip, city, street, houseNum,
        lat: editLat, lng: editLng,
        type: type, // Record the type!
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    const oldLoc = locations.find(l => l.id === editingId);
    const diffs = [];
    if (oldLoc) {
        if ((oldLoc.name || '') !== name) diffs.push(`Nazwa: "${oldLoc.name || ''}" ➔ "${name}"`);
        if ((oldLoc.type || '') !== type) diffs.push(`Typ: "${oldLoc.type || ''}" ➔ "${type}"`);
        if ((oldLoc.zip || '') !== zip) diffs.push(`Kod pocztowy: "${oldLoc.zip || ''}" ➔ "${zip}"`);
        if ((oldLoc.city || '') !== city) diffs.push(`Miejscowość: "${oldLoc.city || ''}" ➔ "${city}"`);
        if ((oldLoc.street || '') !== street) diffs.push(`Ulica: "${oldLoc.street || ''}" ➔ "${street}"`);
        if ((oldLoc.houseNum || '') !== houseNum) diffs.push(`Nr domu: "${oldLoc.houseNum || ''}" ➔ "${houseNum}"`);
    }

    if (type === 'location' || type === 'office') {
        const capacity = parseInt(document.getElementById('eCapacity').value) || 0;
        const price = parseFloat(document.getElementById('ePrice').value);
        if (isNaN(price)) { alert('Wypełnij cenę.'); return; }

        const caregiver = document.getElementById('eCaregiver').value;
        const noticePeriod = document.getElementById('eNoticePeriod').value;
        const dateFrom = document.getElementById('eDateFrom').value;
        const dateTo = document.getElementById('eDateTo').value;
        const isIndefinite = document.getElementById('eIndefinite').checked;
        const isArchived = document.getElementById('eRentalEnded')?.checked || false;
        const notes = document.getElementById('eNotes').value.trim();

        if (oldLoc) {
            if ((oldLoc.capacity || 0) !== capacity) diffs.push(`Miejsca: ${oldLoc.capacity || 0} ➔ ${capacity}`);
            if (parseFloat(oldLoc.price || 0) !== price) diffs.push(`Cena: €${parseFloat(oldLoc.price || 0)} ➔ €${price}`);
            if ((oldLoc.caregiver || '') !== caregiver) diffs.push(`Opiekun: "${oldLoc.caregiver || ''}" ➔ "${caregiver}"`);
            if ((oldLoc.noticePeriod || '') !== noticePeriod) diffs.push(`Wypowiedzenie: "${oldLoc.noticePeriod || ''}" ➔ "${noticePeriod}"`);
            if ((oldLoc.dateFrom || '') !== dateFrom) diffs.push(`Od: "${oldLoc.dateFrom || ''}" ➔ "${dateFrom}"`);
            if ((oldLoc.dateTo || '') !== dateTo) diffs.push(`Do: "${oldLoc.dateTo || ''}" ➔ "${dateTo}"`);
            if (!!oldLoc.isIndefinite !== isIndefinite) diffs.push(`Czas nieokreślony: ${!!oldLoc.isIndefinite} ➔ ${isIndefinite}`);
            if (!!oldLoc.isArchived !== isArchived) diffs.push(`Zarchiwizowany: ${!!oldLoc.isArchived} ➔ ${isArchived}`);
            if ((oldLoc.notes || '') !== notes) diffs.push(`Uwagi: "${oldLoc.notes || ''}" ➔ "${notes}"`);
            
            // Compare people list
            const oldPeople = oldLoc.people || [];
            const newPeople = [...editPeople].filter(p => p.name.trim());
            const oldPeopleStr = oldPeople.map(p => {
                if (typeof p === 'string') return p;
                const driver = p.isDriver ? ' (kierowca)' : '';
                return p.name + driver;
            }).join(', ');
            const newPeopleStr = newPeople.map(p => {
                const driver = p.isDriver ? ' (kierowca)' : '';
                return p.name + driver;
            }).join(', ');
            
            if (oldPeopleStr !== newPeopleStr) {
                diffs.push(`Mieszkańcy: [${oldPeopleStr || 'brak'}] ➔ [${newPeopleStr || 'brak'}]`);
            }
        }

        Object.assign(updatedData, {
            capacity, price, caregiver, noticePeriod, dateFrom, dateTo, isIndefinite, isArchived,
            people: [...editPeople].filter(p => p.name.trim()),
            notes
        });
    } else if (type === 'project') {
        const linkedLocations = getEditSelectedLinkedLocations();
        const isArchived = document.getElementById('eProjRentalEnded')?.checked || false;
        const notes = (document.getElementById('eProjNotes')?.value || '').trim();

        if (oldLoc) {
            const oldLinked = oldLoc.linkedLocations || [];
            const getLinkedNames = (ids) => ids.map(id => {
                const l = locations.find(x => x.id === id);
                return l ? l.name : id;
            }).join(', ');
            const oldLinkedStr = getLinkedNames(oldLinked);
            const newLinkedStr = getLinkedNames(linkedLocations);
            if (oldLinkedStr !== newLinkedStr) {
                diffs.push(`Przypisane lokalizacje: [${oldLinkedStr || 'brak'}] ➔ [${newLinkedStr || 'brak'}]`);
            }
            if (!!oldLoc.isArchived !== isArchived) {
                diffs.push(`Zarchiwizowany projekt: ${!!oldLoc.isArchived} ➔ ${isArchived}`);
            }
            if ((oldLoc.notes || '') !== notes) {
                diffs.push(`Uwagi: "${oldLoc.notes || ''}" ➔ "${notes}"`);
            }
        }
        Object.assign(updatedData, { linkedLocations, isArchived, notes });
    }

    db.collection('locations').doc(editingId).update(updatedData)
        .then(() => {
            logActivity('Edytowano lokalizację', name, null, diffs);
            closeEdit();
        })
        .catch(err => alert("Błąd edycji: " + err.message));
}

function closeEdit() {
    editingId = null;
    document.getElementById('editModal').classList.remove('open');
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
    clearAllMarkerHighlights();
}

// ===== STATS =====
function renderStats() {
    const activeLocations = locations.filter(l => !l.isArchived);
    const offices = activeLocations.filter(l => 
        (l.type && l.type.toLowerCase() === 'office') || 
        (l.name && l.name.toLowerCase().includes('biuro'))
    );
    const projects = activeLocations.filter(l => 
        (l.type && l.type.toLowerCase() === 'project') && 
        !(l.name && l.name.toLowerCase().includes('biuro'))
    );
    const quarters = activeLocations.filter(l => !offices.includes(l) && !projects.includes(l));

    let totalWorking = 0;
    let totalNotWorking = 0;
    let totalOccupants = 0;
    
    activeLocations.forEach(loc => {
        if (loc.type === 'project') return;
        if (loc.people && loc.people.length > 0) {
            loc.people.forEach(p => {
                totalOccupants++;
                if (typeof p === 'object' && p.isWorking === false) {
                    totalNotWorking++;
                } else {
                    totalWorking++;
                }
            });
        }
    });

    const totalCapacity = quarters.reduce((s, l) => s + (Number(l.capacity) || 0), 0);
    const quartersCost = quarters.reduce((s, l) => s + (Number(l.price) || 0), 0);
    const officesCost = offices.reduce((s, l) => s + (Number(l.price) || 0), 0);
    const avgCostPerPerson = totalOccupants > 0 ? (quartersCost / totalOccupants) : 0;

    const statsGrid = document.getElementById('statsGrid');
    if (statsGrid) {
        statsGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
        statsGrid.innerHTML = `
            <div class="stat-card" style="border-top: 4px solid var(--accent);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <div class="stat-val">${totalOccupants}</div>
                        <div class="stat-lbl">Mieszkańcy (Suma)</div>
                    </div>
                    <div style="background:rgba(232,98,26,0.1); padding:8px; border-radius:10px; font-size:20px;">👥</div>
                </div>
                <div style="margin-top:12px; display:flex; gap:10px; font-size:11px;">
                    <span style="color:var(--success);">● ${totalWorking} Pracujących</span>
                    <span style="color:var(--danger);">● ${totalNotWorking} Niepracujących</span>
                </div>
            </div>
            
            <div class="stat-card" style="border-top: 4px solid var(--success);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <div class="stat-val" style="color:var(--success);">${totalCapacity - totalOccupants}</div>
                        <div class="stat-lbl">Wolne miejsca</div>
                    </div>
                    <div style="background:rgba(16,185,129,0.1); padding:8px; border-radius:10px; font-size:20px;">🏠</div>
                </div>
                <div style="margin-top:12px; height:4px; background:var(--bg); border-radius:2px; overflow:hidden;">
                    <div style="height:100%; width:${(totalOccupants / (totalCapacity || 1) * 100).toFixed(0)}%; background:var(--success);"></div>
                </div>
                <div style="margin-top:6px; font-size:10px; color:var(--muted);">Obłożenie: ${(totalOccupants / (totalCapacity || 1) * 100).toFixed(1)}%</div>
            </div>

            <div class="stat-card" style="border-top: 4px solid var(--blue);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <div class="stat-val" style="color:var(--blue);">€${quartersCost.toFixed(0)}</div>
                        <div class="stat-lbl">Koszty kwater</div>
                    </div>
                    <div style="background:rgba(59,130,246,0.1); padding:8px; border-radius:10px; font-size:20px;">💶</div>
                </div>
                <div style="margin-top:8px; font-size:12px; color:var(--accent2); font-weight:800;">~ ${fmtPLN(quartersCost * eurToPln, 0)} PLN</div>
                <div style="margin-top:10px; border-top:1px dashed var(--border); padding-top:8px; font-size:10px; color:var(--muted); display:flex; justify-content:space-between;">
                    <span>🏢 Biura:</span>
                    <span>€${officesCost.toFixed(2)} (${fmtPLN(officesCost * eurToPln, 0)} PLN)</span>
                </div>
            </div>

            <div class="stat-card" style="border-top: 4px solid var(--accent2);">
                <div style="display:flex; justify-content:space-between; align-items:flex-start;">
                    <div>
                        <div class="stat-val" style="color:var(--accent2);">€${avgCostPerPerson.toFixed(2)}</div>
                        <div class="stat-lbl">Koszt / 1 osobę</div>
                    </div>
                    <div style="background:rgba(251,191,36,0.1); padding:8px; border-radius:10px; font-size:20px;">📊</div>
                </div>
                <div style="margin-top:8px; font-size:12px; color:var(--muted);">Średni koszt utrzymania mieszkańca</div>
            </div>
        `;
    }
    const details = document.getElementById('statsDetails');
    if (!details) return;
    if (!locations.length) { details.innerHTML = '<div class="empty-state">...</div>'; return; }
    const visibleLocs = [...quarters, ...offices].sort((a, b) => {
        if (a.type === b.type) return (a.locNumber || 0) - (b.locNumber || 0);
        return a.type === 'office' ? -1 : 1; // Offices first or vice versa? Let's stay flexible
    });

    details.innerHTML = visibleLocs.map(loc => {
        const isOffice = loc.type === 'office';
        const occ = loc.people ? loc.people.length : 0;
        const cap = Number(loc.capacity) || 0;
        const pct = cap > 0 ? Math.round(occ / cap * 100) : 0;
        const price = parseFloat(loc.price || 0);
        const perPerson = occ > 0 ? (price / occ) : 0;

        return `<div style="background:var(--card2); border:1px solid ${isOffice ? '#a855f7' : 'var(--border)'}; border-radius:12px; padding:12px; margin-bottom:10px;">
            <div style="font-size:13px; font-weight:700; display:flex; justify-content:space-between;">
                <span>${isOffice ? '🏢' : '🏠'} ${loc.name}</span>
                <span style="color:var(--muted); font-size:11px;">${isOffice ? 'BIURO' : '#' + (loc.locNumber || '?')}</span>
            </div>
            ${!isOffice ? `
            <div style="font-size:11px; color:var(--muted); margin-top:4px;">Zajętość: ${occ}/${loc.capacity} (${pct}%)</div>
            <div style="height:6px; background:var(--bg); border-radius:3px; overflow:hidden; margin:8px 0;">
                <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, var(--accent), var(--accent2));"></div>
            </div>
            ` : `<div style="margin:12px 0;"></div>`}
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:12px; padding-top:10px; border-top:1px solid var(--border);">
                <div>
                    <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Koszt miesięczny:</div>
                    <div style="font-size:14px; color:${isOffice ? '#a855f7' : 'var(--accent)'}; font-weight:800;">€${price.toFixed(2)}</div>
                    <div style="font-size:11px; color:var(--muted); font-weight:600;">~${fmtPLN(price * eurToPln, 0)} PLN</div>
                </div>
                ${!isOffice ? (occ > 0 ? `
                <div style="border-left:1px dashed var(--border); padding-left:10px;">
                    <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Na 1 osobę:</div>
                    <div style="font-size:14px; color:var(--success); font-weight:800;">€${perPerson.toFixed(2)}</div>
                    <div style="font-size:11px; color:var(--muted); font-weight:600;">~${fmtPLN(perPerson * eurToPln, 0)} PLN</div>
                </div>
                ` : `
                <div style="border-left:1px dashed var(--border); padding-left:10px; display:flex; align-items:center;">
                    <span style="font-size:10px; color:var(--danger); font-style:italic;">Brak lokatorów</span>
                </div>
                `) : `
                <div style="border-left:1px dashed var(--border); padding-left:10px;">
                    <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Typ:</div>
                    <div style="font-size:12px; color:var(--text); font-weight:600;">Biuro firmowe</div>
                </div>
                `}
            </div>
            <button onclick="focusLocation('${loc.id}')" style="width:100%; margin-top:12px; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:8px; font-size:11px; cursor:pointer; font-weight:600; transition:all 0.2s;">
                📍 Pokaż na mapie
            </button>
        </div>`;
    }).join('');
}

async function downloadExcelReport() {
    if (typeof ExcelJS === 'undefined') {
        alert("Błąd: Biblioteka ExcelJS nie została załadowana.");
        return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Raport');

    // Kolumny
    worksheet.columns = [
        { header: 'Podmiot wynajmujący', key: 'podmiot', width: 40 },
        { header: 'Przedmiot umowy', key: 'przedmiot', width: 50 },
        { header: 'Miesięczna opłata w PLN', key: 'oplata', width: 25 },
        { header: 'waluta zobowiązania', key: 'waluta', width: 20 },
        { header: 'termin obowiązywania', key: 'termin', width: 30 },
        { header: 'okres wypowiedzenia', key: 'okres', width: 25 }
    ];

    // Styl nagłówka
    const headerRow = worksheet.getRow(1);
    headerRow.height = 30;
    headerRow.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE8621A' } // Kolor VanStev Orange
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
    });

    const rawQuarters = locations.filter(l => l.type !== 'project' && !l.isArchived);
    const quartersRows = rawQuarters.filter(l => l.type !== 'office' && !(l.name && l.name.toUpperCase().includes('VANSTEV - BIURO'))).sort((a, b) => (a.locNumber || 0) - (b.locNumber || 0));
    const officesRows = rawQuarters.filter(l => l.type === 'office' || (l.name && l.name.toUpperCase().includes('VANSTEV - BIURO'))).sort((a, b) => a.name.localeCompare(b.name));
    
    const allItems = [...quartersRows, ...officesRows];

    allItems.forEach(loc => {
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');
        const dateToFmt = loc.isIndefinite ? 'Nieokreślony' : fmtDate(loc.dateTo);
        const term = (loc.dateFrom || loc.dateTo || loc.isIndefinite) ? `${fmtDate(loc.dateFrom)} - ${dateToFmt}` : '—';
        const isOffice = loc.type === 'office' || (loc.name && loc.name.toUpperCase().includes('VANSTEV - BIURO'));
        
        const rowData = {
            podmiot: "VAN STEV Sp. z o.o. sp. k.",
            przedmiot: isOffice ? `Biuro: ${fullAddr}` : `Kwatera: ${fullAddr}`,
            oplata: parseFloat((parseFloat(loc.price || 0) * eurToPln).toFixed(2)),
            waluta: "PLN",
            termin: term,
            okres: loc.noticePeriod || '—'
        };

        const row = worksheet.addRow(rowData);
        row.height = 25; // Wyższe wiersze (odstępy)
        row.eachCell((cell) => {
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFEEEEEE' } },
                left: { style: 'thin', color: { argb: 'FFEEEEEE' } },
                bottom: { style: 'thin', color: { argb: 'FFEEEEEE' } },
                right: { style: 'thin', color: { argb: 'FFEEEEEE' } }
            };
        });
    });

    // Eksport pliku
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const dateStr = new Date().toISOString().split('T')[0];
    anchor.download = `Raport_VanStev_${dateStr}.xlsx`;
    anchor.click();
    window.URL.revokeObjectURL(url);

    logActivity('Wygenerowano raport Excel (ExcelJS)', anchor.download);
}

async function downloadLocExcelReport() {
    if (typeof ExcelJS === 'undefined') {
        alert("Błąd: Biblioteka ExcelJS nie została załadowana.");
        return;
    }

    const rawQuarters = locations.filter(l => l.type !== 'project' && !l.isArchived);
    const quartersRows = rawQuarters.filter(l => l.type !== 'office' && !(l.name && l.name.toUpperCase().includes('VANSTEV - BIURO'))).sort((a, b) => (a.locNumber || 0) - (b.locNumber || 0));
    const officesRows = rawQuarters.filter(l => l.type === 'office' || (l.name && l.name.toUpperCase().includes('VANSTEV - BIURO'))).sort((a, b) => a.name.localeCompare(b.name));
    const allItems = [...quartersRows, ...officesRows];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Raport Szczegółowy');

    // Force gridlines to be visible
    worksheet.views = [{ showGridLines: true }];

    worksheet.columns = [
        { header: 'LP', key: 'lp', width: 8 },
        { header: 'KWATERA', key: 'name', width: 50 },
        { header: 'PROJEKT', key: 'project', width: 25 },
        { header: 'ZAJĘTOŚĆ', key: 'occ', width: 15 },
        { header: 'MIESZKAŃCY', key: 'people', width: 65 },
        { header: 'KOSZT MIES.', key: 'price', width: 20 },
        { header: 'KOSZT / OS.', key: 'perPerson', width: 20 }
    ];

    const headerRow = worksheet.getRow(1);
    headerRow.height = 30;
    headerRow.font = { name: 'Segoe UI', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.eachCell((cell, colNumber) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8621A' } }; // Orange header color to match PDF
        
        let alignment = { vertical: 'middle', horizontal: 'left' };
        if (colNumber === 1 || colNumber === 4) { // LP, ZAJĘTOŚĆ
            alignment.horizontal = 'center';
        } else if (colNumber === 6 || colNumber === 7) { // KOSZT MIES., KOSZT / OS.
            alignment.horizontal = 'right';
        }
        cell.alignment = alignment;
        
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFE8621A' } },
            left: { style: 'thin', color: { argb: 'FFE8621A' } },
            bottom: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            right: { style: 'thin', color: { argb: 'FFE8621A' } }
        };
    });

    allItems.forEach((loc, index) => {
        const occ = loc.people ? loc.people.length : 0;
        const peopleList = loc.people && loc.people.length > 0 ?
            loc.people.map(p => {
                const name = typeof p === 'string' ? p : p.name;
                const driver = (typeof p !== 'string' && p.isDriver) ? ' (K)' : '';
                const plate = (typeof p !== 'string' && p.carPlate) ? ` [${p.carPlate}]` : '';
                const vDays = (typeof p !== 'string') ? getVacationDaysLeft(p.vacationEnd) : 0;
                const sDays = (typeof p !== 'string') ? getSickLeaveDaysLeft(p.sickLeaveEnd) : 0;
                let statusText = '';
                if (vDays > 0) statusText = ` 🌴 (U: ${vDays}d)`;
                else if (sDays > 0) statusText = ` 🏥 (CH: ${sDays}d)`;
                return `• ${name}${driver}${plate}${statusText}`;
            }).join('\n') : 'Brak';

        const project = locations.find(p => p.type === 'project' && (p.linkedLocations || []).includes(loc.id));
        const isOffice = loc.type === 'office' || (loc.name && loc.name.toUpperCase().includes('VANSTEV - BIURO'));
        const projectName = isOffice ? 'BIURO' : (project ? project.name : '—');
        
        const price = parseFloat(loc.price || 0);
        const perPerson = occ > 0 ? (price / occ) : 0;
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');

        const row = worksheet.addRow({
            lp: loc.locNumber || (index + 1),
            name: `${loc.name}\n${fullAddr}`,
            project: projectName,
            occ: `${occ} / ${loc.capacity}`,
            people: peopleList,
            price: `€${price.toFixed(2)}`,
            perPerson: `€${perPerson.toFixed(2)}`
        });

        row.eachCell((cell, colNumber) => {
            cell.font = { name: 'Segoe UI', size: 10 };
            
            // Clean modern borders (light gray)
            cell.border = {
                top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
            };

            // Custom column alignment
            let alignment = { vertical: 'middle', horizontal: 'left' };
            if (colNumber === 1 || colNumber === 4) { // LP, ZAJĘTOŚĆ
                alignment.horizontal = 'center';
            } else if (colNumber === 6 || colNumber === 7) { // KOSZT MIES., KOSZT / OS.
                alignment.horizontal = 'right';
                if (colNumber === 7) {
                    // Make cost per person bold and green, exactly like the PDF styling
                    cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF10B981' } };
                }
            } else if (colNumber === 2 || colNumber === 5) { // KWATERA, MIESZKAŃCY
                alignment.wrapText = true;
            }
            cell.alignment = alignment;

            // Office rows highlighted with pink background to match PDF row style
            if (isOffice) {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF2F8' } };
            }
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    const now = new Date();
    anchor.download = `Raport_Szczegolowy_${now.toISOString().split('T')[0]}.xlsx`;
    anchor.click();
    window.URL.revokeObjectURL(url);
}

async function downloadLocReport() {
    if (!window.html2pdf) {
        alert("Błąd: Nie można załadować biblioteki PDF. Sprawdź połączenie z internetem.");
        return;
    }

    const rawQuarters = locations.filter(l => l.type !== 'project' && !l.isArchived);
    const quartersRows = rawQuarters.filter(l => l.type !== 'office' && !(l.name && l.name.toUpperCase().includes('VANSTEV - BIURO'))).sort((a, b) => (a.locNumber || 0) - (b.locNumber || 0));
    const officesRows = rawQuarters.filter(l => l.type === 'office' || (l.name && l.name.toUpperCase().includes('VANSTEV - BIURO'))).sort((a, b) => a.name.localeCompare(b.name));
    
    const allItems = [...quartersRows, ...officesRows];

    const now = new Date();
    const dateStr = now.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

    // Budowanie kontentu HTML raportu
    let rowsHtml = allItems.map(loc => {
        const occ = loc.people ? loc.people.length : 0;
        const peopleListHtml = loc.people && loc.people.length > 0 ?
            loc.people.map(p => {
                const name = typeof p === 'string' ? p : p.name;
                const driver = (typeof p !== 'string' && p.isDriver) ? ' <b>(K)</b>' : '';
                const plate = (typeof p !== 'string' && p.carPlate) ? ` [${p.carPlate}]` : '';
                const car = (typeof p !== 'string' && p.carDesc) ? ` (${p.carDesc})` : '';
                const vDays = (typeof p !== 'string') ? getVacationDaysLeft(p.vacationEnd) : 0;
                const sDays = (typeof p !== 'string') ? getSickLeaveDaysLeft(p.sickLeaveEnd) : 0;
                let statusText = '';
                if (vDays > 0) statusText = ` 🌴 (U: ${vDays}d)`;
                else if (sDays > 0) statusText = ` 🏥 (CH: ${sDays}d)`;
                return `<div>• ${name}${driver}${plate}${car}${statusText}</div>`;
            }).join('') : '<i style="color:#999;">Brak mieszkańców</i>';

        const project = locations.find(p => p.type === 'project' && (p.linkedLocations || []).includes(loc.id));
        const isOffice = loc.type === 'office' || (loc.name && loc.name.toUpperCase().includes('VANSTEV - BIURO'));
        const projectName = isOffice ? 'BIURO' : (project ? project.name : '—');
        const price = parseFloat(loc.price || 0);
        const perPerson = occ > 0 ? (price / occ).toFixed(2) : '0.00';

        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');

        const rowStyle = isOffice ? 'background:#fdf2f8;' : '';

        return `
            <tr style="border-bottom:1px solid #eee; ${rowStyle}">
                <td style="padding:10px; border-bottom:1px solid #eee;">
                    <span style="font-weight:700;">#${loc.locNumber || '?'} ${loc.name}</span><br>
                    <span style="font-size:10px; color:#444; display:inline-block; margin-top:3px;">📍 ${fullAddr || 'Brak danych adresowych'}</span>
                </td>
                <td style="padding:10px; border-bottom:1px solid #eee;">${projectName}</td>
                <td style="padding:10px; text-align:center; border-bottom:1px solid #eee;">${occ} / ${loc.capacity}</td>
                <td style="padding:10px; border-bottom:1px solid #eee;">${peopleListHtml}</td>
                <td style="padding:10px; text-align:right; border-bottom:1px solid #eee;">€${price.toFixed(2)}</td>
                <td style="padding:10px; text-align:right; color:#10b981; font-weight:700; border-bottom:1px solid #eee;">€${perPerson}</td>
            </tr>
        `;
    }).join('');

    const reportHtml = `
        <div style="padding:40px; font-family:'Inter', sans-serif; color:#333; line-height:1.4;">
            <style>
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;800&display=swap');
                table { page-break-inside:auto; width: 100%; border-collapse: collapse; }
                tr { page-break-inside:avoid; page-break-after:auto; }
                td, th { page-break-inside:avoid; }
                thead { display:table-header-group; }
                tfoot { display:table-footer-group; }
            </style>
            <div style="display:flex; justify-content:space-between; align-items:flex-end; border-bottom:3px solid #E8621A; padding-bottom:15px; margin-bottom:20px;">
                <div>
                    <h1 style="color:#E8621A; margin:0; font-size:24px; font-weight:800; text-transform:uppercase;">Raport Zakwaterowań</h1>
                    <div style="font-size:12px; color:#666; margin-top:5px;">System zarządzania VanStev</div>
                </div>
                <div style="text-align:right; font-size:12px; color:#666;">
                    Wydrukowano: <b>${dateStr}</b>
                </div>
            </div>

            <table style="width:100%; border-collapse:collapse; font-size:11px;">
                <thead>
                    <tr style="background:#E8621A; color:white;">
                        <th style="padding:10px; text-align:left;">KWATERA</th>
                        <th style="padding:10px; text-align:left;">PROJEKT</th>
                        <th style="padding:10px; text-align:center;">ZAJĘTOŚĆ</th>
                        <th style="padding:10px; text-align:left;">MIESZKAŃCY</th>
                        <th style="padding:10px; text-align:right;">KOSZT MIES.</th>
                        <th style="padding:10px; text-align:right;">KOSZT / OS.</th>
                    </tr>
                </thead>
                <tbody style="border-bottom:1px solid #eee;">
                    ${rowsHtml}
                </tbody>
            </table>

            <div style="margin-top:20px; padding-top:15px; border-top:1px solid #eee; display:flex; justify-content:space-between; font-size:10px; color:#777;">
                <div><b>LEGENDA:</b> (K) = Kierowca | 🌴 (U) = Urlop | 🏥 (CH) = Chorobowe</div>
                <div>Strona 1 z 1</div>
            </div>
        </div>
    `;

    const opt = {
        margin: [10, 10, 10, 10], // Marginesy w mm: góra, lewo, dół, prawo
        filename: `Raport_VanStev_${now.toISOString().split('T')[0]}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };

    // Konwersja na PDF
    html2pdf().from(reportHtml).set(opt).save().then(() => {
        logActivity('Wygenerowano raport PDF (HTML2PDF)', opt.filename);
    });
}

// ===== TABS =====
function switchTab(tab) {
    ['list', 'add', 'stats', 'archive'].forEach(t => {
        const panel = document.getElementById('panel' + t.charAt(0).toUpperCase() + t.slice(1));
        const tabEl = document.getElementById('tab' + t.charAt(0).toUpperCase() + t.slice(1));
        if (panel) panel.classList.remove('active');
        if (tabEl) tabEl.classList.remove('active');
    });
    const activePanel = document.getElementById('panel' + tab.charAt(0).toUpperCase() + tab.slice(1));
    const activeTab = document.getElementById('tab' + tab.charAt(0).toUpperCase() + tab.slice(1));
    if (activePanel) activePanel.classList.add('active');
    if (activeTab) activeTab.classList.add('active');
    if (tab === 'admin') openAdmin();
    if (tab === 'archive') renderArchive();
}

function calcArchiveCost(loc) {
    const price = parseFloat(loc.price || 0);
    if (!loc.dateFrom) return 0;
    const end = loc.dateTo ? new Date(loc.dateTo) : new Date();
    const start = new Date(loc.dateFrom);
    const days = (end - start) / 86400000;
    if (days <= 0) return 0;
    const months = days / 30;
    return months * price;
}

function renderArchive() {
    const list = document.getElementById('archiveList');
    const empty = document.getElementById('emptyArchiveState');
    const count = document.getElementById('archiveCount');
    const q = (document.getElementById('archiveSearch')?.value || '').trim().toLowerCase();

    let archived = locations.filter(l => l.isArchived === true);

    if (q) {
        archived = archived.filter(loc => {
            if ((loc.name || '').toLowerCase().includes(q)) return true;
            if ((loc.street || '').toLowerCase().includes(q)) return true;
            if ((loc.city || '').toLowerCase().includes(q)) return true;
            if ((loc.zip || '').toLowerCase().includes(q)) return true;
            if ((loc.notes || '').toLowerCase().includes(q)) return true;
            if (loc.people && loc.people.some(p => {
                const name = (typeof p === 'string' ? p : p.name || '').toLowerCase();
                return name.includes(q);
            })) return true;
            if (loc.type === 'project' && loc.linkedLocations) {
                return loc.linkedLocations.some(id => {
                    const l = locations.find(x => x.id === id);
                    return l && l.name.toLowerCase().includes(q);
                });
            }
            return false;
        });
    }

    archived.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    if (count) {
        count.textContent = archived.length + ' ' + (archived.length === 1 ? 'pozycja' : (archived.length >= 2 && archived.length <= 4) ? 'pozycje' : 'pozycji') + ' w archiwum';
    }

    if (!archived.length) {
        if (list) list.innerHTML = '';
        if (empty) {
            empty.style.display = 'block';
            const emptyTxt = empty.querySelector('.empty-txt');
            if (emptyTxt) emptyTxt.textContent = q ? 'Brak wyników pasujących do wyszukiwania w archiwum.' : 'Brak zarchiwizowanych projektów i kwater.';
        }
        return;
    }
    if (empty) empty.style.display = 'none';

    const houseIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px; color: var(--muted);"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;

    const toggleDetailsHtml = (id) => {
        return `<button class="expand-btn" onclick="toggleDetails('${id}', event)">
            🔽 Rozwiń
        </button>`;
    };

    if (list) {
        list.innerHTML = archived.map(loc => {
            const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');

            if (loc.type === 'project') {
                const linkedNames = (loc.linkedLocations || [])
                    .map(id => locations.find(x => x.id === id))
                    .filter(l => l)
                    .map(l => `<span class="person-chip" style="border-radius:4px; border-color:var(--muted); color:var(--muted); font-size:11px;">[#${l.locNumber || '?'}] ${l.name}</span>`)
                    .join('');

                return `<div class="loc-card archived-card" id="card-${loc.id}" onclick="focusLocation('${loc.id}')" style="border-left: 4px solid var(--muted); opacity: 0.85;">
                    <div class="loc-card-head">
                        <div class="loc-name" style="color: var(--muted);"><span style="font-size:10px; background:var(--muted); color:white; padding:1px 5px; border-radius:3px; margin-right:6px; vertical-align:middle; font-weight:800;">PROJEKT</span>${loc.name} <span style="font-size:10px; background:var(--muted); color:var(--bg); padding:2px 6px; border-radius:10px; margin-left:6px; font-weight:bold;">ARCHIWUM</span></div>
                        <div class="loc-actions">
                            <button class="act-btn edit" title="Edytuj" onclick="openEdit('${loc.id}',event)">✏️</button>
                            <button class="act-btn restore" title="Przywróć do aktywnych projektów" onclick="toggleArchiveLocation('${loc.id}', false, event)">↩️</button>
                            <button class="act-btn del" title="Usuń" onclick="deleteLocation('${loc.id}',event)">🗑️</button>
                        </div>
                    </div>
                    ${fullAddr ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">📍 ${fullAddr}</div>` : ''}
                    <div class="loc-badges" style="margin-top:8px;"><span class="badge" style="background:rgba(100,116,139,0.15); color:var(--muted); border:1px solid rgba(100,116,139,0.3);">Zakończony projekt</span></div>
                    
                    ${toggleDetailsHtml(loc.id)}
                    
                    <div class="loc-card-details" id="details-${loc.id}">
                        <div style="margin-top:8px; font-size:11px; color:var(--muted);">✍️ Dodane przez: <strong>${loc.addedBy || 'System'}</strong></div>
                        ${loc.notes ? `<div style="margin-top:6px; font-size:11px; padding:6px; background:var(--bg); border-radius:6px; border-left:3px solid var(--muted);">📝 <em>${loc.notes}</em></div>` : ''}
                        <div class="loc-people" style="margin-top:8px;"><div class="loc-people-title" style="color:var(--muted);">Przypisane lokalizacje</div>${linkedNames || '<span style="color:var(--muted);font-size:12px;">Brak</span>'}</div>
                    </div>
                </div>`;
            }

            const numPrefix = loc.locNumber ? `<span style="color:var(--muted); font-size:13px; font-weight:normal;">[#${loc.locNumber}]</span> ` : '';
            const dateFromStr = fmtDate(loc.dateFrom);
            const dateToStr = loc.isIndefinite ? 'Nieokreślony' : fmtDate(loc.dateTo);
            const cost = calcArchiveCost(loc);
            const isOffice = loc.type === 'office';

            return `<div class="loc-card archived-card" id="card-${loc.id}" onclick="focusLocation('${loc.id}')" style="border-left: 4px solid var(--muted); opacity: 0.85;">
                <div class="loc-card-head">
                    <div class="loc-name" style="color: var(--muted);">${isOffice ? '🏢' : houseIcon} ${numPrefix}${loc.name} <span style="font-size:10px; background:var(--muted); color:var(--bg); padding:2px 6px; border-radius:10px; margin-left:6px; font-weight:bold;">ARCHIWUM</span></div>
                    <div class="loc-actions">
                        <button class="act-btn edit" title="Edytuj" onclick="openEdit('${loc.id}',event)">✏️</button>
                        <button class="act-btn restore" title="Przywróć do aktywnych" onclick="toggleArchiveLocation('${loc.id}', false, event)">↩️</button>
                        <button class="act-btn del" title="Usuń" onclick="deleteLocation('${loc.id}',event)">🗑️</button>
                    </div>
                </div>
                ${fullAddr ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">📍 ${fullAddr}</div>` : ''}
                <div style="margin-top:10px; padding:10px; background:var(--bg); border-radius:8px; border:1px solid var(--border); font-size:12px; display:flex; flex-direction:column; gap:6px;">
                    <div>📅 <strong>Okres wynajmu:</strong> ${dateFromStr} — ${dateToStr}</div>
                    <div>💰 <strong>Koszt całkowity:</strong> <strong style="color:var(--accent);">€${cost.toFixed(2)}</strong> <span style="color:var(--muted); font-size:11px;">(~${fmtPLN(cost * eurToPln, 0)} PLN)</span></div>
                </div>
                
                ${toggleDetailsHtml(loc.id)}
                
                <div class="loc-card-details" id="details-${loc.id}">
                    <div style="margin-top:8px; font-size:11px; color:var(--muted);">✍️ Dodane przez: <strong>${loc.addedBy || 'System'}</strong></div>
                    ${loc.notes ? `<div style="margin-top:6px; font-size:11px; padding:6px; background:var(--bg); border-radius:6px; border-left:3px solid var(--muted);">📝 <em>${loc.notes}</em></div>` : ''}
                </div>
            </div>`;
        }).join('');
    }
}

function openAdmin() {
    document.getElementById('adminModal').classList.add('open');
    switchAdminTab(currentAdminTab || 'users');
}

function switchAdminTab(tab) {
    currentAdminTab = tab;
    const usersBtn = document.getElementById('adminTabUsersBtn');
    const notesBtn = document.getElementById('adminTabNotesBtn');
    const certAuditBtn = document.getElementById('adminTabCertAuditBtn');
    const usersList = document.getElementById('adminUserList');
    const notesList = document.getElementById('adminNotesList');
    const certAuditList = document.getElementById('adminCertAuditList');

    if (usersBtn) usersBtn.classList.remove('active');
    if (notesBtn) notesBtn.classList.remove('active');
    if (certAuditBtn) certAuditBtn.classList.remove('active');
    if (usersList) usersList.style.display = 'none';
    if (notesList) notesList.style.display = 'none';
    if (certAuditList) certAuditList.style.display = 'none';

    if (tab === 'users') {
        if (usersBtn) usersBtn.classList.add('active');
        if (usersList) usersList.style.display = 'block';
        renderAdminPanel();
    } else if (tab === 'notes') {
        if (notesBtn) notesBtn.classList.add('active');
        if (notesList) notesList.style.display = 'block';
        renderAdminNotes();
    } else if (tab === 'certAudit') {
        if (certAuditBtn) certAuditBtn.classList.add('active');
        if (certAuditList) certAuditList.style.display = 'block';
        renderAdminCertAudit();
    }
}

function closeAdmin() {
    document.getElementById('adminModal').classList.remove('open');
    if (adminUnsubUsers) { adminUnsubUsers(); adminUnsubUsers = null; }
    if (adminUnsubActivity) { adminUnsubActivity(); adminUnsubActivity = null; }
}

let adminUnsubUsers = null;
let adminUnsubActivity = null;
let adminUsersData = {};
let adminAllActs = [];
let adminExpandedUsers = {};
let adminUIUpdater = null;

function toggleAdminActivity(user) {
    adminExpandedUsers[user] = !adminExpandedUsers[user];
    if (adminUIUpdater) adminUIUpdater();
}

function forceUserLogout(user) {
    if (!confirm(`Czy na pewno chcesz wylogować użytkownika ${user}?`)) return;
    db.collection('users').doc(user).set({
        forceLogout: true,
        online: false
    }, { merge: true }).then(() => {
        logActivity('Admin wylogował użytkownika', user);
        alert(`Wysłano żądanie wylogowania dla: ${user}`);
    });
}

async function renderAdminPanel() {
    if (currentUser !== 'Admin') return;
    const adminList = document.getElementById('adminUserList');
    if (!adminList) return;

    if (adminUnsubUsers) adminUnsubUsers();
    if (adminUnsubActivity) adminUnsubActivity();

    const countEl = document.getElementById('adminTotalNotesCount');
    if (countEl) countEl.textContent = notes.length;

    adminList.innerHTML = '<div style="color:var(--muted); font-size:12px; padding:10px;">Łączenie z bazą...</div>';

    const users = ['Radek', 'Szymon', 'Kasia', 'Tomek', 'Przemek', 'Mirek', 'Dominik', 'Admin'];
    const updateUI = () => {
        let html = '';
        
        if (deletedLocations.length > 0) {
            html += `
                <div style="margin-bottom:20px;">
                    <h3 style="color:var(--danger); margin-bottom:10px; display:flex; align-items:center; gap:8px;">🗑️ Usunięte obiekty</h3>
                    ${deletedLocations.map(loc => `
                        <div style="background:var(--card2); border:1px solid rgba(239, 68, 68, 0.3); border-radius:12px; padding:15px; margin-bottom:12px; display:flex; justify-content:space-between; align-items:center;">
                            <div>
                                <strong style="color:var(--text);">${loc.name || 'Brak nazwy'}</strong> <span style="font-size:11px; color:var(--muted); background:var(--bg); padding:2px 6px; border-radius:4px; margin-left:6px;">${loc.type === 'project' ? 'Projekt' : loc.type === 'office' ? 'Biuro' : 'Kwatera'}</span><br>
                                <span style="font-size:11px; color:var(--muted);">Usunięto (możesz przywrócić)</span>
                            </div>
                            <button onclick="restoreDeletedLocation('${loc.id}')" style="background:var(--success); color:white; border:none; border-radius:6px; padding:6px 12px; font-weight:bold; cursor:pointer;">↩️ Przywróć</button>
                        </div>
                    `).join('')}
                </div>
                <hr style="border-color:var(--border); margin: 24px 0;">
                <h3 style="margin-bottom:15px; color:var(--text);">Aktywność Użytkowników</h3>
            `;
        }

        users.forEach(u => {
            const isExpanded = !!adminExpandedUsers[u];
            const limit = isExpanded ? 30 : 3;
            // Filter out system login/logout actions
            const userActs = adminAllActs.filter(a =>
                a.user === u &&
                !['Zalogowano', 'Wylogowano'].includes(a.action)
            ).slice(0, limit);

            const status = adminUsersData[u] || {};
            const isOnline = status.online === true;

            let effectivelyOnline = isOnline;
            if (status.lastSeen) {
                const diff = (new Date() - status.lastSeen.toDate()) / 1000 / 60;
                if (diff > 10 && isOnline) effectivelyOnline = false;
            }

            const loginTime = status.lastSeen ? fmtTime(status.lastSeen.toDate()) : (status.lastLogin ? fmtTime(status.lastLogin.toDate()) : 'Brak danych');
            const pwd = '[Zaszyfrowane]';

            html += `
                <div style="background:var(--card2); border:1px solid var(--border); border-radius:12px; padding:15px; margin-bottom:12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                    <div style="font-weight:700; font-size:15px; color:var(--accent); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                        <div style="display:flex; flex-direction:column; gap:2px;">
                            <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                <span>👤 ${u}</span>
                                <span style="font-size:11px; color:var(--success); font-weight:normal; background:var(--bg); padding:2px 6px; border-radius:6px; border:1px solid var(--border); display:inline-flex; align-items:center; gap:4px; margin-left:4px;">
                                    🔒 <span>${pwd}</span>
                                </span>
                                ${u !== 'Admin' ? `<button onclick="forceUserLogout('${u}')" style="background:var(--danger); color:white; border:none; border-radius:4px; padding:2px 6px; font-size:9px; cursor:pointer; font-weight:700; text-transform:uppercase;">Wyloguj</button>` : ''}
                            </div>
                            <span style="font-size:10px; color:var(--muted); font-weight:500;">Ostatnio widziany: ${loginTime}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:8px; background:var(--bg); padding:4px 10px; border-radius:20px; border:1px solid var(--border);">
                            <span style="width:10px; height:10px; border-radius:50%; background:${effectivelyOnline ? 'var(--success)' : '#4b5563'}; box-shadow:${effectivelyOnline ? '0 0 10px var(--success)' : 'none'};"></span>
                            <span style="font-size:11px; font-weight:600; color:${effectivelyOnline ? 'var(--success)' : 'var(--muted)'};">${effectivelyOnline ? 'ONLINE' : 'OFFLINE'}</span>
                        </div>
                    </div>
                    
                    <div style="font-size:10px; color:var(--muted); margin:12px 0 6px 0; padding-top:10px; border-top:1px dashed var(--border); font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Ostatnie zmiany (kwatery/projekty):</div>
                    <div class="admin-activity-list ${isExpanded ? 'expanded' : ''}">
                        ${userActs.length ? userActs.map(a => {
                            const isDeleted = a.action && a.action.includes('Usunięto');
                            let restoreBtn = '';
                            if (isDeleted) {
                                if (a.extraData) {
                                    restoreBtn = `
                                        <button onclick="restoreLocation('${a.id}')" style="margin-top:6px; background:var(--success); color:white; border:none; border-radius:6px; padding:4px 10px; font-size:11px; cursor:pointer; font-weight:700; display:inline-flex; align-items:center; gap:4px; align-self:flex-start;">
                                            ↩️ Przywróć
                                        </button>
                                    `;
                                } else {
                                    restoreBtn = `
                                        <button disabled style="margin-top:6px; background:var(--muted); color:white; border:none; border-radius:6px; padding:4px 10px; font-size:11px; cursor:not-allowed; font-weight:700; display:inline-flex; align-items:center; gap:4px; align-self:flex-start; opacity:0.7;" title="Brak danych zapasowych w bazie. Możliwe że lokalizacja została usunięta przed wprowadzeniem funkcji kopii zapasowej.">
                                            ↩️ Przywróć (Brak kopii)
                                        </button>
                                    `;
                                }
                            }

                            let changesHtml = '';
                            if (a.changes && a.changes.length > 0) {
                                changesHtml = `
                                    <div style="margin-top:6px; padding-left:8px; border-left:2px solid var(--accent); display:flex; flex-direction:column; gap:3px;">
                                        ${a.changes.map(ch => `<span style="font-size:11px; color:var(--text); font-weight:500;">➔ ${ch}</span>`).join('')}
                                    </div>
                                `;
                            }

                            return `
                                <div style="font-size:12px; background:var(--bg); padding:8px 12px; border-radius:8px; border:1px solid var(--border); display:flex; justify-content:space-between; align-items:flex-start;">
                                    <div style="display:flex; flex-direction:column; gap:2px; align-items:flex-start; width:100%; margin-right:10px;">
                                        <span style="font-weight:700; color:var(--text);">${a.action}: <span style="font-weight:normal; color:var(--muted);">${a.details || ''}</span></span>
                                        ${changesHtml}
                                        ${restoreBtn}
                                    </div>
                                    <span style="font-size:10px; color:var(--muted); background:var(--card2); padding:2px 6px; border-radius:4px; white-space:nowrap;">${a.timestamp ? fmtTime(a.timestamp.toDate()) : '...'}</span>
                                </div>
                            `;
                        }).join('') : '<div style="font-size:12px; color:var(--muted); font-style:italic; padding:10px; text-align:center; background:var(--bg); border-radius:8px;">Brak zmian w kwaterach/projektach</div>'}
                    </div>
                    <button class="expand-act-btn ${isExpanded ? 'expanded' : ''}" onclick="toggleAdminActivity('${u}')">
                        ${isExpanded ? 'Pokaż mniej' : 'Pokaż wszystkie 30 zmian'}
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                </div>
            `;
        });
        adminList.innerHTML = html;
    };

    adminUIUpdater = updateUI;

    // Nasłuchiwanie użytkowników
    adminUnsubUsers = db.collection('users').onSnapshot(snap => {
        snap.forEach(d => { adminUsersData[d.id] = d.data(); });
        updateUI();
    }, err => {
        console.error("Admin Users Error:", err);
    });

    // Nasłuchiwanie aktywności
    adminUnsubActivity = db.collection('activity').orderBy('timestamp', 'desc').limit(400).onSnapshot(snap => {
        adminAllActs = snap.docs.map(d => ({
            id: d.id,
            ...d.data()
        }));
        updateUI();
    }, err => {
        console.error("Admin Activity Error:", err);
    });
}

window.restoreDeletedLocation = function(id) {
    if (!confirm('Czy na pewno chcesz przywrócić ten obiekt?')) return;
    const loc = deletedLocations.find(l => l.id === id);
    const locName = loc?.name || 'Nieznana';
    
    db.collection('locations').doc(id).update({ isDeleted: false })
        .then(() => {
            logActivity('Przywrócono z kosza', locName, loc);
            alert(`Pomyślnie przywrócono: ${locName}`);
        })
        .catch(err => {
            alert("Błąd przywracania: " + err.message);
        });
}

function restoreLocation(activityId) {
    const act = adminAllActs.find(a => a.id === activityId);
    if (!act || !act.extraData) {
        alert("Nie można przywrócić tej kwatery (brak danych kopii zapasowej).");
        return;
    }
    if (!confirm(`Czy na pewno chcesz przywrócić kwaterę: ${act.extraData.name || 'Bez nazwy'}?`)) return;

    const locData = { ...act.extraData };
    const docId = locData.id;
    delete locData.id; // Usuń ID z pól dokumentu

    // Odbuduj pole timestamp jeśli to konieczne
    if (locData.createdAt) {
        if (locData.createdAt.seconds !== undefined) {
            locData.createdAt = new firebase.firestore.Timestamp(locData.createdAt.seconds, locData.createdAt.nanoseconds);
        } else if (locData.createdAt._seconds !== undefined) {
            locData.createdAt = new firebase.firestore.Timestamp(locData.createdAt._seconds, locData.createdAt._nanoseconds);
        }
    }
    if (locData.updatedAt) {
        if (locData.updatedAt.seconds !== undefined) {
            locData.updatedAt = new firebase.firestore.Timestamp(locData.updatedAt.seconds, locData.updatedAt.nanoseconds);
        } else if (locData.updatedAt._seconds !== undefined) {
            locData.updatedAt = new firebase.firestore.Timestamp(locData.updatedAt._seconds, locData.updatedAt._nanoseconds);
        }
    }

    db.collection('locations').doc(docId).set(locData)
        .then(() => {
            logActivity('Przywrócono lokalizację', locData.name || 'Bez nazwy');
            alert(`Pomyślnie przywrócono kwaterę: ${locData.name}`);
        })
        .catch(err => {
            alert("Błąd przywracania: " + err.message);
        });
}

function fmtTime(date) {
    if (!date) return '';
    return date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) + ' ' +
        date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
}


// ===== FILTERING =====
function applyFilters() {
    const q = document.getElementById('personSearch').value.trim().toLowerCase();
    const showOnlyAvailable = document.getElementById('availableFilter').checked;

    const filtered = locations.filter(loc => {
        if (loc.isArchived) return false;
        // Project filter
        if (activeProjectId) {
            const project = locations.find(l => l.id === activeProjectId);
            if (project && project.type === 'project') {
                if (loc.id !== activeProjectId && !(project.linkedLocations || []).includes(loc.id)) {
                    return false;
                }
            }
        }

        // Quarter filter
        if (activeQuarterId) {
            const isSelectedQuarter = loc.id === activeQuarterId;
            const isProjectLinkedToThisQuarter = loc.type === 'project' && (loc.linkedLocations || []).includes(activeQuarterId);
            if (!isSelectedQuarter && !isProjectLinkedToThisQuarter) {
                return false;
            }
        }

        // Query search (person, name, address, zip)
        const matchesQuery = !q || (
            (loc.name || '').toLowerCase().includes(q) ||
            (loc.street || '').toLowerCase().includes(q) ||
            (loc.city || '').toLowerCase().includes(q) ||
            (loc.zip || '').toLowerCase().includes(q) ||
            (loc.people && loc.people.some(p => {
                const name = (typeof p === 'string' ? p : p.name || '').toLowerCase();
                const plate = (typeof p !== 'string' && p.carPlate ? p.carPlate : '').toLowerCase();
                const car = (typeof p !== 'string' && p.carDesc ? p.carDesc : '').toLowerCase();
                return name.includes(q) || plate.includes(q) || car.includes(q);
            }))
        );

        // Availability filter
        const occ = loc.people ? loc.people.length : 0;
        const hasSpace = occ < loc.capacity;
        const matchesAvailability = !showOnlyAvailable || hasSpace;

        return matchesQuery && matchesAvailability;
    });

    renderList(filtered);
    reloadMarkers(filtered);
}

function clearProjectFilter() {
    activeProjectId = null;
    activeQuarterId = null;
    roadDistances = {}; // Clear distances when changing filter to ensure fresh calculation
    const filterInfo = document.getElementById('projectFilterInfo');
    if (filterInfo) filterInfo.style.display = 'none';
    applyFilters();
}

// ===== HELP MODAL =====
function openHelp() {
    document.getElementById('helpModal').classList.add('open');
}

function closeHelp() {
    document.getElementById('helpModal').classList.remove('open');
}

// ===== MAP NAVIGATION =====
function focusLocation(id) {
    const loc = locations.find(l => l.id === id);
    if (!loc) return;

    if (loc.isArchived) {
        if (!markers[id]) {
            addMarker(loc);
        }
        map.setView([loc.lat, loc.lng], 16);
        if (markers[id]) {
            markers[id].openPopup();
        }
        highlightCard(id);
        return;
    }

    if (loc.type === 'project') {
        const isNewProject = activeProjectId !== id;
        activeProjectId = id;
        activeQuarterId = null;
        if (isNewProject) roadDistances = {}; // Start fresh for this project
        const filterInfo = document.getElementById('projectFilterInfo');
        const projNameSpan = document.getElementById('activeProjectName');
        if (filterInfo && projNameSpan) {
            filterInfo.style.display = 'flex';
            projNameSpan.textContent = loc.name;
        }
        applyFilters();
    } else {
        activeQuarterId = id;
        activeProjectId = null;
        const filterInfo = document.getElementById('projectFilterInfo');
        const projNameSpan = document.getElementById('activeProjectName');
        if (filterInfo && projNameSpan) {
            filterInfo.style.display = 'flex';
            projNameSpan.textContent = `Kwatera: ${loc.name}`;
        }
        applyFilters();
    }

    // Switch to list tab
    switchTab('list');

    // Ensure the marker exists (it might have been filtered out)
    if (!markers[id]) {
        // Temporarily ignore filters to show the searched location marker
        addMarker(loc);
    }

    map.setView([loc.lat, loc.lng], 16);
    if (markers[id]) {
        markers[id].openPopup();
    }

    // Highlight in session
    highlightCard(id);
}

function toggleSidebarHeight() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        sidebar.classList.toggle('collapsed');
    }
}

// ===== NOTES SYSTEM =====
function initNotesSync() {
    if (notesUnsub) notesUnsub();
    notesUnsub = db.collection('notes').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
        notes = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        renderNotesWidget();
        const countEl = document.getElementById('adminTotalNotesCount');
        if (countEl) countEl.textContent = notes.length;
        if (currentUser === 'Admin' && currentAdminTab === 'notes') {
            renderAdminNotes();
        }
    }, err => {
        console.error("Błąd synchronizacji notatek:", err);
    });
}

function renderNotesWidget() {
    const listEl = document.getElementById('notesList');
    const badgeEl = document.getElementById('notesCountBadge');
    const popoverBadge = document.getElementById('notesPopoverBadge');
    if (!listEl) return;

    const activeNotes = notes.filter(n => {
        if (n.deleted) return false;
        if (currentUser === 'Admin') return true;
        if (n.author === currentUser) return true;
        if (!n.targetAudience || n.targetAudience.includes('all')) return true;
        if (Array.isArray(n.targetAudience) && n.targetAudience.includes(currentUser)) return true;
        return false;
    });

    if (badgeEl) {
        if (activeNotes.length > 0) {
            badgeEl.textContent = activeNotes.length;
            badgeEl.style.display = 'flex';
        } else {
            badgeEl.style.display = 'none';
        }
    }
    if (popoverBadge) popoverBadge.textContent = activeNotes.length;

    if (activeNotes.length === 0) {
        listEl.innerHTML = '<div class="notes-empty">Brak aktywnych notatek</div>';
        return;
    }

    listEl.innerHTML = activeNotes.map(n => {
        const canDelete = (n.author === currentUser || currentUser === 'Admin');
        const isAll = !n.targetAudience || n.targetAudience.includes('all');
        const audienceText = isAll ? '👥 Wszyscy' : `🔒 ${Array.isArray(n.targetAudience) ? n.targetAudience.join(', ') : 'Wszyscy'}`;
        const isRed = (n.color === 'red');
        const colorClass = isRed ? 'color-red' : 'color-blue';
        const priorityPill = isRed 
            ? `<span class="note-priority-pill pill-red">🔴 Ważna</span>` 
            : `<span class="note-priority-pill pill-blue">🔵 Normalna</span>`;
        const dateText = n.createdAt ? fmtTime(n.createdAt.toDate()) : '';

        return `
            <div class="note-card ${colorClass}" id="note-${n.id}" onclick="event.stopPropagation()">
                <div class="note-card-header">
                    <div style="display:flex; flex-direction:column; gap:3px;">
                        <div style="display:flex; align-items:center; gap:6px;">
                            <div class="note-card-author">
                                <span>👤 ${escapeHtml(n.author || 'Anonim')}</span>
                            </div>
                            ${priorityPill}
                        </div>
                        <span class="note-card-audience">${escapeHtml(audienceText)}</span>
                    </div>
                    <div class="note-card-actions">
                        ${canDelete ? `<button class="note-delete-btn" onclick="event.stopPropagation(); deleteNote('${n.id}')" title="Usuń notatkę (tylko autor)">🗑️</button>` : ''}
                    </div>
                </div>
                ${n.title ? `<div class="note-card-title">${escapeHtml(n.title)}</div>` : ''}
                <div class="note-card-content">${escapeHtml(n.content || '')}</div>
                ${dateText ? `<div class="note-card-time">${dateText}</div>` : ''}
            </div>
        `;
    }).join('');
}

function toggleNotesPopover(e) {
    if (e) {
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
    }
    const popover = document.getElementById('notesPopover');
    if (!popover) return;
    const isShowing = (popover.style.display !== 'none');
    popover.style.display = isShowing ? 'none' : 'flex';
}

function toggleNotesWidget(e) {
    toggleNotesPopover(e);
}

function openCreateNoteModal(e) {
    if (e) {
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
    }
    const modal = document.getElementById('createNoteModal');
    if (!modal) return;
    const titleEl = document.getElementById('noteTitle');
    const contentEl = document.getElementById('noteContent');
    if (titleEl) titleEl.value = '';
    if (contentEl) contentEl.value = '';

    // Reset color to blue (Normal) by default
    const colorRadios = document.querySelectorAll('input[name="noteColor"]');
    colorRadios.forEach(r => { r.checked = (r.value === 'blue'); });

    // Reset audience mode to 'all'
    setNoteAudienceMode('all');

    // Populate team members list as selectable chips
    const userListEl = document.getElementById('noteAudienceUsers');
    if (userListEl) {
        const teamUsers = ['Radek', 'Szymon', 'Kasia', 'Tomek', 'Przemek', 'Mirek', 'Dominik'];
        userListEl.innerHTML = teamUsers.map(u => `
            <label class="user-chip-item" onclick="event.stopPropagation()">
                <input type="checkbox" value="${u}" name="noteAudienceUser">
                <span>👤 ${u}</span>
            </label>
        `).join('');
    }

    modal.classList.add('open');
}

function closeCreateNoteModal(e) {
    if (e) {
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
    }
    const modal = document.getElementById('createNoteModal');
    if (modal) modal.classList.remove('open');
}

function setNoteAudienceMode(mode, e) {
    if (e) {
        e.stopPropagation();
        if (e.preventDefault) e.preventDefault();
    }
    const audTypeInput = document.getElementById('noteAudienceType');
    if (audTypeInput) audTypeInput.value = mode;

    const btnAll = document.getElementById('audBtnAll');
    const btnCustom = document.getElementById('audBtnCustom');
    const usersWrap = document.getElementById('noteAudienceUsers');

    if (btnAll) btnAll.classList.toggle('active', mode === 'all');
    if (btnCustom) btnCustom.classList.toggle('active', mode === 'custom');
    if (usersWrap) usersWrap.style.display = (mode === 'custom') ? 'flex' : 'none';
}

function toggleNoteAudienceUI(val) {
    setNoteAudienceMode(val);
}

async function saveNewNote() {
    const titleEl = document.getElementById('noteTitle');
    const contentEl = document.getElementById('noteContent');
    const title = titleEl ? titleEl.value.trim() : '';
    const content = contentEl ? contentEl.value.trim() : '';

    if (!content) {
        alert('Proszę wpisać treść notatki.');
        return;
    }

    let color = 'blue';
    const checkedColor = document.querySelector('input[name="noteColor"]:checked');
    if (checkedColor && (checkedColor.value === 'red' || checkedColor.value === 'blue')) {
        color = checkedColor.value;
    }

    let targetAudience = ['all'];
    const audTypeInput = document.getElementById('noteAudienceType');
    const audType = audTypeInput ? audTypeInput.value : 'all';

    if (audType === 'custom') {
        const userChecks = document.querySelectorAll('input[name="noteAudienceUser"]:checked');
        const selectedUsers = Array.from(userChecks).map(c => c.value);
        if (selectedUsers.length === 0) {
            alert('Wybierz przynajmniej jedną osobę lub kliknij "Wszyscy użytkownicy".');
            return;
        }
        targetAudience = selectedUsers;
    }

    try {
        await db.collection('notes').add({
            title: title,
            content: content,
            author: currentUser || 'Anonim',
            color: color,
            targetAudience: targetAudience,
            deleted: false,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        logActivity('Dodano notatkę', title ? `"${title}"` : content.slice(0, 30));
        closeCreateNoteModal();
    } catch (err) {
        console.error("Błąd podczas zapisywania notatki:", err);
        alert("Błąd podczas zapisywania notatki: " + err.message);
    }
}

async function deleteNote(noteId) {
    const note = notes.find(n => n.id === noteId);
    if (!note) return;

    if (note.author !== currentUser && currentUser !== 'Admin') {
        alert('Tylko osoba, która utworzyła tę notatkę, może ją usunąć.');
        return;
    }

    if (!confirm('Czy na pewno chcesz usunąć tę notatkę?')) return;

    try {
        await db.collection('notes').doc(noteId).update({
            deleted: true,
            deletedBy: currentUser,
            deletedAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        logActivity('Usunięto notatkę', note.title ? `"${note.title}"` : note.content.slice(0, 30));
    } catch (err) {
        console.error("Błąd usuwania notatki:", err);
        alert("Błąd usuwania notatki: " + err.message);
    }
}

async function restoreNote(noteId) {
    if (currentUser !== 'Admin') return;
    try {
        await db.collection('notes').doc(noteId).update({
            deleted: false,
            restoredBy: currentUser,
            restoredAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        logActivity('Admin przywrócił notatkę', noteId);
    } catch (err) {
        console.error("Błąd przywracania notatki:", err);
        alert("Błąd przywracania: " + err.message);
    }
}

async function hardDeleteNote(noteId) {
    if (currentUser !== 'Admin') return;
    if (!confirm('Czy na pewno chcesz TRWALE usunąć tę notatkę z bazy danych? Tej operacji nie można cofnąć.')) return;
    try {
        await db.collection('notes').doc(noteId).delete();
        logActivity('Admin trwale usunął notatkę', noteId);
    } catch (err) {
        console.error("Błąd trwałego usuwania:", err);
        alert("Błąd: " + err.message);
    }
}

function renderAdminNotes() {
    const notesList = document.getElementById('adminNotesList');
    const countEl = document.getElementById('adminTotalNotesCount');
    if (countEl) countEl.textContent = notes.length;
    if (!notesList) return;

    if (notes.length === 0) {
        notesList.innerHTML = '<div style="color:var(--muted); font-size:13px; padding:30px; text-align:center;">Brak jakichkolwiek notatek w systemie.</div>';
        return;
    }

    notesList.innerHTML = `
        <div style="margin-bottom:14px; font-size:12px; color:var(--muted); display:flex; justify-content:space-between; align-items:center;">
            <span>Wszystkie notatki w systemie: <strong>${notes.length}</strong> (w tym usunięte)</span>
        </div>
        ${notes.map(n => {
            const isDel = !!n.deleted;
            const isAll = !n.targetAudience || n.targetAudience.includes('all');
            const audStr = isAll ? 'Wszyscy' : (Array.isArray(n.targetAudience) ? n.targetAudience.join(', ') : 'Wszyscy');
            const createdStr = n.createdAt ? fmtTime(n.createdAt.toDate()) : 'Brak daty';
            const isRed = (n.color === 'red');
            const priorityBadge = isRed 
                ? `<span style="background:rgba(239,68,68,0.15); color:#ef4444; border:1px solid rgba(239,68,68,0.3); font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px;">🔴 Ważna</span>` 
                : `<span style="background:rgba(59,130,246,0.15); color:#60a5fa; border:1px solid rgba(59,130,246,0.3); font-size:10px; font-weight:700; padding:1px 6px; border-radius:4px;">🔵 Normalna</span>`;
            const delInfo = isDel ? `<div style="font-size:11px; color:var(--danger); margin-top:2px;">🗑️ Usunięta przez: <strong>${escapeHtml(n.deletedBy || 'Nieznany')}</strong> (${n.deletedAt ? fmtTime(n.deletedAt.toDate()) : 'Brak daty'})</div>` : '';

            return `
                <div class="admin-note-item ${isDel ? 'is-deleted' : ''}">
                    <div class="admin-note-header">
                        <div class="admin-note-badges">
                            ${isDel ? `<span class="status-badge-deleted">🗑️ Usunięta</span>` : `<span class="status-badge-active">🟢 Aktywna</span>`}
                            ${priorityBadge}
                            <span style="font-weight:700; color:var(--text); font-size:12px;">👤 ${escapeHtml(n.author || 'Anonim')}</span>
                            <span style="color:var(--muted); font-size:11px;">📅 ${createdStr}</span>
                            <span style="background:var(--bg); border:1px solid var(--border); padding:2px 6px; border-radius:6px; font-size:10.5px; color:var(--muted);">👥 Odbiorcy: <strong>${escapeHtml(audStr)}</strong></span>
                        </div>
                        <div class="admin-note-actions">
                            ${isDel ? `
                                <button onclick="restoreNote('${n.id}')" style="background:var(--success); color:white; border:none; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer;">↩️ Przywróć</button>
                                <button onclick="hardDeleteNote('${n.id}')" style="background:var(--danger); color:white; border:none; border-radius:6px; padding:4px 10px; font-size:11px; font-weight:700; cursor:pointer;">🗑️ Usuń trwale</button>
                            ` : `
                                <button onclick="deleteNote('${n.id}')" style="background:transparent; color:var(--danger); border:1px solid var(--danger); border-radius:6px; padding:4px 10px; font-size:11px; font-weight:600; cursor:pointer;">🗑️ Usuń</button>
                            `}
                        </div>
                    </div>
                    ${delInfo}
                    ${n.title ? `<div style="font-weight:700; font-size:13px; color:var(--text); margin-top:2px;">${escapeHtml(n.title)}</div>` : ''}
                    <div style="font-size:12px; color:var(--text); white-space:pre-wrap; line-height:1.45; background:var(--bg); padding:10px; border-radius:8px; border:1px solid var(--border);">${escapeHtml(n.content || '')}</div>
                </div>
            `;
        }).join('')}
    `;
}

// ========================================================
// MODUŁ: CERTYFIKATY I TERMINY
// ========================================================

const DEFAULT_CERT_COLUMNS = [
    { key: 'passport', label: 'Paszport' },
    { key: 'trcPol', label: 'TRC POL' },
    { key: 'trcNdl', label: 'TRC NDL' },
    { key: 'scc', label: 'SCC' },
    { key: 'vcaBe', label: 'VCA BE' },
    { key: 'vca', label: 'VCA' },
    { key: 'tuv111', label: 'TÜV 111' },
    { key: 'tuv114', label: 'TÜV 114' },
    { key: 'tuv135', label: 'TÜV 135' },
    { key: 'tuv138', label: 'TÜV 138' },
    { key: 'tuv111_141', label: 'TÜV 111/141' },
    { key: 'tuv138_136', label: 'TÜV 138/136' }
];

let CERT_COLUMNS = [...DEFAULT_CERT_COLUMNS];

const DEFAULT_CERT_POSITIONS = [
    'Welder',
    'TIG Welder',
    'MAG Welder',
    'Pipe Fitter',
    'Fitter',
    'Steel Fitter',
    'Locksmith',
    'Electrician',
    'Insulator',
    'Scaffolder',
    'Construction Worker',
    'Mechanic',
    'Rigger',
    'Sandblaster'
];

let CERT_POSITIONS = [...DEFAULT_CERT_POSITIONS];

const INITIAL_CERT_EMPLOYEES = [
    { lastName: "Abel", firstName: "Richard" },
    { lastName: "Abiera", firstName: "Gary" },
    { lastName: "Acabado", firstName: "Jonathan" },
    { lastName: "Aculana", firstName: "Butz" },
    { lastName: "Adora", firstName: "Christopher", passport: "04.04.2028", trcPol: "04.10.2026", scc: "30.01.2028", tuv135: "21.03.2027", tuv111_141: "30.07.2029" },
    { lastName: "Aguinaldo", firstName: "Romeo Jr.", passport: "27.08.2030", trcPol: "2024", scc: "15.10.2029", tuv138_136: "22.08.2027" },
    { lastName: "Ahmed", firstName: "Rasel" },
    { lastName: "Alegarbes", firstName: "Areil", passport: "07.02.2035", trcPol: "31.12.2026", vca: "13.09.2035", tuv138_136: "10.10.2028" },
    { lastName: "Amador", firstName: "Jonnel", passport: "06.06.2029", trcPol: "18.01.2029", vcaBe: "30.05.2036" },
    { lastName: "Amin (82)", firstName: "Ruhul" },
    { lastName: "Amin (83)", firstName: "Ruhul" },
    { lastName: "Antone", firstName: "Ricardo", passport: "12.03.2030", trcPol: "2024", tuv135: "03.05.2029" },
    { lastName: "Arevalo", firstName: "Brando", passport: "30.08.2031", trcPol: "17.11.2028", vcaBe: "03.09.2036" },
    { lastName: "Atillo", firstName: "Rudyleo", passport: "28.04.2032", scc: "03.01.2029" },
    { lastName: "Azim", firstName: "Mia" },
    { lastName: "Bacan", firstName: "Renante Prino", passport: "19.08.2030", trcPol: "2025", scc: "06.07.2028", tuv138_136: "04.01.2027" },
    { lastName: "Bago", firstName: "Rodelio", passport: "25.06.2029", trcPol: "2024", scc: "18.01.2029" },
    { lastName: "Bascar", firstName: "Arnie", passport: "08.05.2028", trcPol: "26.07.2029" },
    { lastName: "Bautizado", firstName: "Reyman" },
    { lastName: "Bermal", firstName: "Jondy" },
    { lastName: "Bernardino", firstName: "Archie" },
    { lastName: "Caballes", firstName: "Minard" },
    { lastName: "Cabugason", firstName: "Mar" },
    { lastName: "Cepillo", firstName: "Enrico" },
    { lastName: "Coronel", firstName: "Enrique" },
    { lastName: "Cortez", firstName: "Glenn" },
    { lastName: "Dacpano", firstName: "Bonifacio II" },
    { lastName: "Dalag", firstName: "Leonardo Jr." },
    { lastName: "Dawana", firstName: "Christian" },
    { lastName: "De Guzman", firstName: "Michael" },
    { lastName: "Dela Cruz", firstName: "Ronald" },
    { lastName: "Delavida", firstName: "Dennis" },
    { lastName: "Dimaculangan", firstName: "Reynante" },
    { lastName: "Diones", firstName: "Gilbert" },
    { lastName: "Dipasupil", firstName: "Roland" },
    { lastName: "Dismas", firstName: "Marlon" },
    { lastName: "Domingo", firstName: "Jose Victor" },
    { lastName: "Esponga", firstName: "Arnel" },
    { lastName: "Eviota", firstName: "John" },
    { lastName: "Fajilagana", firstName: "Rema" },
    { lastName: "Flores", firstName: "Rosalie" },
    { lastName: "Gadiano", firstName: "Dexter" },
    { lastName: "Gonzales", firstName: "Ernesto Jr" },
    { lastName: "Haq", firstName: "Ajijul" },
    { lastName: "Hinayon", firstName: "Celso Jr" },
    { lastName: "Hoque", firstName: "Shafikul" },
    { lastName: "Hossain", firstName: "Delowar" },
    { lastName: "Iniego", firstName: "Livy" },
    { lastName: "Islam", firstName: "Shariful" },
    { lastName: "Islam", firstName: "Md Soriful" },
    { lastName: "Jahid", firstName: "Mohammad" },
    { lastName: "Jimenez", firstName: "Dennis" },
    { lastName: "Jolapong", firstName: "Elson Jr" },
    { lastName: "Khan", firstName: "Sakil" },
    { lastName: "Kobir", firstName: "Md Shomon" },
    { lastName: "Laureta", firstName: "Albert" },
    { lastName: "Lugtu", firstName: "Arden" },
    { lastName: "Macadat", firstName: "Junry" },
    { lastName: "Mandaya", firstName: "Brian" },
    { lastName: "Mango", firstName: "Kimberly Joy" },
    { lastName: "Mansilungan", firstName: "Eugene" },
    { lastName: "Margaja", firstName: "Garry" },
    { lastName: "Matira", firstName: "Carlo Jay" },
    { lastName: "Matalog", firstName: "Lorenzo" },
    { lastName: "Miah", firstName: "Md Nowshad" },
    { lastName: "Molla", firstName: "Kaium" },
    { lastName: "Ogaya", firstName: "Renante" },
    { lastName: "Pacay", firstName: "Leo John" },
    { lastName: "Papa", firstName: "Bernardo" },
    { lastName: "Perez", firstName: "Roger" },
    { lastName: "Pilapil", firstName: "Daryl" },
    { lastName: "Rahman", firstName: "Md Sadikur" },
    { lastName: "Rana", firstName: "Md Sohel" },
    { lastName: "Raquiza", firstName: "Erwin" },
    { lastName: "Rashid", firstName: "Harun Ar" },
    { lastName: "Sierra", firstName: "Jeson" },
    { lastName: "Soriano", firstName: "Ariel" },
    { lastName: "Vequizo", firstName: "Bernabie" },
    { lastName: "Villanueva", firstName: "Jeffrey" }
];

let certEmployees = [];
let certAuditLogs = [];
let certTableTitle = "Certyfikaty i terminy";
let currentCertView = 'table';
let currentCertFilter = 'all';
let currentCertProfession = '';
let certSearchQuery = '';
let editingCertEmpId = null;
let editingQuickProfEmpId = null;
let certUnsub = null;
let certTitleUnsub = null;
let certAuditUnsub = null;

function canEditCertData(user = currentUser) {
    const u = (user || '').toLowerCase().trim();
    return ['admin', 'kasia', 'mirek', 'radek'].includes(u);
}

function canEditCertTitle(user = currentUser) {
    return (user || '').toLowerCase().trim() === 'admin';
}

function canAddCertColumn(user = currentUser) {
    return (user || '').toLowerCase().trim() === 'admin';
}

function parseCertDate(val) {
    if (!val) return null;
    const str = String(val).trim();
    if (!str || str === '-') return null;

    // DD.MM.YYYY
    const ddmmyyyy = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(str);
    if (ddmmyyyy) {
        const d = parseInt(ddmmyyyy[1], 10);
        const m = parseInt(ddmmyyyy[2], 10) - 1;
        const y = parseInt(ddmmyyyy[3], 10);
        return new Date(y, m, d);
    }

    // YYYY-MM-DD
    const yyyymmdd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str);
    if (yyyymmdd) {
        const y = parseInt(yyyymmdd[1], 10);
        const m = parseInt(yyyymmdd[2], 10) - 1;
        const d = parseInt(yyyymmdd[3], 10);
        return new Date(y, m, d);
    }

    // YYYY only (assume end of year)
    const yyyy = /^(\d{4})$/.exec(str);
    if (yyyy) {
        const y = parseInt(yyyy[1], 10);
        return new Date(y, 11, 31);
    }

    const parsed = new Date(str);
    return isNaN(parsed.getTime()) ? null : parsed;
}

function getCertExpiryInfo(val) {
    if (!val || String(val).trim() === '' || String(val).trim() === '-') {
        return { status: 'none', daysLeft: null, raw: '-', badge: '', isUrgent: false };
    }

    const raw = String(val).trim();
    const target = parseCertDate(raw);
    if (!target) {
        return { status: 'none', daysLeft: null, raw: raw, badge: '', isUrgent: false };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    target.setHours(0, 0, 0, 0);

    const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
        const absDays = Math.abs(diffDays);
        return {
            status: 'expired',
            daysLeft: diffDays,
            raw: raw,
            badge: absDays === 0 ? 'Dziś wygasa' : `${absDays}d po term.`,
            isUrgent: true
        };
    }

    if (diffDays <= 30) {
        return {
            status: 'red',
            daysLeft: diffDays,
            raw: raw,
            badge: diffDays === 0 ? 'Dziś' : `${diffDays}d`,
            isUrgent: true
        };
    }

    if (diffDays <= 60) {
        return {
            status: 'yellow',
            daysLeft: diffDays,
            raw: raw,
            badge: `${diffDays}d`,
            isUrgent: false
        };
    }

    if (diffDays <= 90) {
        return {
            status: 'green',
            daysLeft: diffDays,
            raw: raw,
            badge: '',
            isUrgent: false
        };
    }

    return {
        status: 'normal',
        daysLeft: diffDays,
        raw: raw,
        badge: '',
        isUrgent: false
    };
}

function initCertificatesSync() {
    // Listen for custom table title and columns
    if (certTitleUnsub) certTitleUnsub();
    certTitleUnsub = db.collection('settings').doc('certificates').onSnapshot(doc => {
        if (doc.exists && doc.data()) {
            const data = doc.data();
            certTableTitle = data.title || "Certyfikaty i terminy";
            if (Array.isArray(data.columns) && data.columns.length > 0) {
                CERT_COLUMNS = data.columns;
            } else {
                CERT_COLUMNS = [...DEFAULT_CERT_COLUMNS];
            }
            if (Array.isArray(data.positions) && data.positions.length > 0) {
                CERT_POSITIONS = data.positions;
            } else {
                CERT_POSITIONS = [...DEFAULT_CERT_POSITIONS];
            }
        } else {
            certTableTitle = "Certyfikaty i terminy";
            CERT_COLUMNS = [...DEFAULT_CERT_COLUMNS];
            CERT_POSITIONS = [...DEFAULT_CERT_POSITIONS];
        }
        const titleEl = document.getElementById('certTableTitleText');
        if (titleEl) titleEl.textContent = certTableTitle;
        renderCertTableHeader();
        renderCertEmployeeFormFields();
        renderQuickPositionChips();
        renderProfessionDatalist();
        const modal = document.getElementById('certModal');
        if (modal && modal.classList.contains('open')) {
            renderCertificates();
        }
    });

    // Initial render of header, form fields and position chips with defaults
    renderCertTableHeader();
    renderCertEmployeeFormFields();
    renderQuickPositionChips();
    renderProfessionDatalist();

    // Listen for employees collection
    const PL_TO_EN_PROFESSIONS = {
        'Spawacz': 'Welder',
        'Spawacz TIG': 'TIG Welder',
        'Spawacz MAG': 'MAG Welder',
        'Monter': 'Fitter',
        'Monter rurociągów': 'Pipe Fitter',
        'Ślusarz': 'Locksmith',
        'Elektryk': 'Electrician',
        'Izoler': 'Insulator',
        'Monter rusztowań': 'Scaffolder',
        'Pomocnik': 'Construction Worker',
        'Mechanik': 'Mechanic'
    };

    if (certUnsub) certUnsub();
    certUnsub = db.collection('cert_employees').orderBy('lastName').onSnapshot(snapshot => {
        if (snapshot.empty) {
            // First time setup: seed initial 72 employees
            seedInitialCertificates();
            return;
        }

        certEmployees = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            let prof = (data.profession || '').trim();
            if (prof && PL_TO_EN_PROFESSIONS[prof]) {
                const enProf = PL_TO_EN_PROFESSIONS[prof];
                prof = enProf;
                if (canEditCertData()) {
                    db.collection('cert_employees').doc(doc.id).update({ profession: enProf }).catch(() => {});
                }
            }
            certEmployees.push({ id: doc.id, ...data, profession: prof });
        });

        // Ensure newly defined initial employees are present in Firestore
        syncMissingCertEmployees(certEmployees);

        // Compute urgent items (<= 30 days)
        const urgentItems = getUrgentCertificates();
        const urgentCount = urgentItems.length;

        // Update topbar alert badge
        const topBadge = document.getElementById('certTopAlertBadge');
        if (topBadge) {
            if (urgentCount > 0) {
                topBadge.textContent = urgentCount;
                topBadge.style.display = 'inline-block';
            } else {
                topBadge.style.display = 'none';
            }
        }

        // Check startup notification
        checkStartupCertAlert(urgentItems);

        // Re-render if modal open
        const modal = document.getElementById('certModal');
        if (modal && modal.classList.contains('open')) {
            renderCertificates();
        }
    }, err => {
        console.error("Błąd synchronizacji certyfikatów:", err);
    });

    // Listen for audit if admin
    if (currentUser === 'Admin') {
        if (certAuditUnsub) certAuditUnsub();
        certAuditUnsub = db.collection('cert_audit').orderBy('timestamp', 'desc').limit(100).onSnapshot(snapshot => {
            certAuditLogs = [];
            snapshot.forEach(doc => {
                certAuditLogs.push({ id: doc.id, ...doc.data() });
            });
            if (currentAdminTab === 'certAudit') {
                renderAdminCertAudit();
            }
        });
    }
}

async function seedInitialCertificates() {
    console.log("Inicjalizacja domyślnej bazy pracowników certyfikatów...");
    try {
        const batch = db.batch();
        const now = firebase.firestore.FieldValue.serverTimestamp();

        INITIAL_CERT_EMPLOYEES.forEach((emp, index) => {
            const docRef = db.collection('cert_employees').doc();
            batch.set(docRef, {
                ...emp,
                addedBy: 'System',
                createdAt: now,
                order: index + 1
            });
        });

        await batch.commit();

        // Seed audit log
        db.collection('cert_audit').add({
            action: 'seed',
            employeeName: 'Wgrano 72 pracowników z arkusza',
            user: 'System',
            timestamp: now
        });

        console.log("Pomyślnie zainicjowano bazę certyfikatów!");
    } catch (e) {
        console.error("Błąd seedowania bazy certyfikatów:", e);
    }
}

let isSyncingMissingEmps = false;
async function syncMissingCertEmployees(existingList) {
    if (isSyncingMissingEmps || !existingList || existingList.length === 0) return;

    const missing = INITIAL_CERT_EMPLOYEES.filter(initEmp => {
        const initLast = (initEmp.lastName || '').toLowerCase().trim();
        const initFirst = (initEmp.firstName || '').toLowerCase().trim();
        return !existingList.some(e =>
            (e.lastName || '').toLowerCase().trim() === initLast &&
            (e.firstName || '').toLowerCase().trim() === initFirst
        );
    });

    if (missing.length === 0) return;

    isSyncingMissingEmps = true;
    try {
        console.log(`Wykryto ${missing.length} brakujących pracowników w Firestore. Dodawanie...`);
        const batch = db.batch();
        const now = firebase.firestore.FieldValue.serverTimestamp();
        let nextOrder = existingList.length + 1;

        missing.forEach(emp => {
            const docRef = db.collection('cert_employees').doc();
            batch.set(docRef, {
                ...emp,
                addedBy: 'System',
                createdAt: now,
                order: nextOrder++
            });
        });

        await batch.commit();

        await db.collection('cert_audit').add({
            action: 'add_employee',
            employeeName: `Dodano ${missing.length} pracowników (${missing.map(m => `${m.lastName} ${m.firstName}`).join(', ')})`,
            user: 'System',
            timestamp: now
        });

        console.log(`Pomyślnie zsynchronizowano ${missing.length} pracowników do bazy!`);
    } catch (e) {
        console.error("Błąd synchronizacji brakujących pracowników:", e);
    } finally {
        isSyncingMissingEmps = false;
    }
}

function getUrgentCertificates() {
    const results = [];
    certEmployees.forEach(emp => {
        CERT_COLUMNS.forEach(col => {
            const val = emp[col.key];
            if (val) {
                const info = getCertExpiryInfo(val);
                if (info.isUrgent) {
                    results.push({
                        empId: emp.id,
                        empName: `${emp.lastName} ${emp.firstName}`,
                        profession: emp.profession || '',
                        docKey: col.key,
                        docLabel: col.label,
                        val: info.raw,
                        daysLeft: info.daysLeft,
                        status: info.status,
                        badge: info.badge
                    });
                }
            }
        });
    });

    // Sort by days left ascending (most urgent first)
    results.sort((a, b) => a.daysLeft - b.daysLeft);
    return results;
}

function checkStartupCertAlert(urgentItems) {
    if (!urgentItems || urgentItems.length === 0) return;
    if (sessionStorage.getItem('cert_startup_dismissed') === 'true') return;

    const alertBox = document.getElementById('certStartupAlert');
    const msgEl = document.getElementById('certStartupAlertMsg');
    if (alertBox && msgEl) {
        const count = urgentItems.length;
        msgEl.textContent = `Uwaga! Masz ${count} ${count === 1 ? 'dokument/certyfikat wygasający' : count < 5 ? 'dokumenty/certyfikaty wygasające' : 'dokumentów/certyfikatów wygasających'} w ciągu 30 dni!`;
        alertBox.style.display = 'flex';
    }
}

function closeCertStartupAlert() {
    sessionStorage.setItem('cert_startup_dismissed', 'true');
    const alertBox = document.getElementById('certStartupAlert');
    if (alertBox) alertBox.style.display = 'none';
}

// PIN MODAL
function handleOpenCertificates() {
    if (sessionStorage.getItem('cert_pin_unlocked') === 'true') {
        openCertModal();
    } else {
        openCertPinModal();
    }
}

function openCertPinModal() {
    const modal = document.getElementById('certPinModal');
    const pinInput = document.getElementById('certPinInput');
    const pinErr = document.getElementById('certPinErr');
    if (pinErr) pinErr.style.display = 'none';
    if (pinInput) {
        pinInput.value = '';
        setTimeout(() => pinInput.focus(), 150);
    }
    if (modal) modal.classList.add('open');
}

function closeCertPinModal() {
    const modal = document.getElementById('certPinModal');
    if (modal) modal.classList.remove('open');
}

function handleCertPinKey(e) {
    if (e.key === 'Enter') {
        submitCertPin();
    }
}

function submitCertPin() {
    const pinInput = document.getElementById('certPinInput');
    const pinErr = document.getElementById('certPinErr');
    const box = document.querySelector('.cert-pin-box');
    const pin = (pinInput ? pinInput.value : '').trim();

    if (pin === '1410') {
        sessionStorage.setItem('cert_pin_unlocked', 'true');
        closeCertPinModal();
        openCertModal();
    } else {
        if (pinErr) pinErr.style.display = 'block';
        if (box) {
            box.classList.add('shake');
            setTimeout(() => box.classList.remove('shake'), 400);
        }
        if (pinInput) {
            pinInput.value = '';
            pinInput.focus();
        }
    }
}

// MAIN MODAL
function openCertModal() {
    const modal = document.getElementById('certModal');
    if (!modal) return;

    // Permissions visibility
    const canEdit = canEditCertData();
    const canTitle = canEditCertTitle();
    const canAddCol = canAddCertColumn();

    const titleEditBtn = document.getElementById('certEditTitleBtn');
    if (titleEditBtn) titleEditBtn.style.display = canTitle ? 'inline-block' : 'none';

    const addEmpBtn = document.getElementById('certAddEmpBtn');
    if (addEmpBtn) addEmpBtn.style.display = canEdit ? 'inline-block' : 'none';

    const addColBtn = document.getElementById('certAddColBtn');
    if (addColBtn) addColBtn.style.display = canAddCol ? 'inline-block' : 'none';

    const thActions = document.getElementById('certThActions');
    if (thActions) thActions.style.display = canEdit ? 'table-cell' : 'none';

    const titleEl = document.getElementById('certTableTitleText');
    if (titleEl) titleEl.textContent = certTableTitle;

    renderCertTableHeader();
    renderCertEmployeeFormFields();

    modal.classList.add('open');
    renderCertificates();
}

function closeCertModal() {
    const modal = document.getElementById('certModal');
    if (modal) modal.classList.remove('open');
}

function switchCertView(view) {
    currentCertView = view;
    const tabTableBtn = document.getElementById('certTabTableViewBtn');
    const tabRemBtn = document.getElementById('certTabRemindersViewBtn');
    const tableView = document.getElementById('certTableView');
    const remView = document.getElementById('certRemindersView');
    const pills = document.getElementById('certStatusPills');

    if (view === 'table') {
        if (tabTableBtn) tabTableBtn.classList.add('active');
        if (tabRemBtn) tabRemBtn.classList.remove('active');
        if (tableView) tableView.style.display = 'flex';
        if (remView) remView.style.display = 'none';
        if (pills) pills.style.display = 'flex';
    } else {
        if (tabTableBtn) tabTableBtn.classList.remove('active');
        if (tabRemBtn) tabRemBtn.classList.add('active');
        if (tableView) tableView.style.display = 'none';
        if (remView) remView.style.display = 'flex';
        if (pills) pills.style.display = 'none';
    }
    renderCertificates();
}

function setCertFilter(filter) {
    currentCertFilter = filter;
    ['all', 'red', 'yellow', 'green'].forEach(f => {
        const btn = document.getElementById('certPill' + f.charAt(0).toUpperCase() + f.slice(1));
        if (btn) {
            if (f === filter) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    });
    renderCertificates();
}

function handleCertSearch(val) {
    certSearchQuery = (val || '').trim().toLowerCase();
    renderCertificates();
}

function clearCertSearch() {
    const input = document.getElementById('certSearchInput');
    if (input) input.value = '';
    certSearchQuery = '';
    renderCertificates();
}

function handleCertProfessionFilter(val) {
    currentCertProfession = val || '';
    renderCertificates();
}

function filterByProfession(prof, e) {
    if (e) e.stopPropagation();
    currentCertProfession = prof || '';
    const select = document.getElementById('certProfessionFilter');
    if (select) select.value = currentCertProfession;
    renderCertificates();
}

function updateProfessionFilterDropdown() {
    const select = document.getElementById('certProfessionFilter');
    if (!select) return;

    // Collect all unique professions and counts from certEmployees
    const profCounts = {};
    let emptyCount = 0;

    certEmployees.forEach(emp => {
        const p = (emp.profession || '').trim();
        if (!p) {
            emptyCount++;
        } else {
            profCounts[p] = (profCounts[p] || 0) + 1;
        }
    });

    const sortedProfs = Object.keys(profCounts).sort((a, b) => a.localeCompare(b, 'pl'));

    let html = `<option value="">👔 Wszyscy pracownicy (dowolne stanowisko)</option>`;
    if (emptyCount > 0) {
        html += `<option value="__empty__">⚠️ Bez stanowiska (${emptyCount})</option>`;
    }

    sortedProfs.forEach(p => {
        html += `<option value="${escapeHtml(p)}">${escapeHtml(p)} (${profCounts[p]})</option>`;
    });

    const prevVal = currentCertProfession;
    select.innerHTML = html;
    if (prevVal && (sortedProfs.includes(prevVal) || prevVal === '__empty__')) {
        select.value = prevVal;
    } else {
        select.value = '';
        currentCertProfession = '';
    }
}

function renderCertificates() {
    const canEdit = canEditCertData();
    const urgentItems = getUrgentCertificates();

    // Populate or sync profession filter dropdown
    updateProfessionFilterDropdown();

    // Counts across all data
    let totalRed = 0;
    let totalYellow = 0;
    let totalGreen = 0;

    certEmployees.forEach(emp => {
        CERT_COLUMNS.forEach(col => {
            const val = emp[col.key];
            if (val) {
                const info = getCertExpiryInfo(val);
                if (info.status === 'red' || info.status === 'expired') totalRed++;
                else if (info.status === 'yellow') totalYellow++;
                else if (info.status === 'green') totalGreen++;
            }
        });
    });

    // Update pill counts
    const cAll = document.getElementById('certPillAllCount');
    const cRed = document.getElementById('certPillRedCount');
    const cYellow = document.getElementById('certPillYellowCount');
    const cGreen = document.getElementById('certPillGreenCount');
    const totalBadge = document.getElementById('certTotalCountBadge');
    const remBadge = document.getElementById('certRemindersCountBadge');

    if (cAll) cAll.textContent = certEmployees.length;
    if (cRed) cRed.textContent = totalRed;
    if (cYellow) cYellow.textContent = totalYellow;
    if (cGreen) cGreen.textContent = totalGreen;
    if (totalBadge) totalBadge.textContent = certEmployees.length;
    if (remBadge) remBadge.textContent = urgentItems.length;

    if (currentCertView === 'reminders') {
        renderCertReminders(urgentItems);
        return;
    }

    // Filter employees for Table View
    const q = certSearchQuery;
    const filter = currentCertFilter;

    let filtered = certEmployees.filter(emp => {
        // Query search (matches name, profession, or certificate date text)
        if (q) {
            const fullName = `${emp.lastName || ''} ${emp.firstName || ''}`.toLowerCase();
            const prof = (emp.profession || '').toLowerCase();
            const matchesName = fullName.includes(q);
            const matchesProf = prof.includes(q);
            const matchesDoc = CERT_COLUMNS.some(col => (emp[col.key] || '').toLowerCase().includes(q));
            if (!matchesName && !matchesProf && !matchesDoc) return false;
        }

        // Profession filter
        if (currentCertProfession) {
            const empProf = (emp.profession || '').trim();
            if (currentCertProfession === '__empty__') {
                if (empProf !== '') return false;
            } else {
                if (empProf.toLowerCase() !== currentCertProfession.toLowerCase()) return false;
            }
        }

        // Status filter
        if (filter !== 'all') {
            const hasMatchingStatus = CERT_COLUMNS.some(col => {
                const val = emp[col.key];
                if (!val) return false;
                const info = getCertExpiryInfo(val);
                if (filter === 'red') return info.status === 'red' || info.status === 'expired';
                if (filter === 'yellow') return info.status === 'yellow';
                if (filter === 'green') return info.status === 'green';
                return false;
            });
            if (!hasMatchingStatus) return false;
        }

        return true;
    });

    const tbody = document.getElementById('certTableBody');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="${CERT_COLUMNS.length + 4}" style="text-align:center; padding:30px; color:var(--muted);">
                    🔍 Brak pracowników spełniających wybrane kryteria.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = filtered.map((emp, index) => {
        const cellsHtml = CERT_COLUMNS.map(col => {
            const val = emp[col.key] || '';
            const info = getCertExpiryInfo(val);
            let cls = `cert-date-chip status-${info.status}`;
            if (canEdit) cls += ' clickable';

            const badgeHtml = info.badge ? `<span class="cert-countdown-badge">${info.badge}</span>` : '';
            const clickHandler = canEdit ? `onclick="openEditEmployeeModal('${emp.id}')" title="Kliknij, aby edytować dane pracownika"` : '';

            return `
                <td>
                    <span class="${cls}" ${clickHandler}>
                        ${escapeHtml(info.raw)}
                        ${badgeHtml}
                    </span>
                </td>
            `;
        }).join('');

        const actionsHtml = canEdit ? `
            <td style="text-align:center;">
                <button class="act-btn edit" onclick="openEditEmployeeModal('${emp.id}')" title="Edytuj">✏️</button>
                <button class="act-btn del" onclick="deleteCertEmployee('${emp.id}')" title="Usuń pracownika">🗑️</button>
            </td>
        ` : '';

        const profBadge = emp.profession
            ? `<span class="cert-prof-tag has-prof ${canEdit ? 'clickable' : ''}" onclick="${canEdit ? `openQuickProfessionModal('${emp.id}', event)` : `filterByProfession('${escapeHtml(emp.profession)}', event)`}" title="${canEdit ? 'Kliknij, aby zmienić stanowisko' : 'Kliknij, aby przefiltrować po tym stanowisku'}">${escapeHtml(emp.profession)}</span>`
            : (canEdit
                ? `<span class="cert-prof-tag empty clickable" onclick="openQuickProfessionModal('${emp.id}', event)" title="Kliknij, aby przypisać stanowisko pracownikowi">+ stanowisko</span>`
                : '');

        return `
            <tr>
                <td class="col-sticky col-lp">${index + 1}</td>
                <td class="col-sticky col-name">
                    <div class="cert-name-cell">
                        <span class="cert-emp-lastname">${escapeHtml(emp.lastName || '')}</span>
                        ${profBadge}
                    </div>
                </td>
                <td class="col-sticky col-fname">${escapeHtml(emp.firstName || '')}</td>
                ${cellsHtml}
                ${actionsHtml}
            </tr>
        `;
    }).join('');
}

function renderCertReminders(urgentItems) {
    const list = document.getElementById('certRemindersList');
    if (!list) return;

    if (!urgentItems || urgentItems.length === 0) {
        list.innerHTML = `
            <div style="grid-column: 1 / -1; text-align:center; padding:40px 20px; color:var(--muted);">
                🎉 Brak dokumentów wygasających w ciągu najbliższego miesiąca! Wszystko jest aktualne.
            </div>
        `;
        return;
    }

    const canEdit = canEditCertData();

    list.innerHTML = urgentItems.map(item => {
        const isExp = item.status === 'expired';
        const cardCls = isExp ? 'cert-reminder-card status-expired' : 'cert-reminder-card';
        const badgeTxt = isExp ? '⚠️ Po terminie' : '⏳ Wygasa wkrótce';

        return `
            <div class="${cardCls}">
                <div class="cert-rem-header">
                    <div class="cert-rem-name">
                        👤 ${escapeHtml(item.empName)}
                        ${item.profession ? `<span class="cert-prof-tag has-prof" style="margin-left:6px; font-size:10px; font-weight:600;">${escapeHtml(item.profession)}</span>` : ''}
                    </div>
                    <span class="cert-rem-badge">${badgeTxt} (${item.badge})</span>
                </div>
                <div class="cert-rem-body">
                    <div class="cert-rem-doc">📄 ${escapeHtml(item.docLabel)}</div>
                    <div class="cert-rem-date">${escapeHtml(item.val)}</div>
                </div>
                <div class="cert-rem-footer">
                    <span>${isExp ? `Przeterminowane o ${Math.abs(item.daysLeft)} dni` : `Pozostało dni: ${item.daysLeft}`}</span>
                    ${canEdit ? `<button class="act-btn edit" onclick="openEditEmployeeModal('${item.empId}')" style="font-size:11px;">✏️ Aktualizuj datę</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

// DYNAMIC POSITION PRESET CHIPS & DATALIST
function renderQuickPositionChips() {
    const grid = document.getElementById('certProfChipsGrid');
    if (!grid) return;

    const canEdit = canEditCertData();
    let currentProf = '';
    if (editingQuickProfEmpId) {
        const emp = certEmployees.find(x => x.id === editingQuickProfEmpId);
        if (emp && emp.profession) currentProf = emp.profession.trim().toLowerCase();
    }

    if (!Array.isArray(CERT_POSITIONS) || CERT_POSITIONS.length === 0) {
        grid.innerHTML = `<span style="font-size:12px; color:var(--muted); padding:4px 0;">Brak zdefiniowanych przycisków. Dodaj nowe stanowisko poniżej.</span>`;
        return;
    }

    grid.innerHTML = CERT_POSITIONS.map(pos => {
        const isSelected = pos.trim().toLowerCase() === currentProf;
        const delBtn = canEdit 
            ? `<button type="button" class="cert-prof-chip-del" onclick="removeQuickPositionPreset('${escapeHtml(pos)}', event)" title="Usuń przycisk '${escapeHtml(pos)}' z listy popularnych">✕</button>`
            : '';

        return `
            <div class="cert-prof-chip-wrap">
                <button type="button" class="cert-prof-chip-btn ${isSelected ? 'selected' : ''}" onclick="selectQuickProfPreset('${escapeHtml(pos)}')">
                    ${escapeHtml(pos)}
                </button>
                ${delBtn}
            </div>
        `;
    }).join('');
}

function renderProfessionDatalist() {
    const datalist = document.getElementById('certProfessionDatalist');
    if (!datalist) return;

    if (!Array.isArray(CERT_POSITIONS)) return;
    datalist.innerHTML = CERT_POSITIONS.map(pos => `
        <option value="${escapeHtml(pos)}"></option>
    `).join('');
}

async function addNewQuickPositionPreset() {
    if (!canEditCertData()) {
        alert("Brak uprawnień do edycji listy stanowisk.");
        return;
    }

    const input = document.getElementById('certNewPositionPresetInput');
    if (!input) return;
    const newPos = input.value.trim();

    if (!newPos) {
        alert("Wpisz nazwę stanowiska.");
        input.focus();
        return;
    }

    const exists = CERT_POSITIONS.some(p => p.toLowerCase() === newPos.toLowerCase());
    if (exists) {
        alert(`Stanowisko "${newPos}" już znajduje się na liście.`);
        input.focus();
        return;
    }

    const updated = [...CERT_POSITIONS, newPos];

    try {
        await db.collection('settings').doc('certificates').set({
            positions: updated,
            updatedBy: currentUser,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        CERT_POSITIONS = updated;
        input.value = '';
        renderQuickPositionChips();
        renderProfessionDatalist();
        logActivity('Dodano nowe stanowisko do listy szybkich przycisków', newPos);
    } catch (e) {
        console.error("Błąd zapisu nowego stanowiska:", e);
        alert("Błąd zapisu: " + e.message);
    }
}

async function removeQuickPositionPreset(pos, e) {
    if (e) e.stopPropagation();
    if (!canEditCertData()) {
        alert("Brak uprawnień do edycji listy stanowisk.");
        return;
    }

    if (!confirm(`Czy na pewno chcesz usunąć przycisk stanowiska "${pos}" z listy popularnych?\n\n(Uwaga: nie usunie to przypisanego stanowiska pracownikom, którzy już je posiadają).`)) {
        return;
    }

    const updated = CERT_POSITIONS.filter(p => p.toLowerCase() !== pos.toLowerCase());

    try {
        await db.collection('settings').doc('certificates').set({
            positions: updated,
            updatedBy: currentUser,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        CERT_POSITIONS = updated;
        renderQuickPositionChips();
        renderProfessionDatalist();
        logActivity('Usunięto stanowisko z listy szybkich przycisków', pos);
    } catch (e) {
        console.error("Błąd usuwania stanowiska:", e);
        alert("Błąd zapisu: " + e.message);
    }
}

async function resetQuickPositionPresetsToDefault() {
    if (!canEditCertData()) return;
    if (!confirm("Czy na pewno chcesz przywrócić domyślny zestaw popularnych przycisków stanowisk?")) {
        return;
    }

    try {
        await db.collection('settings').doc('certificates').set({
            positions: DEFAULT_CERT_POSITIONS,
            updatedBy: currentUser,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        CERT_POSITIONS = [...DEFAULT_CERT_POSITIONS];
        renderQuickPositionChips();
        renderProfessionDatalist();
        logActivity('Przywrócono domyślną listę przycisków stanowisk', '');
    } catch (e) {
        alert("Błąd przywracania listy: " + e.message);
    }
}

// QUICK PROFESSION MODAL
function openQuickProfessionModal(empId, e) {
    if (e) e.stopPropagation();
    if (!canEditCertData()) return;

    const emp = certEmployees.find(x => x.id === empId);
    if (!emp) return;

    editingQuickProfEmpId = empId;
    const title = document.getElementById('certQuickProfTitle');
    if (title) title.textContent = `👔 Stanowisko: ${emp.lastName} ${emp.firstName}`;

    const input = document.getElementById('certQuickProfCustomInput');
    if (input) {
        input.value = emp.profession || '';
        setTimeout(() => input.focus(), 100);
    }

    // Render chips with active selection and delete buttons
    renderQuickPositionChips();

    const addRow = document.getElementById('certProfAddRow');
    if (addRow) {
        addRow.style.display = canEditCertData() ? 'flex' : 'none';
    }

    const modal = document.getElementById('certQuickProfessionModal');
    if (modal) modal.classList.add('open');
}

function closeQuickProfessionModal() {
    editingQuickProfEmpId = null;
    const modal = document.getElementById('certQuickProfessionModal');
    if (modal) modal.classList.remove('open');
}

async function selectQuickProfPreset(val) {
    if (!editingQuickProfEmpId) return;
    const input = document.getElementById('certQuickProfCustomInput');
    if (input) input.value = val;
    await saveQuickProfession(val);
}

async function saveQuickProfession(presetVal) {
    if (!editingQuickProfEmpId || !canEditCertData()) return;
    const input = document.getElementById('certQuickProfCustomInput');
    const val = (presetVal !== undefined ? presetVal : (input ? input.value : '')).trim();

    try {
        await db.collection('cert_employees').doc(editingQuickProfEmpId).update({
            profession: val,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            updatedBy: currentUser
        });
        const emp = certEmployees.find(x => x.id === editingQuickProfEmpId);
        const empName = emp ? `${emp.lastName} ${emp.firstName}` : editingQuickProfEmpId;
        logActivity('Zaktualizowano stanowisko pracownika', `${empName}: ${val || '(brak)'}`);
        closeQuickProfessionModal();
    } catch (err) {
        alert("Błąd zapisu stanowiska: " + err.message);
    }
}

async function clearQuickProfession() {
    await saveQuickProfession('');
}

// ADD / EDIT EMPLOYEE
function openAddEmployeeModal() {
    if (!canEditCertData()) {
        alert("Brak uprawnień do dodawania pracowników.");
        return;
    }
    editingCertEmpId = null;
    document.getElementById('certEmpModalTitle').textContent = '➕ Dodaj pracownika';
    document.getElementById('certEmpLastName').value = '';
    document.getElementById('certEmpFirstName').value = '';
    const profEl = document.getElementById('certEmpProfession');
    if (profEl) profEl.value = '';
    renderCertEmployeeFormFields();
    CERT_COLUMNS.forEach(col => {
        const el = document.getElementById('certEmp_' + col.key);
        if (el) el.value = '';
    });
    const err = document.getElementById('certEmpFormErr');
    if (err) err.style.display = 'none';

    document.getElementById('certEmployeeModal').classList.add('open');
}

function openEditEmployeeModal(empId) {
    if (!canEditCertData()) {
        alert("Brak uprawnień do edycji pracowników.");
        return;
    }
    const emp = certEmployees.find(e => e.id === empId);
    if (!emp) return;

    editingCertEmpId = empId;
    document.getElementById('certEmpModalTitle').textContent = `✏️ Edycja: ${emp.lastName} ${emp.firstName}`;
    document.getElementById('certEmpLastName').value = emp.lastName || '';
    document.getElementById('certEmpFirstName').value = emp.firstName || '';
    const profEl = document.getElementById('certEmpProfession');
    if (profEl) profEl.value = emp.profession || '';
    renderCertEmployeeFormFields();
    CERT_COLUMNS.forEach(col => {
        const el = document.getElementById('certEmp_' + col.key);
        if (el) el.value = emp[col.key] || '';
    });

    const err = document.getElementById('certEmpFormErr');
    if (err) err.style.display = 'none';

    document.getElementById('certEmployeeModal').classList.add('open');
}

function closeCertEmployeeModal() {
    editingCertEmpId = null;
    document.getElementById('certEmployeeModal').classList.remove('open');
}

async function saveCertEmployee() {
    if (!canEditCertData()) return;

    const lastName = document.getElementById('certEmpLastName').value.trim();
    const firstName = document.getElementById('certEmpFirstName').value.trim();
    const profession = (document.getElementById('certEmpProfession')?.value || '').trim();
    const err = document.getElementById('certEmpFormErr');

    if (!lastName || !firstName) {
        if (err) {
            err.textContent = 'Podaj imię i nazwisko pracownika.';
            err.style.display = 'block';
        }
        return;
    }

    const empData = {
        lastName,
        firstName,
        profession,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedBy: currentUser
    };

    CERT_COLUMNS.forEach(col => {
        const el = document.getElementById('certEmp_' + col.key);
        if (el) empData[col.key] = el.value.trim();
    });

    try {
        if (editingCertEmpId) {
            // Update
            await db.collection('cert_employees').doc(editingCertEmpId).update(empData);
            logActivity('Zaktualizowano pracownika w certyfikatach', `${lastName} ${firstName}`);
        } else {
            // New employee
            empData.addedBy = currentUser;
            empData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
            empData.order = certEmployees.length + 1;

            const docRef = await db.collection('cert_employees').add(empData);

            // Add dedicated audit record for admin
            await db.collection('cert_audit').add({
                action: 'add_employee',
                employeeId: docRef.id,
                employeeName: `${lastName} ${firstName}`,
                user: currentUser,
                timestamp: firebase.firestore.FieldValue.serverTimestamp()
            });

            logActivity('Dodano pracownika do certyfikatów', `${lastName} ${firstName}`);
        }

        closeCertEmployeeModal();
    } catch (e) {
        if (err) {
            err.textContent = 'Błąd zapisu: ' + e.message;
            err.style.display = 'block';
        }
    }
}

async function deleteCertEmployee(empId) {
    if (!canEditCertData()) return;
    const emp = certEmployees.find(e => e.id === empId);
    if (!emp) return;

    if (!confirm(`Czy na pewno chcesz usunąć pracownika ${emp.lastName} ${emp.firstName} z listy certyfikatów?`)) {
        return;
    }

    try {
        await db.collection('cert_employees').doc(empId).delete();

        // Audit entry
        db.collection('cert_audit').add({
            action: 'delete_employee',
            employeeName: `${emp.lastName} ${emp.firstName}`,
            user: currentUser,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        logActivity('Usunięto pracownika z certyfikatów', `${emp.lastName} ${emp.firstName}`);
    } catch (e) {
        alert("Błąd usuwania: " + e.message);
    }
}

// EDIT TITLE MODAL (ADMIN)
function openEditTableTitle() {
    if (!canEditCertTitle()) return;
    const input = document.getElementById('certNewTitleInput');
    if (input) input.value = certTableTitle;
    document.getElementById('certEditTitleModal').classList.add('open');
}

function closeEditTableTitle() {
    document.getElementById('certEditTitleModal').classList.remove('open');
}

async function saveTableTitle() {
    if (!canEditCertTitle()) return;
    const input = document.getElementById('certNewTitleInput');
    const newTitle = (input ? input.value : '').trim();
    if (!newTitle) return;

    try {
        await db.collection('settings').doc('certificates').set({
            title: newTitle,
            updatedBy: currentUser,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        certTableTitle = newTitle;
        const titleEl = document.getElementById('certTableTitleText');
        if (titleEl) titleEl.textContent = newTitle;

        logActivity('Zmieniono nazwę tabeli certyfikatów', newTitle);
        closeEditTableTitle();
    } catch (e) {
        alert("Błąd zapisu nazwy: " + e.message);
    }
}

// ADMIN CHANGE TRACKING TAB
function renderAdminCertAudit() {
    const container = document.getElementById('adminCertAuditList');
    if (!container) return;

    if (currentUser !== 'Admin') {
        container.innerHTML = '<div style="color:var(--danger); padding:10px;">Brak uprawnień.</div>';
        return;
    }

    if (!certAuditLogs || certAuditLogs.length === 0) {
        container.innerHTML = '<div style="color:var(--muted); padding:20px; text-align:center;">Brak wpisów w rejestrze dodanych pracowników.</div>';
        return;
    }

    container.innerHTML = `
        <div class="admin-cert-audit-wrap">
            <h3 style="margin-bottom:12px; color:var(--text); font-size:14px;">📜 Rejestr dodanych i zmodyfikowanych pracowników w Certyfikatach</h3>
            ${certAuditLogs.map(log => {
                const timeStr = log.timestamp ? fmtTime(log.timestamp.toDate()) : 'Brak daty';
                let actionBadge = '';
                if (log.action === 'add_employee') {
                    actionBadge = `<span style="background:rgba(16,185,129,0.15); color:var(--success); border:1px solid rgba(16,185,129,0.3); padding:2px 8px; border-radius:6px; font-weight:700; font-size:11px;">➕ Dodano pracownika</span>`;
                } else if (log.action === 'delete_employee') {
                    actionBadge = `<span style="background:rgba(239,68,68,0.15); color:var(--danger); border:1px solid rgba(239,68,68,0.3); padding:2px 8px; border-radius:6px; font-weight:700; font-size:11px;">🗑️ Usunięto</span>`;
                } else if (log.action === 'add_column') {
                    actionBadge = `<span style="background:rgba(139,92,246,0.15); color:#a855f7; border:1px solid rgba(139,92,246,0.3); padding:2px 8px; border-radius:6px; font-weight:700; font-size:11px;">📑 Dodano kolumnę</span>`;
                } else if (log.action === 'delete_column') {
                    actionBadge = `<span style="background:rgba(239,68,68,0.15); color:var(--danger); border:1px solid rgba(239,68,68,0.3); padding:2px 8px; border-radius:6px; font-weight:700; font-size:11px;">🗑️ Usunięto kolumnę</span>`;
                } else if (log.action === 'edit_column') {
                    actionBadge = `<span style="background:rgba(234,179,8,0.15); color:var(--accent); border:1px solid rgba(234,179,8,0.3); padding:2px 8px; border-radius:6px; font-weight:700; font-size:11px;">✏️ Zmiana nazwy</span>`;
                } else {
                    actionBadge = `<span style="background:rgba(59,130,246,0.15); color:var(--blue); border:1px solid rgba(59,130,246,0.3); padding:2px 8px; border-radius:6px; font-weight:700; font-size:11px;">ℹ️ Inicjalizacja</span>`;
                }

                const displayTitle = log.columnName ? `Kolumna: ${log.columnName}` : (log.employeeName || 'Nieznany');

                return `
                    <div class="admin-cert-audit-item">
                        <div>
                            ${actionBadge}
                            <span class="admin-cert-audit-emp" style="margin-left:8px;">${escapeHtml(displayTitle)}</span>
                        </div>
                        <div style="display:flex; align-items:center; gap:12px;">
                            <span class="admin-cert-audit-user">👤 ${escapeHtml(log.user || 'System')}</span>
                            <span class="admin-cert-audit-date">🕒 ${timeStr}</span>
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
    `;
}

// ADD / DELETE COLUMN (ADMIN ONLY)
function openAddColumnModal() {
    if (!canAddCertColumn()) {
        alert("Tylko administrator (Admin) może dodawać nowe kolumny.");
        return;
    }
    const input = document.getElementById('certNewColNameInput');
    const err = document.getElementById('certAddColErr');
    if (input) input.value = '';
    if (err) err.style.display = 'none';
    const modal = document.getElementById('certAddColumnModal');
    if (modal) {
        modal.classList.add('open');
        setTimeout(() => input && input.focus(), 150);
    }
}

function closeAddColumnModal() {
    const modal = document.getElementById('certAddColumnModal');
    if (modal) modal.classList.remove('open');
}

async function saveNewCertColumn() {
    if (!canAddCertColumn()) return;
    const input = document.getElementById('certNewColNameInput');
    const err = document.getElementById('certAddColErr');
    const label = (input ? input.value : '').trim();

    if (!label) {
        if (err) {
            err.textContent = 'Podaj nazwę nowej kolumny.';
            err.style.display = 'block';
        }
        return;
    }

    if (CERT_COLUMNS.some(c => c.label.toLowerCase() === label.toLowerCase())) {
        if (err) {
            err.textContent = 'Kolumna o takiej nazwie już istnieje.';
            err.style.display = 'block';
        }
        return;
    }

    const slug = label
        .toLowerCase()
        .replace(/[ąćęłńóśźż]/g, m => ({ 'ą': 'a', 'ć': 'c', 'ę': 'e', 'ł': 'l', 'ń': 'n', 'ó': 'o', 'ś': 's', 'ź': 'z', 'ż': 'z' }[m] || m))
        .replace(/[^a-z0-9]/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 15) || 'col';
    const key = `col_${slug}_${Date.now().toString(36)}`;

    const newColumn = {
        key: key,
        label: label,
        isCustom: true
    };

    const updatedColumns = [...CERT_COLUMNS, newColumn];

    try {
        await db.collection('settings').doc('certificates').set({
            columns: updatedColumns,
            updatedBy: currentUser,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        CERT_COLUMNS = updatedColumns;
        renderCertTableHeader();
        renderCertEmployeeFormFields();
        renderCertificates();

        await db.collection('cert_audit').add({
            action: 'add_column',
            columnName: label,
            user: currentUser,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        logActivity('Dodano nową kolumnę w certyfikatach', label);
        closeAddColumnModal();
    } catch (e) {
        if (err) {
            err.textContent = 'Błąd zapisu: ' + e.message;
            err.style.display = 'block';
        }
    }
}

async function deleteCertColumn(colKey, event) {
    if (event) event.stopPropagation();
    if (!canAddCertColumn()) return;
    const col = CERT_COLUMNS.find(c => c.key === colKey);
    if (!col) return;

    if (!confirm(`Czy na pewno chcesz usunąć kolumnę "${col.label}"? Kolumna zostanie usunięta z widoku tabeli i eksportu.`)) {
        return;
    }

    const updatedColumns = CERT_COLUMNS.filter(c => c.key !== colKey);

    try {
        await db.collection('settings').doc('certificates').set({
            columns: updatedColumns,
            updatedBy: currentUser,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        CERT_COLUMNS = updatedColumns;
        renderCertTableHeader();
        renderCertEmployeeFormFields();
        renderCertificates();

        await db.collection('cert_audit').add({
            action: 'delete_column',
            columnName: col.label,
            user: currentUser,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        logActivity('Usunięto kolumnę z certyfikatów', col.label);
    } catch (e) {
        alert('Błąd usuwania kolumny: ' + e.message);
    }
}

// EDIT COLUMN NAME (ADMIN ONLY)
function openEditColumnNameModal(colKey, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!canAddCertColumn()) {
        alert("Tylko administrator (Admin) może edytować nazwy kolumn.");
        return;
    }

    const col = CERT_COLUMNS.find(c => c.key === colKey);
    if (!col) return;

    const modal = document.getElementById('certEditColumnModal');
    const input = document.getElementById('certEditColNameInput');
    const keyInput = document.getElementById('certEditColKeyInput');
    const err = document.getElementById('certEditColErr');

    if (input) input.value = col.label;
    if (keyInput) keyInput.value = col.key;
    if (err) err.style.display = 'none';

    if (modal) {
        modal.classList.add('open');
        setTimeout(() => input && input.focus(), 150);
    }
}

function closeEditColumnModal() {
    const modal = document.getElementById('certEditColumnModal');
    if (modal) modal.classList.remove('open');
}

async function saveEditedCertColumn() {
    if (!canAddCertColumn()) return;
    const input = document.getElementById('certEditColNameInput');
    const keyInput = document.getElementById('certEditColKeyInput');
    const err = document.getElementById('certEditColErr');

    const colKey = keyInput ? keyInput.value : '';
    const newLabel = (input ? input.value : '').trim();

    if (!newLabel) {
        if (err) {
            err.textContent = 'Nazwa kolumny nie może być pusta.';
            err.style.display = 'block';
        }
        return;
    }

    const col = CERT_COLUMNS.find(c => c.key === colKey);
    if (!col) return;

    if (CERT_COLUMNS.some(c => c.key !== colKey && c.label.toLowerCase() === newLabel.toLowerCase())) {
        if (err) {
            err.textContent = 'Kolumna o takiej nazwie już istnieje.';
            err.style.display = 'block';
        }
        return;
    }

    const oldLabel = col.label;
    col.label = newLabel;

    try {
        await db.collection('settings').doc('certificates').set({
            columns: CERT_COLUMNS,
            updatedBy: currentUser,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        renderCertTableHeader();
        renderCertEmployeeFormFields();
        renderCertificates();

        await db.collection('cert_audit').add({
            action: 'edit_column',
            columnName: `${oldLabel} ➔ ${newLabel}`,
            user: currentUser,
            timestamp: firebase.firestore.FieldValue.serverTimestamp()
        });

        logActivity('Zmieniono nazwę kolumny w certyfikatach', `${oldLabel} ➔ ${newLabel}`);
        closeEditColumnModal();
    } catch (e) {
        if (err) {
            err.textContent = 'Błąd zapisu: ' + e.message;
            err.style.display = 'block';
        }
    }
}

// MOVE COLUMN (LEFT / RIGHT & DRAG-AND-DROP)
let draggedCertColKey = null;

async function moveCertColumn(colKey, direction, event) {
    if (event) {
        event.stopPropagation();
        event.preventDefault();
    }
    if (!canAddCertColumn()) {
        alert("Tylko administrator (Admin) może zmieniać kolejność kolumn.");
        return;
    }

    const currentIndex = CERT_COLUMNS.findIndex(c => c.key === colKey);
    if (currentIndex === -1) return;

    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= CERT_COLUMNS.length) return;

    const newColumns = [...CERT_COLUMNS];
    const [movedCol] = newColumns.splice(currentIndex, 1);
    newColumns.splice(newIndex, 0, movedCol);

    CERT_COLUMNS = newColumns;
    renderCertTableHeader();
    renderCertEmployeeFormFields();
    renderCertificates();

    try {
        await db.collection('settings').doc('certificates').set({
            columns: newColumns,
            updatedBy: currentUser,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        logActivity('Zmieniono kolejność kolumn w certyfikatach', `${movedCol.label} (${direction < 0 ? 'w lewo' : 'w prawo'})`);
    } catch (e) {
        console.error("Błąd zapisu kolejności kolumn:", e);
        alert("Błąd zapisu kolejności kolumn: " + e.message);
    }
}

function handleCertColDragStart(event, colKey) {
    if (!canAddCertColumn()) return;
    draggedCertColKey = colKey;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', colKey);
    event.currentTarget.classList.add('dragging');
}

function handleCertColDragOver(event) {
    if (!canAddCertColumn()) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const th = event.currentTarget;
    if (th && !th.classList.contains('drag-over')) {
        th.classList.add('drag-over');
    }
}

function handleCertColDragLeave(event) {
    const th = event.currentTarget;
    if (th) th.classList.remove('drag-over');
}

function handleCertColDragEnd(event) {
    draggedCertColKey = null;
    document.querySelectorAll('.col-doc').forEach(el => {
        el.classList.remove('dragging');
        el.classList.remove('drag-over');
    });
}

async function handleCertColDrop(event, targetColKey) {
    if (!canAddCertColumn()) return;
    event.preventDefault();
    const th = event.currentTarget;
    if (th) th.classList.remove('drag-over');

    document.querySelectorAll('.col-doc').forEach(el => {
        el.classList.remove('dragging');
        el.classList.remove('drag-over');
    });

    const sourceColKey = draggedCertColKey || event.dataTransfer.getData('text/plain');
    draggedCertColKey = null;

    if (!sourceColKey || sourceColKey === targetColKey) return;

    const srcIndex = CERT_COLUMNS.findIndex(c => c.key === sourceColKey);
    const targetIndex = CERT_COLUMNS.findIndex(c => c.key === targetColKey);

    if (srcIndex === -1 || targetIndex === -1) return;

    const newColumns = [...CERT_COLUMNS];
    const [movedCol] = newColumns.splice(srcIndex, 1);
    newColumns.splice(targetIndex, 0, movedCol);

    CERT_COLUMNS = newColumns;
    renderCertTableHeader();
    renderCertEmployeeFormFields();
    renderCertificates();

    try {
        await db.collection('settings').doc('certificates').set({
            columns: newColumns,
            updatedBy: currentUser,
            updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        logActivity('Zmieniono kolejność kolumn w certyfikatach', `${movedCol.label} (przeciągnięcie)`);
    } catch (e) {
        console.error("Błąd zapisu kolejności kolumn:", e);
        alert("Błąd zapisu kolejności kolumn: " + e.message);
    }
}

function renderCertTableHeader() {
    const thead = document.getElementById('certTableHead');
    if (!thead) return;

    const canEdit = canEditCertData();
    const isAdmin = canAddCertColumn();

    const colsHtml = CERT_COLUMNS.map((col, index) => {
        const delBtn = (isAdmin && col.isCustom)
            ? `<button class="cert-col-del-btn" onclick="deleteCertColumn('${col.key}', event)" title="Usuń kolumnę ${escapeHtml(col.label)}">✕</button>`
            : '';

        const editBtn = isAdmin
            ? `<button class="cert-col-edit-btn" onclick="openEditColumnNameModal('${col.key}', event)" title="Edytuj nazwę kolumny ${escapeHtml(col.label)}">✏️</button>`
            : '';

        let reorderBtns = '';
        if (isAdmin) {
            const isFirst = index === 0;
            const isLast = index === CERT_COLUMNS.length - 1;
            reorderBtns = `
                <div class="cert-col-reorder-btns">
                    <button class="cert-col-move-btn" ${isFirst ? 'disabled' : ''} onclick="moveCertColumn('${col.key}', -1, event)" title="Przesuń w lewo (◀)">◀</button>
                    <button class="cert-col-move-btn" ${isLast ? 'disabled' : ''} onclick="moveCertColumn('${col.key}', 1, event)" title="Przesuń w prawo (▶)">▶</button>
                </div>
            `;
        }

        const dragAttrs = isAdmin
            ? `draggable="true" ondragstart="handleCertColDragStart(event, '${col.key}')" ondragover="handleCertColDragOver(event)" ondragleave="handleCertColDragLeave(event)" ondrop="handleCertColDrop(event, '${col.key}')" ondragend="handleCertColDragEnd(event)"`
            : '';

        const labelClick = isAdmin ? `onclick="openEditColumnNameModal('${col.key}', event)" title="Kliknij, aby edytować nazwę kolumny"` : '';
        const labelCls = isAdmin ? 'cert-th-label clickable' : 'cert-th-label';

        return `
            <th class="col-doc ${isAdmin ? 'col-draggable' : ''}" data-col="${col.key}" ${dragAttrs} title="${isAdmin ? 'Przeciągnij kolumnę lub użyj strzałek ◀ ▶, aby przesunąć' : ''}">
                <div class="cert-th-content">
                    <span class="${labelCls}" ${labelClick}>${escapeHtml(col.label)}</span>
                    <div class="cert-th-actions">
                        ${reorderBtns}
                        ${editBtn}
                        ${delBtn}
                    </div>
                </div>
            </th>
        `;
    }).join('');

    const actionsTh = canEdit ? `<th class="col-actions" id="certThActions">Akcje</th>` : '';

    thead.innerHTML = `
        <tr>
            <th class="col-sticky col-lp">Lp.</th>
            <th class="col-sticky col-name">Nazwisko</th>
            <th class="col-sticky col-fname">Imię</th>
            ${colsHtml}
            ${actionsTh}
        </tr>
    `;
}

function renderCertEmployeeFormFields() {
    const container = document.getElementById('certEmpDocsContainer');
    if (!container) return;

    container.innerHTML = CERT_COLUMNS.map(col => `
        <div class="form-group">
            <label>${escapeHtml(col.label)}</label>
            <input type="text" id="certEmp_${col.key}" placeholder="DD.MM.RRRR lub RRRR" />
        </div>
    `).join('');
}

// EXPORT TO EXCEL
async function exportCertificatesToExcel() {
    if (typeof ExcelJS === 'undefined') {
        alert("Biblioteka ExcelJS nie została jeszcze załadowana.");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Certyfikaty');

        // Headers
        const headers = ['Lp.', 'Nazwisko', 'Stanowisko / Position', 'Imię', ...CERT_COLUMNS.map(c => c.label)];

        // Title row
        sheet.addRow([certTableTitle]);
        sheet.mergeCells(1, 1, 1, headers.length);
        const titleRow = sheet.getRow(1);
        titleRow.font = { size: 14, bold: true, color: { argb: 'FFE8621A' } };
        titleRow.alignment = { vertical: 'middle', horizontal: 'center' };
        titleRow.height = 30;

        // Header row
        const headerRow = sheet.addRow(headers);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.height = 24;
        headerRow.eachCell(cell => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1E293B' }
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });

        // Data rows
        certEmployees.forEach((emp, idx) => {
            const rowData = [
                idx + 1,
                emp.lastName || '',
                emp.profession || '',
                emp.firstName || '',
                ...CERT_COLUMNS.map(col => emp[col.key] || '')
            ];

            const row = sheet.addRow(rowData);
            row.height = 20;

            row.eachCell((cell, colNumber) => {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
                    right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
                };

                if (colNumber > 4) {
                    // Document date cell formatting
                    const val = cell.value;
                    const info = getCertExpiryInfo(val);
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };

                    if (info.status === 'red' || info.status === 'expired') {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFFEE2E2' }
                        };
                        cell.font = { bold: true, color: { argb: 'FFDC2626' } };
                    } else if (info.status === 'yellow') {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFFEF3C7' }
                        };
                        cell.font = { bold: true, color: { argb: 'FFB45309' } };
                    } else if (info.status === 'green') {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFD1FAE5' }
                        };
                        cell.font = { bold: true, color: { argb: 'FF059669' } };
                    }
                } else {
                    cell.alignment = { vertical: 'middle', horizontal: colNumber === 1 ? 'center' : 'left' };
                }
            });
        });

        // Set column widths
        sheet.columns.forEach((column, i) => {
            if (i === 0) column.width = 6;
            else if (i === 1) column.width = 18;
            else if (i === 2) column.width = 16;
            else if (i === 3) column.width = 16;
            else column.width = 14;
        });

        const todayStr = new Date().toISOString().split('T')[0];
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `VanStev_Certyfikaty_${todayStr}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);
    } catch (e) {
        alert("Błąd eksportu do pliku Excel: " + e.message);
    }
}
