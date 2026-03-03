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
let currentUser = null;

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
    initMap();
    initDataSync();
    renderStats();
}

document.getElementById('loginPass')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('loginEmail')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });

function doLogout() {
    currentUser = null;
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
        tempMarker = L.marker([lat, lng], { icon: makeTempIcon(), draggable: true }).addTo(map);
        tempMarker.on('dragend', onTempMarkerDrag);

        document.getElementById('eCoordDisplay').style.display = 'block';
        document.getElementById('eCoordTxt').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
        fillAddressFields('edit', lat, lng);
        return;
    }

    pendingLat = lat; pendingLng = lng;
    if (tempMarker) map.removeLayer(tempMarker);
    tempMarker = L.marker([lat, lng], { icon: makeTempIcon(), draggable: true }).addTo(map);
    tempMarker.on('dragend', onTempMarkerDrag);

    document.getElementById('coordDisplay').style.display = 'block';
    document.getElementById('coordTxt').textContent = lat.toFixed(5) + ', ' + lng.toFixed(5);
    fillAddressFields('add', lat, lng);
    switchTab('add');
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
                tempMarker = L.marker([lat, lon], { icon: makeTempIcon(), draggable: true }).addTo(map);
                tempMarker.on('dragend', onTempMarkerDrag);

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

function reloadMarkers() {
    Object.values(markers).forEach(m => map.removeLayer(m));
    markers = {};
    locations.forEach(loc => addMarker(loc));
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
    tempMarker = L.marker([lat, lon], { icon: makeTempIcon(), draggable: true }).addTo(map);
    tempMarker.on('dragend', onTempMarkerDrag);

    if (editingId) {
        editLat = lat; editLng = lon;
        document.getElementById('eCoordDisplay').style.display = 'block';
        document.getElementById('eCoordTxt').textContent = lat.toFixed(5) + ', ' + lon.toFixed(5);
        fillAddressFields('edit', lat, lng);
    } else {
        pendingLat = lat; pendingLng = lon;
        document.getElementById('coordDisplay').style.display = 'block';
        document.getElementById('coordTxt').textContent = lat.toFixed(5) + ', ' + lon.toFixed(5);
        fillAddressFields('add', lat, lng);
        switchTab('add');
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
    const occ = loc.people ? loc.people.length : 0;
    const isFull = occ >= loc.capacity;
    const color = isFull ? '#E8621A' : '#10b981'; // Pomarańczowy jeśli pełno, zielony jeśli wolne miejsca
    const m = L.marker([loc.lat, loc.lng], { icon: makeIcon(color) }).addTo(map);
    m.bindPopup(makePopupHtml(loc));
    m.on('click', () => { highlightCard(loc.id); });
    markers[loc.id] = m;
}

function makePopupHtml(loc) {
    const peopleHtml = loc.people && loc.people.length > 0
        ? loc.people.map(p => `<span class="person-chip">${p}</span>`).join('')
        : '<span style="color:var(--muted);font-size:12px;">Brak osób</span>';

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
    return `<div style="min-width:220px;padding:4px;">
        <div class="popup-name">${houseIcon} ${loc.name}</div>
        <div style="margin-bottom:6px; display:flex; gap:4px; flex-wrap:wrap;">
            <span class="rental-badge ${rs.cls}">${rs.label}</span>
            ${loc.caregiver ? `<span class="caregiver-badge">👤 ${loc.caregiver}</span>` : ''}
        </div>
        ${addrHtml}
        ${caregiverHtml}
        ${dateHtml}
        <div class="popup-row">👥 Miejsc: <span>${loc.capacity}</span></div>
        <div class="popup-row">💰 Koszt za miesiąc: <span>€${parseFloat(loc.price || 0).toFixed(2)}</span></div>
        <div class="popup-row" style="font-size:11px;">📌 <span>${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}</span></div>
        ${addedByHtml}
        <div class="popup-people"><div style="font-size:11px;color:var(--muted);margin-bottom:4px;font-weight:600;">MIESZKAŃCY</div>${peopleHtml}</div>
    </div>`;
}

// ===== HELPERS =====
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

// Real-time synchronization
function initDataSync() {
    db.collection('locations').orderBy('createdAt', 'desc').onSnapshot(snapshot => {
        locations = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));
        reloadMarkers();
        renderList();
        renderStats();
    }, error => {
        console.error("Błąd synchronizacji:", error);
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
let addPeople = [];

function addNewPerson() {
    addPeople.push('');
    renderPeopleInputs('addPeopleList', addPeople, 'add');
}

function renderPeopleInputs(containerId, arr, mode) {
    const c = document.getElementById(containerId);
    if (!c) return;
    c.innerHTML = '';
    arr.forEach((p, i) => {
        const row = document.createElement('div');
        row.className = 'people-row';
        row.innerHTML = `<input type="text" value="${p}" placeholder="Imię i nazwisko" oninput="updatePerson('${mode}',${i},this.value)"/><button onclick="removePerson('${mode}',${i})">×</button>`;
        c.appendChild(row);
    });
}

function updatePerson(mode, idx, val) {
    if (mode === 'add') addPeople[idx] = val;
    else editPeople[idx] = val;
}

function removePerson(mode, idx) {
    if (mode === 'add') { addPeople.splice(idx, 1); renderPeopleInputs('addPeopleList', addPeople, 'add'); }
    else { editPeople.splice(idx, 1); renderPeopleInputs('editPeopleList', editPeople, 'edit'); }
}

function saveLocation() {
    const name = document.getElementById('fName').value.trim();
    const zip = document.getElementById('fZip').value.trim();
    const city = document.getElementById('fCity').value.trim();
    const street = document.getElementById('fStreet').value.trim();
    const houseNum = document.getElementById('fHouseNum').value.trim();
    const capacity = parseInt(document.getElementById('fCapacity').value);
    const price = parseFloat(document.getElementById('fPrice').value);

    if (pendingLat === null) { showFormErr('Kliknij na mapę aby wybrać lokalizację.'); return; }
    if (!name) { showFormErr('Podaj nazwę miejsca.'); return; }
    if (!capacity || capacity < 1) { showFormErr('Podaj liczbę miejsc.'); return; }
    if (isNaN(price) || price < 0) { showFormErr('Podaj prawidłową cenę.'); return; }

    const locData = {
        name, zip, city, street, houseNum, capacity, price,
        caregiver: document.getElementById('fCaregiver').value,
        dateFrom: document.getElementById('fDateFrom').value,
        dateTo: document.getElementById('fDateTo').value,
        isIndefinite: document.getElementById('fIndefinite').checked,
        lat: pendingLat, lng: pendingLng,
        people: [...addPeople].filter(p => p.trim()),
        addedBy: currentUser,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    db.collection('locations').add(locData)
        .then(() => {
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
    ['fName', 'fZip', 'fCity', 'fStreet', 'fHouseNum', 'addressSearch', 'fCapacity', 'fPrice', 'fCaregiver', 'fDateFrom', 'fDateTo'].forEach(id => {
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
}

// ===== LIST =====
function renderList() {
    const list = document.getElementById('locList');
    const empty = document.getElementById('emptyState');
    const count = document.getElementById('locCount');
    count.textContent = locations.length + ' lokalizacj' + (locations.length === 1 ? 'a' : locations.length < 5 ? 'e' : 'i');
    if (!locations.length) { list.innerHTML = ''; empty.style.display = 'block'; return; }
    empty.style.display = 'none';
    const houseIcon = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px; color: var(--accent);"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>`;
    list.innerHTML = locations.map(loc => {
        const people = loc.people && loc.people.length ? loc.people.map(p => `<span class="person-chip">${p}</span>`).join('') : '<span style="color:var(--muted);font-size:12px;">Brak osób</span>';
        const rs = rentalStatus(loc); const days = calcDays(loc.dateFrom, loc.dateTo);
        const months = days ? (days / 30).toFixed(1) : null;
        const totalCost = months ? (months * parseFloat(loc.price || 0)) : null;
        const dateToFmt = loc.isIndefinite ? 'Nieokreślony' : fmtDate(loc.dateTo);
        const occ = loc.people ? loc.people.length : 0;
        const fullAddr = loc.street ? `${loc.street} ${loc.houseNum || ''}, ${loc.zip || ''} ${loc.city || ''}` : (loc.address || '');
        return `<div class="loc-card" id="card-${loc.id}" onclick="focusLoc('${loc.id}')">
            <div class="loc-card-head"><div class="loc-name">${houseIcon} ${loc.name}</div><div class="loc-actions"><button class="act-btn edit" onclick="openEdit('${loc.id}',event)">✏️</button><button class="act-btn del" onclick="deleteLocation('${loc.id}',event)">🗑️</button></div></div>
            ${fullAddr ? `<div style="font-size:11px;color:var(--muted);margin-top:4px;">📍 ${fullAddr}</div>` : ''}
            ${(loc.dateFrom || loc.dateTo || loc.isIndefinite) ? `<div style="font-size:11px;color:var(--muted);margin-top:6px;">📅 ${fmtDate(loc.dateFrom)} → ${dateToFmt}${months ? ` &bull; ${months} m-cy &bull; <strong style="color:var(--accent);">€${totalCost.toFixed(2)}</strong>` : ''}</div>` : ''}
            <div class="loc-badges" style="margin-top:8px;"><span class="rental-badge ${rs.cls}">${rs.label}</span>${loc.caregiver ? `<span class="caregiver-badge">👤 ${loc.caregiver}</span>` : ''}<span class="badge badge-amber">👥 ${loc.capacity} miejsc</span><span class="badge badge-green">💸 €${parseFloat(loc.price || 0).toFixed(2)} za miesiąc</span><span class="badge badge-blue">${occ}/${loc.capacity} zajętych</span></div>
            <div style="margin-top:8px; font-size:11px; color:var(--muted);">✍️ Dodane przez: <strong>${loc.addedBy || 'System'}</strong></div>
            <div class="loc-people" style="margin-top:8px;"><div class="loc-people-title">Mieszkańcy</div>${people}</div>
        </div>`;
    }).join('');
}

function focusLoc(id) {
    const loc = locations.find(l => l.id === id);
    if (!loc || !map) return;
    map.setView([loc.lat, loc.lng], 13);
    if (markers[id]) markers[id].openPopup();
    highlightCard(id);
}

function highlightCard(id) {
    document.querySelectorAll('.loc-card').forEach(c => c.classList.remove('selected'));
    const card = document.getElementById('card-' + id);
    if (card) { card.classList.add('selected'); card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); switchTab('list'); }
}

function deleteLocation(id, e) {
    e?.stopPropagation(); if (!confirm('Usunąć tę lokalizację?')) return;
    db.collection('locations').doc(id).delete()
        .catch(err => alert("Błąd usuwania: " + err.message));
}

// ===== EDIT =====
let editPeople = [];

function openEdit(id, e) {
    e?.stopPropagation(); const loc = locations.find(l => l.id === id); if (!loc) return;
    editingId = id;
    map.setView([loc.lat, loc.lng], 15);
    if (markers[id]) markers[id].openPopup();
    document.getElementById('eName').value = loc.name;
    document.getElementById('eZip').value = loc.zip || '';
    document.getElementById('eCity').value = loc.city || '';
    document.getElementById('eStreet').value = loc.street || '';
    document.getElementById('eHouseNum').value = loc.houseNum || '';
    document.getElementById('eCapacity').value = loc.capacity;
    document.getElementById('ePrice').value = loc.price || 0;
    document.getElementById('eCaregiver').value = loc.caregiver || '';
    document.getElementById('eDateFrom').value = loc.dateFrom || '';
    document.getElementById('eDateTo').value = loc.dateTo || '';
    const isIndef = !!loc.isIndefinite;
    document.getElementById('eIndefinite').checked = isIndef;
    document.getElementById('eDateTo').disabled = isIndef;
    editLat = loc.lat;
    editLng = loc.lng;
    document.getElementById('eCoordDisplay').style.display = 'block';
    document.getElementById('eCoordTxt').textContent = editLat.toFixed(5) + ', ' + editLng.toFixed(5);

    editPeople = [...(loc.people || [])];
    renderPeopleInputs('editPeopleList', editPeople, 'edit');
    updateEditTotalCost();
    document.getElementById('editModal').classList.add('open');
}

function addEditPerson() { editPeople.push(''); renderPeopleInputs('editPeopleList', editPeople, 'edit'); }

function saveEdit() {
    const name = document.getElementById('eName').value.trim();
    const zip = document.getElementById('eZip').value.trim();
    const city = document.getElementById('eCity').value.trim();
    const street = document.getElementById('eStreet').value.trim();
    const houseNum = document.getElementById('eHouseNum').value.trim();
    const capacity = parseInt(document.getElementById('eCapacity').value);
    const price = parseFloat(document.getElementById('ePrice').value);

    if (!name || !capacity || isNaN(price)) { alert('Wypełnij wszystkie wymagane pola.'); return; }

    const updatedData = {
        name, zip, city, street, houseNum, capacity, price,
        lat: editLat, lng: editLng,
        caregiver: document.getElementById('eCaregiver').value,
        dateFrom: document.getElementById('eDateFrom').value,
        dateTo: document.getElementById('eDateTo').value,
        isIndefinite: document.getElementById('eIndefinite').checked,
        people: [...editPeople].filter(p => p.trim()),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    db.collection('locations').doc(editingId).update(updatedData)
        .then(() => {
            closeEdit();
        })
        .catch(err => alert("Błąd edycji: " + err.message));
}

function closeEdit() {
    editingId = null;
    document.getElementById('editModal').classList.remove('open');
    if (tempMarker) { map.removeLayer(tempMarker); tempMarker = null; }
}

// ===== STATS =====
function renderStats() {
    const totalLocs = locations.length;
    const totalCapacity = locations.reduce((s, l) => s + l.capacity, 0);
    const totalPeople = locations.reduce((s, l) => s + (l.people ? l.people.length : 0), 0);
    const totalRevPerDay = locations.reduce((s, l) => s + parseFloat(l.price || 0) * (l.people ? l.people.length : 0), 0);

    const statsGrid = document.getElementById('statsGrid');
    if (statsGrid) {
        statsGrid.innerHTML = `
            <div class="stat-card"><div class="stat-val">${totalLocs}</div><div class="stat-lbl">Lokalizacji</div></div>
            <div class="stat-card"><div class="stat-val">${totalCapacity}</div><div class="stat-lbl">Łączna pojemność</div></div>
            <div class="stat-card"><div class="stat-val">${totalPeople}</div><div class="stat-lbl">Zamieszkałych osób</div></div>
            <div class="stat-card"><div class="stat-val">€${totalRevPerDay.toFixed(0)}</div><div class="stat-lbl">Koszt miesięczny (suma)</div></div>
        `;
    }

    const details = document.getElementById('statsDetails');
    if (!details) return;
    if (!locations.length) { details.innerHTML = '<div class="empty-state">...</div>'; return; }
    details.innerHTML = locations.map(loc => {
        const occ = loc.people ? loc.people.length : 0; const pct = Math.round(occ / loc.capacity * 100);
        return `<div style="background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:8px;">
            <div style="font-size:13px;font-weight:700;">${loc.name}</div>
            <div style="font-size:12px;color:var(--muted);">Zajętość: ${occ}/${loc.capacity} (${pct}%)</div>
            <div style="height:5px;background:var(--bg);border-radius:3px;overflow:hidden;margin:6px 0;"><div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent),#fbbf24);"></div></div>
            <div style="font-size:12px;color:var(--accent);">€${parseFloat(loc.price || 0).toFixed(2)} /miesiąc /os · €${(occ * parseFloat(loc.price || 0)).toFixed(2)} za miesiąc</div>
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
}
