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
let pendingLat = null, pendingLng = null;
let editLat = null, editLng = null;
let map, markers = {};
let editingId = null;
let locToDelete = null;
let currentUser = null;
let eurToPln = 4.3; // Default fallback rate
let addingType = 'location'; // 'location' or 'project'
let activeProjectId = null;
let currentAddSelectedIds = [];
let currentEditSelectedIds = [];

// ===== LOGIN =====
const VALID_USERS = ['radek', 'jola', 'kasia', 'tomek', 'przemek', 'mirek'];
const SYSTEM_PASS = 'qazwsx';

function doLogin() {
    const user = document.getElementById('loginEmail').value.trim().toLowerCase();
    const pass = document.getElementById('loginPass').value.trim();
    const err = document.getElementById('loginErr');

    let isAuthorized = false;
    // Sprawdź Admina lub standardowych użytkowników
    if (user === 'admin' && pass === 'system02') {
        isAuthorized = true;
    } else if (VALID_USERS.includes(user) && pass === SYSTEM_PASS) {
        isAuthorized = true;
    }

    if (!isAuthorized) {
        err.style.display = 'block';
        return;
    }
    const userName = user.charAt(0).toUpperCase() + user.slice(1);
    localStorage.setItem('vs_user', userName);
    setupApp(userName);
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
    localStorage.removeItem('vs_user');
    document.getElementById('loginScreen').style.display = 'flex';
    document.getElementById('app').style.display = 'none';
    document.getElementById('loginEmail').value = '';
    document.getElementById('loginPass').value = '';
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

function updateMapTheme() {
    if (!map) return;
    const isLight = document.body.classList.contains('light-mode');
    // Remove existing tile layers
    map.eachLayer(layer => {
        if (layer instanceof L.TileLayer) map.removeLayer(layer);
    });

    const url = isLight
        ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
        : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

    L.tileLayer(url, {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
        subdomains: 'abcd', maxZoom: 19
    }).addTo(map);
}

// Apply theme on load
if (localStorage.getItem('vs_theme') === 'light') {
    document.body.classList.add('light-mode');
}

// Apply session on load
window.addEventListener('DOMContentLoaded', () => {
    const savedUser = localStorage.getItem('vs_user');
    if (savedUser) {
        setupApp(savedUser);
    }
});

// ===== MAP =====
function initMap() {
    if (map) return;
    map = L.map('map', { center: [52.5, 5.0], zoom: 7, zoomControl: true });
    updateMapTheme();
    updateThemeUI();
    map.on('click', onMapClick);
    reloadMarkers();
}

let tempMarker = null;

function onMapClick(e) {
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
        const driverIcon = p.isDriver ? '🚗 ' : '';
        const plate = p.isDriver && p.carPlate ? ` (${p.carPlate})` : '';
        return `<span style="display:inline-block; border:1px solid var(--border); background:rgba(255,255,255,0.05); padding:2px 6px; border-radius:4px; margin:1px;">${driverIcon}${p.name}${plate}</span>`;
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
        const occ = loc.people ? loc.people.length : 0;
        const isFull = occ >= loc.capacity;
        const color = isFull ? '#E8621A' : '#10b981';
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

function makeProjectIcon(name = 'PROJEKT') {
    return L.divIcon({
        className: '',
        html: `<div style="position:relative; transform: translate(-50%, -100%); display:flex; flex-direction:column; align-items:center;">
            <div style="background:#3b82f6; color:white; padding:5px 14px; border-radius:30px; font-family:'Barlow Condensed', sans-serif; font-weight:800; font-size:14px; white-space:nowrap; box-shadow:0 6px 20px rgba(0,0,0,0.45); border:2.5px solid #fff; line-height:1; text-transform:uppercase; letter-spacing:0.5px;">
                ${name}
            </div>
            <div style="width:0; height:0; border-left:7px solid transparent; border-right:7px solid transparent; border-top:10px solid #3b82f6; margin-top:-1px; filter: drop-shadow(0 4px 4px rgba(0,0,0,0.2));"></div>
        </div>`,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        popupAnchor: [0, -40]
    });
}

function reloadMarkers(data = null) {
    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};
    const dataToUse = data || locations;
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

function addMarker(loc) {
    let m;
    if (loc.type === 'project') {
        m = L.marker([loc.lat, loc.lng], { icon: makeProjectIcon(loc.name) }).addTo(map);
    } else {
        const occ = loc.people ? loc.people.length : 0;
        const isFull = occ >= loc.capacity;
        const color = isFull ? '#E8621A' : '#10b981';
        m = L.marker([loc.lat, loc.lng], { icon: makeIcon(color) }).addTo(map);
    }
    m.bindPopup(makePopupHtml(loc));
    m.on('click', () => { focusLocation(loc.id); });
    markers[loc.id] = m;
}

function makePopupHtml(loc) {
    if (loc.type === 'project') {
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');
        const addrHtml = fullAddr ? `<div class="popup-row">🏡 <span style="font-size:11px;">${fullAddr}</span></div>` : '';
        const addedByHtml = loc.addedBy ? `<div class="popup-row" style="opacity:0.6; font-size:11px;">✍️ Dodał(a): <span>${loc.addedBy}</span></div>` : '';

        const linkedNames = (loc.linkedLocations || []).map(id => {
            const l = locations.find(x => x.id === id);
            return l ? `[#${l.locNumber || '?'}] ${l.name}` : `Nieznana`;
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

    const formatPerson = (p) => {
        if (typeof p === 'string') return `<span class="person-chip" style="border-radius:4px;">${p}</span>`;
        const plate = p.isDriver && p.carPlate ? ` <span class="car-plate">${p.carPlate}</span>` : '';
        const driverIcon = p.isDriver ? '<span style="margin-left:4px;">🚗</span>' : '';
        return `<span class="person-chip" style="border-radius:4px;">${driverIcon}${p.name}${plate}</span>`;
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

        locations = rawDocs;
        applyFilters();
        renderStats();
        if (currentUser === 'Admin') renderAdminPanel();
    }, error => {
        console.error("Błąd synchronizacji:", error);
    });
}

function logActivity(action, details) {
    if (!currentUser) return;
    db.collection('activity').add({
        user: currentUser,
        action: action,
        details: details,
        timestamp: firebase.firestore.FieldValue.serverTimestamp()
    });
}

function calcDays(from, to) {
    if (!from || !to) return null;
    const d = (new Date(to) - new Date(from)) / 86400000;
    return d > 0 ? Math.round(d) : null;
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
let addPeople = []; // Array of objects {name, isDriver, carPlate}

function addNewPerson() {
    addPeople.push({ name: '', isDriver: false, carPlate: '' });
    renderPeopleInputs('addPeopleList', addPeople, 'add');
}

function renderPeopleInputs(containerId, arr, mode) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    arr.forEach((p, i) => {
        if (typeof p === 'string') {
            arr[i] = { name: p, isDriver: false, carPlate: '' };
            p = arr[i];
        }
        const row = document.createElement('div');
        row.className = 'people-row';
        row.innerHTML = `
            <input type="text" value="${p.name}" placeholder="Imię i nazwisko" oninput="updatePersonField('${mode}',${i},'name',this.value)"/>
            <label class="driver-checkbox-wrap">
                <input type="checkbox" ${p.isDriver ? 'checked' : ''} onchange="updatePersonField('${mode}',${i},'isDriver',this.checked); renderPeopleInputs('${containerId}', ${mode === 'add' ? 'addPeople' : 'editPeople'}, '${mode}')"/>
                Kierowca
            </label>
            ${p.isDriver ? `<input type="text" value="${p.carPlate || ''}" placeholder="Nr rej." style="width:80px; text-transform:uppercase;" oninput="updatePersonField('${mode}',${i},'carPlate',this.value.toUpperCase())"/>` : '<div></div>'}
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
            dateFrom: document.getElementById('fDateFrom').value,
            dateTo: document.getElementById('fDateTo').value,
            isIndefinite: document.getElementById('fIndefinite').checked,
            people: [...addPeople].filter(p => p.name.trim()),
            notes: document.getElementById('fNotes').value.trim()
        });
    } else {
        Object.assign(locData, {
            linkedLocations: getSelectedLinkedLocations()
        });
    }

    db.collection('locations').add(locData)
        .then(() => {
            logActivity('Dodano lokalizację', name);
            if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
            resetForm();
            switchTab('list');
        })
        .catch(err => showFormErr("Błąd zapisu: " + err.message));
}

function showFormErr(msg) {
    const e = document.getElementById('formErr');
    e.textContent = '⚠️ ' + msg; e.style.display = 'block';
}

function resetForm() {
    ['fName', 'fZip', 'fCity', 'fStreet', 'fHouseNum', 'addressSearch', 'fCapacity', 'fPrice', 'fCaregiver', 'fDateFrom', 'fDateTo', 'fNotes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('fTotalCost').style.display = 'none';
    document.getElementById('formErr').style.display = 'none';
    document.getElementById('coordDisplay').style.display = 'none';
    document.getElementById('fIndefinite').checked = false;
    document.getElementById('fDateTo').disabled = false;
    addPeople = []; renderPeopleInputs('addPeopleList', addPeople, 'add');
    pendingLat = null; pendingLng = null;
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
    clearAllMarkerHighlights();
}

// ===== LIST =====
function renderList(filteredLocs = null) {
    const list = document.getElementById('locList');
    const empty = document.getElementById('emptyState');
    const count = document.getElementById('locCount');
    const dataToRender = filteredLocs || locations;
    count.textContent = dataToRender.length + ' wpis' + (dataToRender.length === 1 ? '' : dataToRender.length < 5 ? 'y' : 'ów');
    if (!dataToRender.length) { list.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    const houseIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px; color: var(--accent);"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;
    list.innerHTML = dataToRender.map(loc => {
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');

        if (loc.type === 'project') {
            const linkedNames = (loc.linkedLocations || []).map(id => {
                const l = locations.find(x => x.id === id);
                return l ? `<span class="person-chip" style="border-radius:4px; border-color:var(--blue); color:var(--blue);font-weight:700;">[#${l.locNumber || '?'}] ${l.name}</span>` : '';
            }).join('');
            return `<div class="loc-card" id="card-${loc.id}" onclick="focusLoc('${loc.id}')" style="border-left:4px solid var(--blue);">
                <div class="loc-card-head"><div class="loc-name"><span style="font-size:10px; background:var(--blue); color:white; padding:1px 5px; border-radius:3px; margin-right:6px; vertical-align:middle; font-weight:800;">PROJEKT</span>${loc.name}</div><div class="loc-actions"><button class="act-btn edit" onclick="openEdit('${loc.id}',event)">✏️</button><button class="act-btn del" onclick="deleteLocation('${loc.id}',event)">🗑️</button></div></div>
                ${fullAddr ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">📍 ${fullAddr}</div>` : ''}
                <div class="loc-badges" style="margin-top:8px;"><span class="badge badge-blue">Projekt</span></div>
                <div style="margin-top:8px; font-size:11px; color:var(--muted);">✍️ Dodane przez: <strong>${loc.addedBy || 'System'}</strong></div>
                <div class="loc-people" style="margin-top:8px;"><div class="loc-people-title">Przypisane lokalizacje</div>${linkedNames || '<span style="color:var(--muted);font-size:12px;">Brak</span>'}</div>
            </div>`;
        }

        const formatPerson = (p) => {
            if (typeof p === 'string') return `<span class="person-chip" style="border-radius:4px;">${p}</span>`;
            const plate = p.isDriver && p.carPlate ? ` <span class="car-plate">${p.carPlate}</span>` : '';
            const driverIcon = p.isDriver ? '<span style="margin-left:4px;">🚗</span>' : '';
            return `<span class="person-chip" style="border-radius:4px;">${driverIcon}${p.name}${plate}</span>`;
        };

        const numPrefix = loc.locNumber ? `<span style="color:var(--muted); font-size:13px; font-weight:normal;">[#${loc.locNumber}]</span> ` : '';
        const people = loc.people && loc.people.length ? loc.people.map(p => formatPerson(p)).join('') : '<span style="color:var(--muted);font-size:12px;">Brak osób</span>';
        const rs = rentalStatus(loc); const days = calcDays(loc.dateFrom, loc.dateTo);
        const months = days ? (days / 30).toFixed(1) : null;
        const totalCost = months ? (months * parseFloat(loc.price || 0)) : null;
        const dateToFmt = loc.isIndefinite ? 'Nieokreślony' : fmtDate(loc.dateTo);
        const occ = loc.people ? loc.people.length : 0;
        return `<div class="loc-card" id="card-${loc.id}" onclick="focusLoc('${loc.id}')">
            <div class="loc-card-head"><div class="loc-name">${houseIcon} ${numPrefix}${loc.name}</div><div class="loc-actions"><button class="act-btn edit" onclick="openEdit('${loc.id}',event)">✏️</button><button class="act-btn del" onclick="deleteLocation('${loc.id}',event)">🗑️</button></div></div>
            ${fullAddr ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">📍 ${fullAddr}</div>` : ''}
            ${(loc.dateFrom || loc.dateTo || loc.isIndefinite) ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;">📅 ${fmtDate(loc.dateFrom)} → ${dateToFmt}${months ? ` &bull; ${months} m-cy &bull; <strong style="color:var(--accent);">€${totalCost.toFixed(2)}</strong>` : ''}</div>` : ''}
            <div class="loc-badges" style="margin-top:8px;">
                <span class="rental-badge ${rs.cls}">${rs.label}</span>
                ${loc.caregiver ? `<span class="caregiver-badge">👤 ${loc.caregiver}</span>` : ''}
                <span class="badge badge-amber">👥 ${loc.capacity} miejsc</span>
                <span class="badge badge-green">💸 €${parseFloat(loc.price || 0).toFixed(2)} <small>(~${fmtPLN(parseFloat(loc.price || 0) * eurToPln, 0)} PLN)</small></span>
                <span class="badge badge-blue">${occ}/${loc.capacity} zajętych</span>
            </div>
            <div style="margin-top:8px; font-size:11px; color:var(--muted);">✍️ Dodane przez: <strong>${loc.addedBy || 'System'}</strong></div>
            ${loc.notes ? `<div style="margin-top:6px; font-size:11px; padding:6px; background:var(--bg); border-radius:6px; border-left:3px solid var(--accent);">📝 <em>${loc.notes}</em></div>` : ''}
            <div class="loc-people" style="margin-top:8px;"><div class="loc-people-title">Mieszkańcy</div>${people}</div>
        </div>`;
    }).join('');
}

function focusLoc(id) {
    focusLocation(id);
}

function highlightCard(id) {
    document.querySelectorAll('.loc-card').forEach(c => c.classList.remove('selected'));
    const card = document.getElementById('card-' + id);
    if (card) { card.classList.add('selected'); card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); switchTab('list'); }
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
    const locName = locations.find(l => l.id === locToDelete)?.name || 'Nieznana';
    db.collection('locations').doc(locToDelete).delete()
        .then(() => {
            logActivity('Usunięto lokalizację', locName);
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

    document.getElementById('eType').value = loc.type === 'project' ? 'project' : 'location';

    if (loc.type === 'project') {
        document.getElementById('eLocSpecificFields').style.display = 'none';
        document.getElementById('eProjSpecificFields').style.display = 'block';
        document.getElementById('eProjOccSearch').value = '';
        currentEditSelectedIds = [...(loc.linkedLocations || [])];
        renderLinkedLocations('eLinkedLocations', currentEditSelectedIds);
        currentEditSelectedIds.forEach(lid => updateMarkerHighlight(lid, true));
    } else {
        document.getElementById('eLocSpecificFields').style.display = 'block';
        document.getElementById('eProjSpecificFields').style.display = 'none';

        document.getElementById('eCapacity').value = loc.capacity || '';
        document.getElementById('ePrice').value = loc.price || 0;
        document.getElementById('eCaregiver').value = loc.caregiver || '';
        document.getElementById('eDateFrom').value = loc.dateFrom || '';
        document.getElementById('eDateTo').value = loc.dateTo || '';
        const isIndef = !!loc.isIndefinite;
        document.getElementById('eIndefinite').checked = isIndef;
        document.getElementById('eDateTo').disabled = isIndef;

        editPeople = (loc.people || []).map(p => {
            if (typeof p === 'string') return { name: p, isDriver: false, carPlate: '' };
            return { ...p };
        });
        renderPeopleInputs('editPeopleList', editPeople, 'edit');
        updateEditTotalCost();
    }

    editLat = loc.lat;
    editLng = loc.lng;
    document.getElementById('eCoordDisplay').style.display = 'block';
    document.getElementById('eCoordTxt').textContent = editLat.toFixed(5) + ', ' + editLng.toFixed(5);
    document.getElementById('eNotes').value = loc.notes || '';

    document.getElementById('editModal').classList.add('open');
}

function addEditPerson() { editPeople.push({ name: '', isDriver: false, carPlate: '' }); renderPeopleInputs('editPeopleList', editPeople, 'edit'); }

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
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (type === 'location') {
        const capacity = parseInt(document.getElementById('eCapacity').value);
        const price = parseFloat(document.getElementById('ePrice').value);
        if (!capacity || isNaN(price)) { alert('Wypełnij wszystkie wymagane pola.'); return; }

        Object.assign(updatedData, {
            capacity, price,
            caregiver: document.getElementById('eCaregiver').value,
            dateFrom: document.getElementById('eDateFrom').value,
            dateTo: document.getElementById('eDateTo').value,
            isIndefinite: document.getElementById('eIndefinite').checked,
            people: [...editPeople].filter(p => p.name.trim()),
            notes: document.getElementById('eNotes').value.trim()
        });
    } else {
        Object.assign(updatedData, {
            linkedLocations: getEditSelectedLinkedLocations()
        });
    }

    db.collection('locations').doc(editingId).update(updatedData)
        .then(() => {
            logActivity('Edytowano lokalizację', name);
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
    const totalLocs = locations.length;
    const totalCapacity = locations.reduce((s, l) => s + l.capacity, 0);
    const totalPeople = locations.reduce((s, l) => s + (l.people ? l.people.length : 0), 0);
    const totalRevPerMonth = locations.reduce((s, l) => s + parseFloat(l.price || 0), 0);

    const statsGrid = document.getElementById('statsGrid');
    if (statsGrid) {
        statsGrid.innerHTML = `
            <div class="stat-card"><div class="stat-val">${totalLocs}</div><div class="stat-lbl">Lokalizacji</div></div>
            <div class="stat-card"><div class="stat-val">${totalCapacity}</div><div class="stat-lbl">Łączna pojemność</div></div>
            <div class="stat-card"><div class="stat-val">${totalPeople}</div><div class="stat-lbl">Lokatorzy (osoby)</div></div>
            <div class="stat-card">
                <div class="stat-val">€${totalRevPerMonth.toFixed(0)}</div>
                <div style="font-size:11px; color:var(--accent2); font-weight:700; margin-top:2px;">~${fmtPLN(totalRevPerMonth * eurToPln, 0)} PLN</div>
                <div class="stat-lbl" style="margin-top:4px;">Koszt miesięczny (suma)</div>
            </div>
        `;
    }
    const details = document.getElementById('statsDetails');
    if (!details) return;
    if (!locations.length) { details.innerHTML = '<div class="empty-state">...</div>'; return; }
    details.innerHTML = locations.filter(l => l.type !== 'project').map(loc => {
        const occ = loc.people ? loc.people.length : 0;
        const pct = Math.round(occ / loc.capacity * 100);
        const price = parseFloat(loc.price || 0);
        const perPerson = occ > 0 ? (price / occ) : 0;

        return `<div style="background:var(--card2); border:1px solid var(--border); border-radius:12px; padding:12px; margin-bottom:10px;">
            <div style="font-size:13px; font-weight:700; display:flex; justify-content:space-between;">
                <span>🏠 ${loc.name}</span>
                <span style="color:var(--muted); font-size:11px;">#${loc.locNumber || '?'}</span>
            </div>
            <div style="font-size:11px; color:var(--muted); margin-top:4px;">Zajętość: ${occ}/${loc.capacity} (${pct}%)</div>
            <div style="height:6px; background:var(--bg); border-radius:3px; overflow:hidden; margin:8px 0;">
                <div style="height:100%; width:${pct}%; background:linear-gradient(90deg, var(--accent), var(--accent2));"></div>
            </div>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px; margin-top:12px; padding-top:10px; border-top:1px solid var(--border);">
                <div>
                    <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Koszt całkowity:</div>
                    <div style="font-size:14px; color:var(--accent); font-weight:800;">€${price.toFixed(2)}</div>
                    <div style="font-size:11px; color:var(--muted); font-weight:600;">~${fmtPLN(price * eurToPln, 0)} PLN</div>
                </div>
                ${occ > 0 ? `
                <div style="border-left:1px dashed var(--border); padding-left:10px;">
                    <div style="font-size:9px; color:var(--muted); text-transform:uppercase; font-weight:700; margin-bottom:4px;">Na 1 osobę:</div>
                    <div style="font-size:14px; color:var(--success); font-weight:800;">€${perPerson.toFixed(2)}</div>
                    <div style="font-size:11px; color:var(--muted); font-weight:600;">~${fmtPLN(perPerson * eurToPln, 0)} PLN</div>
                </div>
                ` : `
                <div style="border-left:1px dashed var(--border); padding-left:10px; display:flex; align-items:center;">
                    <span style="font-size:10px; color:var(--danger); font-style:italic;">Brak lokatorów</span>
                </div>
                `}
            </div>
            <button onclick="focusLocation('${loc.id}')" style="width:100%; margin-top:12px; background:var(--bg); color:var(--text); border:1px solid var(--border); border-radius:8px; padding:8px; font-size:11px; cursor:pointer; font-weight:600; transition:all 0.2s;">
                📍 Pokaż na mapie
            </button>
        </div>`;
    }).join('');
}

// ===== TABS =====
function switchTab(tab) {
    ['list', 'add', 'stats'].forEach(t => {
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
}

function openAdmin() {
    document.getElementById('adminModal').classList.add('open');
    renderAdminPanel();
}

function closeAdmin() {
    document.getElementById('adminModal').classList.remove('open');
    if (adminUnsubUsers) { adminUnsubUsers(); adminUnsubUsers = null; }
    if (adminUnsubActivity) { adminUnsubActivity(); adminUnsubActivity = null; }
}

let adminUnsubUsers = null;
let adminUnsubActivity = null;

async function renderAdminPanel() {
    if (currentUser !== 'Admin') return;
    const adminList = document.getElementById('adminUserList');
    if (!adminList) return;

    if (adminUnsubUsers) adminUnsubUsers();
    if (adminUnsubActivity) adminUnsubActivity();

    adminList.innerHTML = '<div style="color:var(--muted); font-size:12px; padding:10px;">Łączenie z bazą...</div>';

    const users = ['Radek', 'Jola', 'Kasia', 'Tomek', 'Przemek', 'Mirek', 'Admin'];
    let allActs = [];
    let usersData = {};

    const updateUI = () => {
        let html = '';
        users.forEach(u => {
            const userActs = allActs.filter(a => a.user === u).slice(0, 3);
            const status = usersData[u] || {};
            const isOnline = status.online === true;

            // Sprawdź czy lastSeen nie jest starszy niż 10 minut (zapas) -> alternatywa dla online
            let effectivelyOnline = isOnline;
            if (status.lastSeen) {
                const diff = (new Date() - status.lastSeen.toDate()) / 1000 / 60;
                if (diff > 10 && isOnline) effectivelyOnline = false;
            }

            const loginTime = status.lastLogin ? fmtTime(status.lastLogin.toDate()) : 'Brak danych';

            html += `
                <div style="background:var(--card2); border:1px solid var(--border); border-radius:12px; padding:15px; margin-bottom:12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);">
                    <div style="font-weight:700; font-size:15px; color:var(--accent); margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
                        <span>👤 ${u}</span>
                        <div style="display:flex; align-items:center; gap:8px; background:var(--bg); padding:4px 10px; border-radius:20px; border:1px solid var(--border);">
                            <span style="width:10px; height:10px; border-radius:50%; background:${effectivelyOnline ? 'var(--success)' : '#4b5563'}; box-shadow:${effectivelyOnline ? '0 0 10px var(--success)' : 'none'};"></span>
                            <span style="font-size:11px; font-weight:600; color:${effectivelyOnline ? 'var(--success)' : 'var(--muted)'};">${effectivelyOnline ? 'ONLINE' : 'OFFLINE'}</span>
                        </div>
                    </div>
                    <div style="font-size:12px; color:var(--muted); margin-bottom:12px; padding-bottom:10px; border-bottom:1px dashed var(--border); display:flex; flex-direction:column; gap:2px;">
                        <div>Wejście: <strong style="color:var(--text);">${loginTime}</strong></div>
                        ${status.lastSeen ? `<div style="font-size:10px; opacity:0.8;">Ostatni ruch: ${fmtTime(status.lastSeen.toDate())}</div>` : ''}
                    </div>
                    
                    <div style="font-size:10px; color:var(--muted); margin-bottom:6px; font-weight:700; text-transform:uppercase; letter-spacing:0.5px;">Ostatnia aktywność:</div>
                    <div style="display:flex; flex-direction:column; gap:6px;">
                        ${userActs.length ? userActs.map(a => `
                            <div style="font-size:12px; background:var(--bg); padding:8px 12px; border-radius:8px; border:1px solid var(--border); display:flex; justify-content:space-between; align-items:flex-start;">
                                <div style="display:flex; flex-direction:column;">
                                    <span style="font-weight:600; color:var(--text);">${a.action}</span>
                                    <span style="font-size:11px; color:var(--muted);">${a.details}</span>
                                </div>
                                <span style="font-size:10px; color:var(--muted); background:var(--card2); padding:2px 6px; border-radius:4px;">${a.timestamp ? fmtTime(a.timestamp.toDate()) : '...'}</span>
                            </div>
                        `).join('') : '<div style="font-size:12px; color:var(--muted); font-style:italic; padding:10px; text-align:center; background:var(--bg); border-radius:8px;">Brak zarejestrowanych akcji</div>'}
                    </div>
                </div>
            `;
        });
        adminList.innerHTML = html;
    };

    // Nasłuchiwanie użytkowników
    adminUnsubUsers = db.collection('users').onSnapshot(snap => {
        snap.forEach(d => { usersData[d.id] = d.data(); });
        updateUI();
    }, err => {
        console.error("Admin Users Error:", err);
    });

    // Nasłuchiwanie aktywności
    adminUnsubActivity = db.collection('activity').orderBy('timestamp', 'desc').limit(200).onSnapshot(snap => {
        allActs = snap.docs.map(d => d.data());
        updateUI();
    }, err => {
        console.error("Admin Activity Error:", err);
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
        // Project filter
        if (activeProjectId) {
            const project = locations.find(l => l.id === activeProjectId);
            if (project && project.type === 'project') {
                if (loc.id !== activeProjectId && !(project.linkedLocations || []).includes(loc.id)) {
                    return false;
                }
            }
        }

        // Person search
        const matchesPerson = !q || (loc.people && loc.people.some(p => {
            const name = typeof p === 'string' ? p : p.name;
            return name.toLowerCase().includes(q);
        }));

        // Availability filter
        const occ = loc.people ? loc.people.length : 0;
        const hasSpace = occ < loc.capacity;
        const matchesAvailability = !showOnlyAvailable || hasSpace;

        return matchesPerson && matchesAvailability;
    });

    renderList(filtered);
    reloadMarkers(filtered);
}

function clearProjectFilter() {
    activeProjectId = null;
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

    if (loc.type === 'project') {
        activeProjectId = id;
        const filterInfo = document.getElementById('projectFilterInfo');
        const projNameSpan = document.getElementById('activeProjectName');
        if (filterInfo && projNameSpan) {
            filterInfo.style.display = 'flex';
            projNameSpan.textContent = loc.name;
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
