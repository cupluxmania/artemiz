// =====================================================
// Hospital Expo Booth Booking System - Frontend App
// =====================================================
const API = '/api';
const state = {
  token: localStorage.getItem('hes_token') || null,
  user: JSON.parse(localStorage.getItem('hes_user') || 'null'),
  events: [],
  selectedEventId: '',
  boothsPage: 1,
  boothsPageSize: 10,
  boothsTotal: 0,
  boothsSearch: '',
  boothsStatus: '',
};

// ---------- Helpers ----------
function $(sel) { return document.querySelector(sel); }
function $all(sel) { return document.querySelectorAll(sel); }
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}
function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  $('#toast-container').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 300); }, 3200);
}

async function api(path, options = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, options.headers || {});
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  const res = await fetch(`${API}${path}`, { ...options, headers });
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    const message = (data && data.error) || `Request failed (${res.status})`;
    if (res.status === 401) doLogout(false);
    throw new Error(message);
  }
  return data;
}

// ---------- Halls (event-aware plot: International -> Hall 5-10 + Ambulance; else -> Convention/Foyer/Exhibition/Ambulance) ----------
const hallsCache = {}; // event_id -> { halls, isInternational, eventName }

async function getHallsForEventId(eventId) {
  if (!eventId) return { halls: [], isInternational: false };
  if (hallsCache[eventId]) return hallsCache[eventId];
  try {
    const data = await api(`/inventory/halls?event_id=${eventId}`);
    hallsCache[eventId] = data;
    return data;
  } catch (e) {
    return { halls: [], isInternational: false };
  }
}

// Populate a <select> with the halls that apply to the given event, preserving a
// currently-selected value if it's still valid, and optionally prepending a placeholder.
async function populateHallSelect(selectEl, eventId, { placeholder } = {}) {
  const current = selectEl.value;
  const { halls } = await getHallsForEventId(eventId);
  const options = [];
  if (placeholder !== undefined) options.push(`<option value="">${esc(placeholder)}</option>`);
  options.push(...halls.map(h => `<option value="${esc(h)}">${esc(h)}</option>`));
  selectEl.innerHTML = options.join('');
  if (halls.includes(current)) selectEl.value = current;
  return halls;
}

// ---------- Auth ----------
function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('hes_token', token);
  localStorage.setItem('hes_user', JSON.stringify(user));
}

function doLogout(callApi = true) {
  state.token = null;
  state.user = null;
  localStorage.removeItem('hes_token');
  localStorage.removeItem('hes_user');
  $('#app-shell').style.display = 'none';
  $('#login-screen').style.display = 'flex';
  $('#login-username').value = '';
  $('#login-password').value = '';
}

function applyRoleVisibility() {
  const role = state.user?.role;
  $('#nav-users').style.display = role === 'admin' ? 'flex' : 'none';
  const canEdit = role === 'admin' || role === 'staff';
  $('#add-booth-btn').style.display = canEdit ? 'inline-flex' : 'none';
  $('#add-event-btn').style.display = canEdit ? 'inline-flex' : 'none';
  $('#generate-inventory-btn').style.display = canEdit ? 'inline-flex' : 'none';
}

function renderUserCard() {
  const u = state.user;
  if (!u) return;
  $('#sidebar-avatar').textContent = (u.name || u.username || '?').charAt(0).toUpperCase();
  $('#sidebar-avatar').style.background = u.avatar_color || '#2563eb';
  $('#sidebar-username').textContent = u.name || u.username;
  $('#sidebar-role').textContent = u.role;
}

async function initApp() {
  $('#login-screen').style.display = 'none';
  $('#app-shell').style.display = 'flex';
  renderUserCard();
  applyRoleVisibility();
  await loadEvents();
  await switchView('dashboard');
}

// ---------- Login form ----------
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = $('#login-username').value.trim();
  const password = $('#login-password').value;
  const btn = $('#login-submit');
  const label = btn.querySelector('.btn-label');
  const spinner = btn.querySelector('.spinner');
  $('#login-error').style.display = 'none';
  btn.disabled = true; label.style.opacity = '0.6'; spinner.style.display = 'inline-block';
  try {
    const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    setSession(data.token, data.user);
    toast(`Welcome back, ${data.user.name}!`, 'success');
    await initApp();
  } catch (err) {
    $('#login-error').textContent = err.message;
    $('#login-error').style.display = 'block';
  } finally {
    btn.disabled = false; label.style.opacity = '1'; spinner.style.display = 'none';
  }
});

$('#toggle-password').addEventListener('click', () => {
  const input = $('#login-password');
  input.type = input.type === 'password' ? 'text' : 'password';
});

$('#logout-btn').addEventListener('click', () => { doLogout(); toast('Logged out', 'success'); });

// ---------- Sidebar nav ----------
$all('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});
$('#sidebar-toggle').addEventListener('click', () => {
  $('#sidebar').classList.toggle('open');
  $('#sidebar').classList.toggle('collapsed');
});

const VIEW_TITLES = {
  dashboard: 'Dashboard', booths: 'Booth Bookings', halls: 'Halls & Booths', events: 'Events', users: 'User Management', activity: 'Activity Log',
};

async function switchView(view) {
  $all('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $all('.view').forEach((v) => v.style.display = 'none');
  $(`#view-${view}`).style.display = 'block';
  $('#view-title').textContent = VIEW_TITLES[view] || view;

  if (view === 'dashboard') await loadDashboard();
  else if (view === 'booths') await loadBooths();
  else if (view === 'halls') await loadHallsView();
  else if (view === 'events') await loadEvents(true);
  else if (view === 'users') await loadUsers();
  else if (view === 'activity') await loadActivity();
}

// ---------- Global event selector ----------
$('#global-event-select').addEventListener('change', async (e) => {
  state.selectedEventId = e.target.value;
  state.boothsPage = 1;
  hallsViewState.hall = '';
  hallsViewState.page = 1;
  const activeView = document.querySelector('.nav-item.active')?.dataset.view;
  if (activeView === 'dashboard') await loadDashboard();
  if (activeView === 'booths') await loadBooths();
  if (activeView === 'halls') await loadHallsView();
});

async function loadEvents(renderTable = false) {
  const data = await api('/events');
  state.events = data.events;
  const select = $('#global-event-select');
  const formSelect = $('#f-event-id');
  const currentVal = select.value;
  select.innerHTML = '<option value="">All events</option>' + state.events.map(ev => `<option value="${ev.id}">${esc(ev.name)}</option>`).join('');
  select.value = state.selectedEventId || currentVal || '';
  formSelect.innerHTML = state.events.map(ev => `<option value="${ev.id}">${esc(ev.name)}</option>`).join('');

  if (renderTable) {
    const canEdit = state.user.role === 'admin' || state.user.role === 'staff';
    const canDelete = state.user.role === 'admin';
    $('#events-tbody').innerHTML = state.events.map(ev => `
      <tr>
        <td><strong>${esc(ev.name)}</strong></td>
        <td>${esc(ev.location || '-')}</td>
        <td>${esc(ev.start_date || '-')}</td>
        <td>${esc(ev.end_date || '-')}</td>
        <td>${ev.booth_count}</td>
        <td>${ev.is_active ? '<span class="status-badge status-confirmed">Active</span>' : '<span class="status-badge status-cancelled">Inactive</span>'}</td>
        <td class="row-actions">
          ${canEdit ? `<button class="btn btn-secondary" onclick="editEvent(${ev.id})">Edit</button>` : ''}
          ${canDelete ? `<button class="btn btn-danger" onclick="deleteEvent(${ev.id})">Delete</button>` : ''}
        </td>
      </tr>
    `).join('') || `<tr><td colspan="7" class="empty-state">No events yet.</td></tr>`;
  }
}

// ---------- Dashboard ----------
async function loadDashboard() {
  const qs = state.selectedEventId ? `?event_id=${state.selectedEventId}` : '';
  const data = await api(`/dashboard/stats${qs}`);
  $('#stat-total').textContent = data.totals.totalBooths;
  $('#stat-confirmed').textContent = data.totals.confirmed;
  $('#stat-pending').textContent = data.totals.pending;
  $('#stat-cancelled').textContent = data.totals.cancelled;
  $('#stat-std').textContent = data.totals.totalStd;
  $('#stat-exh').textContent = data.totals.totalExh;
  $('#stat-ss').textContent = data.totals.totalSs;
  $('#stat-rs').textContent = data.totals.totalRs;

  renderBarChart('#chart-country', data.byCountry, 'country');
  renderBarChart('#chart-city', data.byCity, 'city');

  $('#recent-table tbody').innerHTML = data.recent.map(r => `
    <tr>
      <td>${esc(r.company_name)}</td>
      <td>${esc(r.nomor_booth || '-')}</td>
      <td>${esc(r.event_name || '-')}</td>
      <td><span class="status-badge status-${r.status}">${esc(r.status)}</span></td>
      <td>${esc(r.updated_at)}</td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="empty-state">No bookings yet.</td></tr>`;

  await loadPaymentSummary();
}

async function loadPaymentSummary() {
  const qs = state.selectedEventId ? `?event_id=${state.selectedEventId}` : '';
  const p = await api(`/payments/summary${qs}`);
  const byCur = p.totalsByCurrency || {};
  const idr = byCur.IDR || { totalPlanned: 0, totalPaid: 0, remaining: 0 };
  const usd = byCur.USD || { totalPlanned: 0, totalPaid: 0, remaining: 0 };

  const plannedStr = [idr.totalPlanned ? formatIDR(idr.totalPlanned) : null, usd.totalPlanned ? formatUSD(usd.totalPlanned) : null].filter(Boolean).join(' + ') || formatIDR(0);
  const paidStr = [idr.totalPaid ? formatIDR(idr.totalPaid) : null, usd.totalPaid ? formatUSD(usd.totalPaid) : null].filter(Boolean).join(' + ') || formatIDR(0);
  const remainingStr = [idr.remaining ? formatIDR(idr.remaining) : null, usd.remaining ? formatUSD(usd.remaining) : null].filter(Boolean).join(' + ') || formatIDR(0);

  const pctIDR = idr.totalPlanned ? Math.round((idr.totalPaid / idr.totalPlanned) * 100) : null;
  const pctUSD = usd.totalPlanned ? Math.round((usd.totalPaid / usd.totalPlanned) * 100) : null;
  const pctLabel = [pctIDR !== null ? `IDR ${pctIDR}%` : null, pctUSD !== null ? `USD ${pctUSD}%` : null].filter(Boolean).join(' · ') || '0%';

  $('#dashboard-payment-summary').innerHTML = `
    <div class="psum-item"><div class="psum-label">Total Contract Value</div><div class="psum-value">${plannedStr}</div></div>
    <div class="psum-item"><div class="psum-label">Total Collected</div><div class="psum-value">${paidStr}</div></div>
    <div class="psum-item"><div class="psum-label">Outstanding</div><div class="psum-value">${remainingStr}</div></div>
    <div class="psum-item"><div class="psum-label">Termins Paid</div><div class="psum-value">${p.terminsPaid} / ${p.terminsTotal} (${pctLabel})</div></div>
  `;

  if (p.overdue && p.overdue.length) {
    $('#dashboard-overdue-list').innerHTML = `
      <div style="font-weight:800; font-size:12.5px; color:var(--red); margin-bottom:8px;">⚠️ Overdue Termin Payments</div>
      <table class="table"><thead><tr><th>Company</th><th>Termin</th><th>Amount</th><th>Due Date</th></tr></thead><tbody>
      ${p.overdue.map(o => `
        <tr>
          <td>${esc(o.company_name)}</td>
          <td>T${o.termin_number}</td>
          <td>${formatMoney(o.amount, o.currency)}</td>
          <td>${esc(o.due_date)}</td>
        </tr>
      `).join('')}
      </tbody></table>
    `;
  } else {
    $('#dashboard-overdue-list').innerHTML = `<div class="empty-state" style="padding:20px;">✅ No overdue termin payments.</div>`;
  }
}

function renderBarChart(sel, rows, key) {
  const container = $(sel);
  if (!rows || rows.length === 0) { container.innerHTML = '<div class="empty-state">No data yet.</div>'; return; }
  const max = Math.max(...rows.map(r => r.c), 1);
  container.innerHTML = rows.map(r => `
    <div class="bar-row">
      <div class="bar-label" title="${esc(r[key])}">${esc(r[key])}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${(r.c / max) * 100}%"></div></div>
      <div class="bar-count">${r.c}</div>
    </div>
  `).join('');
}

// ---------- Booths ----------
$('#booth-search').addEventListener('input', debounce((e) => {
  state.boothsSearch = e.target.value;
  state.boothsPage = 1;
  loadBooths();
}, 350));
$('#filter-status').addEventListener('change', (e) => {
  state.boothsStatus = e.target.value;
  state.boothsPage = 1;
  loadBooths();
});
function debounce(fn, ms) { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; }

async function loadBooths() {
  const params = new URLSearchParams();
  if (state.selectedEventId) params.set('event_id', state.selectedEventId);
  if (state.boothsSearch) params.set('search', state.boothsSearch);
  if (state.boothsStatus) params.set('status', state.boothsStatus);
  params.set('page', state.boothsPage);
  params.set('pageSize', state.boothsPageSize);

  const data = await api(`/booths?${params.toString()}`);
  state.boothsTotal = data.total;
  const canEdit = state.user.role === 'admin' || state.user.role === 'staff';

  $('#booths-tbody').innerHTML = data.rows.map(r => {
    const terminCount = r.termin_count || 1;
    const terminsPaid = r.termins_paid || 0;
    const hasSpk = !!r.spk_date;
    const pct = terminCount > 0 ? Math.round((terminsPaid / terminCount) * 100) : 0;
    const paymentCell = hasSpk
      ? `<div class="payment-progress">
           <div class="payment-progress-track"><div class="payment-progress-fill" style="width:${pct}%"></div></div>
           <div class="payment-progress-label ${terminsPaid === terminCount ? 'complete' : ''}">${terminsPaid}/${terminCount}</div>
         </div>`
      : `<span class="no-spk-label">No SPK</span>`;

    const assigned = r.assigned_booths || [];
    const hall = assigned[0]?.hall || r.keterangan || '-';
    const boothNumbersCell = assigned.length
      ? `<div class="assigned-booths-cell">${assigned.slice(0, 3).map(b => `<span>${esc(b.booth_number)}</span>`).join('')}${assigned.length > 3 ? `<span class="more-badge">+${assigned.length - 3} more</span>` : ''}</div>`
      : `<strong>${esc(r.nomor_booth || '-')}</strong>`;

    let boothTypes = [];
    try { boothTypes = r.booth_types ? JSON.parse(r.booth_types) : []; } catch (e) { boothTypes = []; }
    const typeCell = boothTypes.length ? boothTypes.join(', ') : '-';

    return `
    <tr>
      <td>${esc(hall)}</td>
      <td>${boothNumbersCell}</td>
      <td>${esc(typeCell)}</td>
      <td>${esc(r.company_name)}</td>
      <td>${esc(r.no_va || '-')}</td>
      <td>${r.confirm_std || 0} / ${r.confirm_exh || 0}</td>
      <td>${esc(r.contact_name || '-')}</td>
      <td><span class="status-badge status-${r.status}">${esc(r.status)}</span></td>
      <td>${paymentCell}</td>
      <td class="row-actions">
        <button class="btn btn-secondary" onclick="viewBoothDetail(${r.id})">View</button>
        <button class="btn btn-secondary" onclick="openPaymentModal(${r.id})">💳 Payments</button>
        ${canEdit ? `<button class="btn btn-secondary" onclick="editBooth(${r.id})">Edit</button>` : ''}
        ${canEdit ? `<button class="btn btn-danger" onclick="deleteBooth(${r.id})">Delete</button>` : ''}
      </td>
    </tr>
  `;
  }).join('') || `<tr><td colspan="10" class="empty-state">No booking records found.</td></tr>`;

  $('#booths-count-label').textContent = `${data.total} record${data.total === 1 ? '' : 's'}`;
  renderPagination(data.total, state.boothsPageSize, state.boothsPage, (p) => { state.boothsPage = p; loadBooths(); });
}

function renderPagination(total, pageSize, current, onChange, targetSelector = '#booths-pagination') {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const el = $(targetSelector);
  let html = '';
  const start = Math.max(1, current - 2);
  const end = Math.min(pages, start + 4);
  if (current > 1) html += `<button data-p="${current - 1}">‹</button>`;
  for (let p = start; p <= end; p++) {
    html += `<button data-p="${p}" class="${p === current ? 'active' : ''}">${p}</button>`;
  }
  if (current < pages) html += `<button data-p="${current + 1}">›</button>`;
  el.innerHTML = html;
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => onChange(Number(b.dataset.p))));
}

let allBoothsCache = {};
function cacheBooth(row) { allBoothsCache[row.id] = row; }

async function viewBoothDetail(id) {
  const data = await api(`/booths/${id}`);
  const r = data.row;
  const assigned = r.assigned_booths || [];
  const boothList = assigned.length ? assigned.map(b => `${b.hall} / ${b.booth_number} (${b.size || 'n/a'})`).join('\n  ') : (r.nomor_booth || '-');
  let boothTypes = [];
  try { boothTypes = r.booth_types ? JSON.parse(r.booth_types) : []; } catch (e) { boothTypes = []; }
  alert(
`Company: ${r.company_name}
Hall: ${assigned[0]?.hall || r.keterangan || '-'}
Booths (${assigned.length || 1}):
  ${boothList}
Booth Type: ${boothTypes.length ? boothTypes.join(', ') : '-'}
Country: ${r.country || '-'}
No. VA: ${r.no_va || '-'}
NPWP: ${r.npwp || '-'}
Confirm (STD/EXH): ${r.confirm_std || 0} / ${r.confirm_exh || 0}
Shipping Address: ${r.shipping_address || '-'}
Contact: ${r.contact_name || '-'} | ${r.contact_phone || '-'} | ${r.contact_email || '-'}
Status: ${r.status}
SPK Date: ${r.spk_date || '-'}
SPK Number: ${r.spk_number || '-'}
Contract Value: ${r.contract_value ? formatMoney(r.contract_value, r.currency) : '-'}
Termin Count: ${r.termin_count || 1}
Notes: ${r.notes || '-'}`
  );
}

function formatIDR(n) {
  return 'Rp ' + Math.round(Number(n || 0)).toLocaleString('id-ID');
}
function formatUSD(n) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatMoney(n, currency) {
  return (currency === 'USD') ? formatUSD(n) : formatIDR(n);
}

$('#add-booth-btn').addEventListener('click', () => openBoothModal());
$('#booth-modal-close').addEventListener('click', closeBoothModal);
$('#booth-cancel-btn').addEventListener('click', closeBoothModal);

let selectedBooths = []; // [{id, hall, booth_number, size}] currently attached to the open booking form

async function openBoothModal(row = null) {
  $('#booth-form').reset();
  $('#booth-id').value = row ? row.id : '';
  $('#booth-modal-title').textContent = row ? 'Edit Booking' : 'Add Booking';
  const chosenEventId = row ? row.event_id : (state.selectedEventId || (state.events[0] && state.events[0].id) || '');
  $('#f-event-id').value = chosenEventId;
  await populateHallSelect($('#f-hall'), chosenEventId, { placeholder: '— Select Hall —' });
  $('#f-hall').value = row?.assigned_booths?.[0]?.hall || row?.keterangan || '';
  $('#f-country').value = row?.country || 'INDONESIA';
  selectedBooths = row?.assigned_booths ? row.assigned_booths.map(b => ({ ...b })) : [];
  renderBoothTags();
  let boothTypes = [];
  try {
    if (row?.booth_types) boothTypes = typeof row.booth_types === 'string' ? JSON.parse(row.booth_types) : row.booth_types;
  } catch (e) { boothTypes = []; }
  $all('.f-booth-type').forEach(cb => { cb.checked = boothTypes.includes(cb.value); });
  $('#f-company-name').value = row?.company_name || '';
  $('#f-npwp').value = row?.npwp || '';
  $('#f-no-va').value = row?.no_va || '';
  $('#f-qty-size').value = row?.qty_size || '';
  $('#f-qty-std').value = row?.qty_std ?? 0;
  $('#f-qty-exh').value = row?.qty_exh ?? 0;
  $('#f-confirm-size').value = row?.confirm_size || '';
  $('#f-confirm-std').value = row?.confirm_std ?? 0;
  $('#f-confirm-exh').value = row?.confirm_exh ?? 0;
  $('#f-type-ss').value = row?.type_ss ?? 0;
  $('#f-type-rs').value = row?.type_rs ?? 0;
  $('#f-shipping-address').value = row?.shipping_address || '';
  $('#f-no-npwp').value = row?.no_npwp || '';
  $('#f-npwp-address').value = row?.npwp_address || '';
  $('#f-contact-name').value = row?.contact_name || '';
  $('#f-contact-phone').value = row?.contact_phone || '';
  $('#f-contact-email').value = row?.contact_email || '';
  $('#f-status').value = row?.status || 'pending';
  $('#f-notes').value = row?.notes || '';
  $('#f-spk-date').value = row?.spk_date || '';
  $('#f-spk-number').value = row?.spk_number || '';
  $('#f-termin-count').value = row?.termin_count || 1;
  $('#f-currency').value = row?.currency || 'IDR';
  $('#f-contract-value').value = row?.contract_value || '';
  $('#booth-modal-overlay').style.display = 'flex';
}
function closeBoothModal() { $('#booth-modal-overlay').style.display = 'none'; }

// If the user switches the booking's Event, refresh the Hall dropdown to match that
// event's plot (International -> Hall 5-10 + Ambulance; else -> Convention/Foyer/Exhibition/Ambulance)
// and clear any already-selected booths since they belong to the previous event.
$('#f-event-id').addEventListener('change', async (e) => {
  await populateHallSelect($('#f-hall'), e.target.value, { placeholder: '— Select Hall —' });
  if (selectedBooths.length) {
    selectedBooths = [];
    renderBoothTags();
    toast('Event changed — booth selection was cleared', 'info');
  }
});

// ---------- Booth Tags (in the booking form) ----------
function renderBoothTags() {
  const el = $('#booth-tags-display');
  if (!selectedBooths.length) {
    el.innerHTML = '<span class="booth-tags-empty">No booths selected yet</span>';
    return;
  }
  el.innerHTML = selectedBooths.map(b => `
    <span class="booth-tag" data-inv-id="${b.id}">${esc(b.hall)} / ${esc(b.booth_number)} <button type="button" data-remove-booth="${b.id}">✕</button></span>
  `).join('');
  el.querySelectorAll('[data-remove-booth]').forEach(btn => {
    btn.addEventListener('click', () => {
      const invId = Number(btn.dataset.removeBooth);
      selectedBooths = selectedBooths.filter(b => b.id !== invId);
      renderBoothTags();
    });
  });
}

// ---------- Booth Picker Modal ----------
let pickerState = { page: 1, pageSize: 60, hall: '', search: '', total: 0, rows: [] };

$('#open-booth-picker-btn').addEventListener('click', async () => {
  const eventId = $('#f-event-id').value;
  if (!eventId) { toast('Please select an Event first', 'error'); return; }
  pickerState.page = 1;
  pickerState.hall = $('#f-hall').value || '';
  pickerState.search = '';
  await populateHallSelect($('#picker-hall-filter'), eventId, { placeholder: 'All Halls' });
  $('#picker-hall-filter').value = pickerState.hall;
  $('#picker-search').value = '';
  $('#booth-picker-overlay').style.display = 'flex';
  await loadPickerBooths();
});
$('#booth-picker-close').addEventListener('click', () => $('#booth-picker-overlay').style.display = 'none');
$('#booth-picker-cancel').addEventListener('click', () => $('#booth-picker-overlay').style.display = 'none');

$('#picker-hall-filter').addEventListener('change', (e) => {
  pickerState.hall = e.target.value;
  pickerState.page = 1;
  loadPickerBooths();
});
$('#picker-search').addEventListener('input', debounce((e) => {
  pickerState.search = e.target.value;
  pickerState.page = 1;
  loadPickerBooths();
}, 300));

async function loadPickerBooths() {
  const eventId = $('#f-event-id').value;
  const bookingId = $('#booth-id').value;
  const params = new URLSearchParams();
  params.set('event_id', eventId);
  params.set('page', pickerState.page);
  params.set('pageSize', pickerState.pageSize);
  if (pickerState.hall) params.set('hall', pickerState.hall);
  if (pickerState.search) params.set('search', pickerState.search);
  if (bookingId) params.set('for_booking_id', bookingId);

  $('#picker-summary').textContent = 'Loading booth inventory…';
  try {
    const data = await api(`/inventory?${params.toString()}`);
    pickerState.rows = data.rows;
    pickerState.total = data.total;
    renderPickerGrid();
  } catch (err) {
    $('#picker-summary').textContent = 'Failed to load inventory: ' + err.message;
  }
}

function renderPickerGrid() {
  const selectedIds = new Set(selectedBooths.map(b => b.id));
  $('#booth-picker-grid').innerHTML = pickerState.rows.map(r => {
    const isSelected = selectedIds.has(r.id);
    const isBookedByOther = r.status === 'booked' && !isSelected;
    const cls = r.status === 'blocked' ? 'blocked' : (isBookedByOther ? 'booked' : (isSelected ? 'selected' : ''));
    const clickable = !isBookedByOther && r.status !== 'blocked';
    return `<div class="booth-cell ${cls}" data-inv-id="${r.id}" data-clickable="${clickable}"
              title="${esc(r.hall)} / ${esc(r.booth_number)}${r.booked_by_company ? ' — booked by ' + esc(r.booked_by_company) : ''}">
              ${esc(r.booth_number)}<span class="bc-size">${esc(r.size || '')}</span>
            </div>`;
  }).join('') || '<div class="empty-state">No booth slots match this filter.</div>';

  $('#booth-picker-grid').querySelectorAll('.booth-cell[data-clickable="true"]').forEach(cell => {
    cell.addEventListener('click', () => {
      const invId = Number(cell.dataset.invId);
      const row = pickerState.rows.find(r => r.id === invId);
      const idx = selectedBooths.findIndex(b => b.id === invId);
      if (idx > -1) {
        selectedBooths.splice(idx, 1);
        cell.classList.remove('selected');
      } else {
        selectedBooths.push({ id: row.id, hall: row.hall, booth_number: row.booth_number, size: row.size });
        cell.classList.add('selected');
      }
      updatePickerSelectionCount();
    });
  });

  $('#picker-summary').textContent = `${pickerState.total} booth slot(s) found${pickerState.hall ? ' in ' + pickerState.hall : ''}`;
  renderPickerPagination();
  updatePickerSelectionCount();
}

function updatePickerSelectionCount() {
  $('#picker-selected-count').textContent = `${selectedBooths.length} booth(s) selected`;
}

function renderPickerPagination() {
  const pages = Math.max(1, Math.ceil(pickerState.total / pickerState.pageSize));
  const el = $('#picker-pagination');
  let html = '';
  const cur = pickerState.page;
  const start = Math.max(1, cur - 2);
  const end = Math.min(pages, start + 4);
  if (cur > 1) html += `<button data-p="${cur - 1}">‹</button>`;
  for (let p = start; p <= end; p++) html += `<button data-p="${p}" class="${p === cur ? 'active' : ''}">${p}</button>`;
  if (cur < pages) html += `<button data-p="${cur + 1}">›</button>`;
  el.innerHTML = html;
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => { pickerState.page = Number(b.dataset.p); loadPickerBooths(); }));
}

$('#booth-picker-confirm').addEventListener('click', () => {
  renderBoothTags();
  // Auto-fill Hall if not yet chosen and we have at least one selected booth
  if (!$('#f-hall').value && selectedBooths.length) {
    $('#f-hall').value = selectedBooths[0].hall;
  }
  $('#booth-picker-overlay').style.display = 'none';
});

$('#booth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#booth-id').value;
  const selectedTypes = $all('.f-booth-type:checked').length
    ? Array.from(document.querySelectorAll('.f-booth-type:checked')).map(cb => cb.value)
    : [];
  const hall = $('#f-hall').value;
  const payload = {
    event_id: Number($('#f-event-id').value),
    keterangan: hall,
    nomor_booth: selectedBooths.map(b => b.booth_number).join(', '),
    booth_types: selectedTypes,
    inventory_ids: selectedBooths.map(b => b.id),
    country: $('#f-country').value,
    company_name: $('#f-company-name').value,
    npwp: $('#f-npwp').value,
    no_va: $('#f-no-va').value,
    qty_size: $('#f-qty-size').value,
    qty_std: Number($('#f-qty-std').value || 0),
    qty_exh: Number($('#f-qty-exh').value || 0),
    confirm_size: $('#f-confirm-size').value,
    confirm_std: Number($('#f-confirm-std').value || 0),
    confirm_exh: Number($('#f-confirm-exh').value || 0),
    type_ss: Number($('#f-type-ss').value || 0),
    type_rs: Number($('#f-type-rs').value || 0),
    shipping_address: $('#f-shipping-address').value,
    no_npwp: $('#f-no-npwp').value,
    npwp_address: $('#f-npwp-address').value,
    contact_name: $('#f-contact-name').value,
    contact_phone: $('#f-contact-phone').value,
    contact_email: $('#f-contact-email').value,
    status: $('#f-status').value,
    notes: $('#f-notes').value,
    spk_date: $('#f-spk-date').value || null,
    spk_number: $('#f-spk-number').value,
    termin_count: Number($('#f-termin-count').value || 1),
    currency: $('#f-currency').value || 'IDR',
    contract_value: Number($('#f-contract-value').value || 0),
  };
  try {
    if (id) {
      await api(`/booths/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
      toast('Booking updated', 'success');
    } else {
      await api('/booths', { method: 'POST', body: JSON.stringify(payload) });
      toast('Booking created', 'success');
    }
    closeBoothModal();
    await loadBooths();
    await loadEvents();
  } catch (err) {
    toast(err.message, 'error');
  }
});

window.editBooth = async (id) => {
  const data = await api(`/booths/${id}`);
  openBoothModal(data.row);
};
window.deleteBooth = async (id) => {
  if (!confirm('Delete this booking record? This cannot be undone.')) return;
  try {
    await api(`/booths/${id}`, { method: 'DELETE' });
    toast('Booking deleted', 'success');
    await loadBooths();
    await loadEvents();
  } catch (err) { toast(err.message, 'error'); }
};
window.viewBoothDetail = viewBoothDetail;

// ---------- Payment / Termin Modal ----------
const TERMIN_LABELS = ['T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
let currentPaymentBoothId = null;

async function openPaymentModal(boothId) {
  currentPaymentBoothId = boothId;
  await refreshPaymentModal();
  $('#payment-modal-overlay').style.display = 'flex';
}
window.openPaymentModal = openPaymentModal;

async function refreshPaymentModal() {
  const data = await api(`/payments/booth/${currentPaymentBoothId}`);
  const { booth, payments, totalPaid, totalPlanned, remaining } = data;

  $('#payment-modal-company').textContent = booth.company_name;

  if (!booth.spk_date && !booth.spk_number) {
    $('#payment-spk-info').innerHTML = `
      <div class="spk-item" style="grid-column: span 3;">
        <div class="spk-value" style="color:var(--text-muted); font-weight:600;">⚠️ No SPK date/number set for this booking yet. Edit the booking to set SPK details and number of termin.</div>
      </div>`;
  } else {
    $('#payment-spk-info').innerHTML = `
      <div class="spk-item"><div class="spk-label">SPK Date</div><div class="spk-value">${esc(booth.spk_date || '-')}</div></div>
      <div class="spk-item"><div class="spk-label">SPK Number</div><div class="spk-value">${esc(booth.spk_number || '-')}</div></div>
      <div class="spk-item"><div class="spk-label">Termin Plan</div><div class="spk-value">${booth.termin_count} Termin (max 6)</div></div>
    `;
  }

  $('#payment-summary-bar').innerHTML = `
    <div class="psum-item"><div class="psum-label">Contract Value</div><div class="psum-value">${formatMoney(booth.contract_value, booth.currency)}</div></div>
    <div class="psum-item"><div class="psum-label">Total Paid</div><div class="psum-value">${formatMoney(totalPaid, booth.currency)}</div></div>
    <div class="psum-item"><div class="psum-label">Remaining</div><div class="psum-value">${formatMoney(remaining, booth.currency)}</div></div>
  `;

  const today = new Date().toISOString().slice(0, 10);
  $('#payment-termin-list').innerHTML = payments.map(p => {
    const isOverdue = !p.is_paid && p.due_date && p.due_date < today;
    return `
    <div class="termin-card ${p.is_paid ? 'paid' : ''} ${isOverdue ? 'overdue' : ''}">
      <div class="termin-badge">${TERMIN_LABELS[p.termin_number - 1] || ('T' + p.termin_number)}</div>
      <div class="termin-body">
        <div class="termin-field">
          <label>Amount (${booth.currency === 'USD' ? '$' : 'Rp'})</label>
          <input type="number" min="0" step="${booth.currency === 'USD' ? '0.01' : '1000'}" value="${p.amount || 0}" data-field="amount" data-termin="${p.termin_number}" />
        </div>
        <div class="termin-field">
          <label>Due Date</label>
          <input type="date" value="${p.due_date || ''}" data-field="due_date" data-termin="${p.termin_number}" />
        </div>
        <div class="termin-field">
          <label>Paid Date</label>
          <input type="date" value="${p.paid_date || ''}" data-field="paid_date" data-termin="${p.termin_number}" ${!p.is_paid ? 'disabled' : ''} />
        </div>
        <div class="termin-check">
          <input type="checkbox" id="paid-check-${p.termin_number}" ${p.is_paid ? 'checked' : ''} data-termin="${p.termin_number}" />
          <label for="paid-check-${p.termin_number}">${p.is_paid ? '✅ Paid' : (isOverdue ? '⚠️ Overdue' : 'Mark Paid')}</label>
        </div>
      </div>
      <button class="btn btn-secondary btn-sm" data-save-termin="${p.termin_number}">Save</button>
    </div>
  `;
  }).join('');

  // Wire up checkbox toggle (enable/disable paid_date input immediately, no save yet)
  $('#payment-termin-list').querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const tNum = cb.dataset.termin;
      const paidDateInput = $(`#payment-termin-list input[data-field="paid_date"][data-termin="${tNum}"]`);
      paidDateInput.disabled = !cb.checked;
      if (cb.checked && !paidDateInput.value) paidDateInput.value = today;
    });
  });

  // Wire up save buttons
  $('#payment-termin-list').querySelectorAll('[data-save-termin]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tNum = btn.dataset.saveTermin;
      const amount = $(`#payment-termin-list input[data-field="amount"][data-termin="${tNum}"]`).value;
      const dueDate = $(`#payment-termin-list input[data-field="due_date"][data-termin="${tNum}"]`).value;
      const paidDate = $(`#payment-termin-list input[data-field="paid_date"][data-termin="${tNum}"]`).value;
      const isPaid = $(`#paid-check-${tNum}`).checked;
      try {
        await api(`/payments/booth/${currentPaymentBoothId}/termin/${tNum}`, {
          method: 'PUT',
          body: JSON.stringify({
            amount: Number(amount || 0),
            due_date: dueDate || null,
            paid_date: paidDate || null,
            is_paid: isPaid,
          }),
        });
        toast(`Termin ${tNum} updated`, 'success');
        await refreshPaymentModal();
        await loadBooths();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
  });
}

$('#payment-modal-close').addEventListener('click', () => $('#payment-modal-overlay').style.display = 'none');
$('#payment-close-btn').addEventListener('click', () => $('#payment-modal-overlay').style.display = 'none');

$('#export-btn').addEventListener('click', () => {
  const qs = state.selectedEventId ? `?event_id=${state.selectedEventId}` : '';
  const url = `${API}/export/booths.xlsx${qs}`;
  fetch(url, { headers: { Authorization: `Bearer ${state.token}` } })
    .then(res => res.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hospital-expo-booths.xlsx';
      a.click();
    })
    .catch(() => toast('Export failed', 'error'));
});

$('#export-pdf-btn').addEventListener('click', () => {
  const qs = state.selectedEventId ? `?event_id=${state.selectedEventId}` : '';
  const url = `${API}/export/booths.pdf${qs}`;
  toast('Generating PDF report...', 'info');
  fetch(url, { headers: { Authorization: `Bearer ${state.token}` } })
    .then(res => res.blob())
    .then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'hospital-expo-booths.pdf';
      a.click();
      toast('PDF report downloaded', 'success');
    })
    .catch(() => toast('PDF export failed', 'error'));
});

// ---------- Import Excel/CSV ----------
let importParsedRows = [];

$('#import-btn').addEventListener('click', () => {
  $('#import-event-id').innerHTML = state.events.map(ev => `<option value="${ev.id}">${esc(ev.name)}</option>`).join('');
  if (state.selectedEventId) $('#import-event-id').value = state.selectedEventId;
  $('#import-status').textContent = '';
  $('#import-preview-wrap').style.display = 'none';
  $('#import-confirm-btn').disabled = true;
  importParsedRows = [];
  $('#import-file-input').value = '';
  $('#import-modal-overlay').style.display = 'flex';
});
$('#import-modal-close').addEventListener('click', () => $('#import-modal-overlay').style.display = 'none');
$('#import-cancel-btn').addEventListener('click', () => $('#import-modal-overlay').style.display = 'none');

const dropzone = $('#import-dropzone');
dropzone.addEventListener('click', () => $('#import-file-input').click());
dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files[0]) handleImportFile(e.dataTransfer.files[0]);
});
$('#import-file-input').addEventListener('change', (e) => {
  if (e.target.files && e.target.files[0]) handleImportFile(e.target.files[0]);
});

// Header aliases -> internal field names (mirrors server-side mapping for consistency)
const IMPORT_HEADER_MAP = {
  'keterangan': 'keterangan',
  'nomor booth': 'nomor_booth', 'no booth': 'nomor_booth', 'booth no': 'nomor_booth', 'booth': 'nomor_booth',
  'country': 'country', 'negara': 'country',
  'company name': 'company_name', 'company name ( npwp )': 'company_name', 'company name (npwp)': 'company_name', 'company': 'company_name', 'nama perusahaan': 'company_name',
  'npwp': 'npwp',
  'no. va': 'no_va', 'no va': 'no_va', 'nomor va': 'no_va', 'va': 'no_va',
  'size': 'qty_size', 'quantity size': 'qty_size', 'qty size': 'qty_size',
  'std': 'qty_std', 'quantity std': 'qty_std', 'qty std': 'qty_std',
  'exh': 'qty_exh', 'quantity exh': 'qty_exh', 'qty exh': 'qty_exh',
  'confirm size': 'confirm_size', 'confirm std': 'confirm_std', 'confirm exh': 'confirm_exh',
  'ss': 'type_ss', 'type ss': 'type_ss',
  'rs': 'type_rs', 'type rs': 'type_rs',
  'foyer': 'foyer',
  'shipping address': 'shipping_address',
  'no. npwp': 'no_npwp', 'no npwp': 'no_npwp',
  'npwp address': 'npwp_address',
  'exhibition': 'exhibition',
  'name': 'contact_name', 'contact name': 'contact_name', 'nama': 'contact_name',
  'm. phone': 'contact_phone', 'phone': 'contact_phone', 'contact phone': 'contact_phone', 'no hp': 'contact_phone',
  'email': 'contact_email', 'contact email': 'contact_email',
  'status': 'status', 'notes': 'notes',
};
function normHeader(h) { return String(h || '').trim().toLowerCase().replace(/\s+/g, ' '); }

function handleImportFile(file) {
  $('#import-status').textContent = `Reading ${file.name}...`;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      const wb = XLSX.read(data, { type: 'array' });
      const sheetName = wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

      const numericFields = ['qty_std', 'qty_exh', 'confirm_std', 'confirm_exh', 'type_ss', 'type_rs'];
      const rows = raw.map((r) => {
        const mapped = {};
        for (const key of Object.keys(r)) {
          const target = IMPORT_HEADER_MAP[normHeader(key)];
          if (target) mapped[target] = r[key];
        }
        return mapped;
      }).filter((r) => r.company_name && String(r.company_name).trim() !== '')
        .map((r) => {
          for (const f of numericFields) {
            const n = parseInt(String(r[f] ?? '0').replace(/[^\d-]/g, ''), 10);
            r[f] = Number.isFinite(n) ? n : 0;
          }
          const st = String(r.status || '').toLowerCase();
          r.status = ['pending', 'confirmed', 'cancelled'].includes(st) ? st : 'pending';
          return r;
        });

      importParsedRows = rows;
      $('#import-status').textContent = rows.length
        ? `✅ Parsed "${sheetName}" — ${rows.length} valid rows found (rows without a Company Name were skipped).`
        : `⚠️ No valid rows found. Make sure the sheet has a "Company Name" column.`;
      $('#import-count').textContent = rows.length;
      $('#import-preview-wrap').style.display = rows.length ? 'block' : 'none';
      $('#import-confirm-btn').disabled = rows.length === 0;

      $('#import-preview-table tbody').innerHTML = rows.slice(0, 20).map(r => `
        <tr>
          <td>${esc(r.keterangan || '-')}</td>
          <td>${esc(r.nomor_booth || '-')}</td>
          <td>${esc(r.company_name || '-')}</td>
          <td>${esc(r.no_va || '-')}</td>
          <td>${r.qty_std || 0}</td>
          <td>${r.qty_exh || 0}</td>
          <td><span class="status-badge status-${r.status}">${esc(r.status)}</span></td>
        </tr>
      `).join('') + (rows.length > 20 ? `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);">...and ${rows.length - 20} more rows</td></tr>` : '');
    } catch (err) {
      $('#import-status').textContent = `❌ Could not parse file: ${err.message}`;
      $('#import-confirm-btn').disabled = true;
    }
  };
  reader.readAsArrayBuffer(file);
}

$('#import-confirm-btn').addEventListener('click', async () => {
  const event_id = Number($('#import-event-id').value);
  if (!event_id) { toast('Please select a target event', 'error'); return; }
  if (!importParsedRows.length) { toast('No rows to import', 'error'); return; }
  try {
    const data = await api('/booths/bulk-import', { method: 'POST', body: JSON.stringify({ event_id, rows: importParsedRows }) });
    toast(`Imported ${data.inserted} booking rows successfully`, 'success');
    $('#import-modal-overlay').style.display = 'none';
    await loadBooths();
    await loadEvents();
  } catch (err) { toast(err.message, 'error'); }
});

// ---------- Events modal ----------
$('#add-event-btn').addEventListener('click', () => openEventModal());
$('#event-modal-close').addEventListener('click', closeEventModal);
$('#event-cancel-btn').addEventListener('click', closeEventModal);

function openEventModal(ev = null) {
  $('#event-form').reset();
  $('#event-id').value = ev ? ev.id : '';
  $('#event-modal-title').textContent = ev ? 'Edit Event' : 'Add Event';
  $('#ev-name').value = ev?.name || '';
  $('#ev-location').value = ev?.location || '';
  $('#ev-start').value = ev?.start_date || '';
  $('#ev-end').value = ev?.end_date || '';
  $('#event-modal-overlay').style.display = 'flex';
}
function closeEventModal() { $('#event-modal-overlay').style.display = 'none'; }

$('#event-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#event-id').value;
  const payload = {
    name: $('#ev-name').value,
    location: $('#ev-location').value,
    start_date: $('#ev-start').value,
    end_date: $('#ev-end').value,
  };
  try {
    if (id) await api(`/events/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/events', { method: 'POST', body: JSON.stringify(payload) });
    toast('Event saved', 'success');
    closeEventModal();
    await loadEvents(true);
  } catch (err) { toast(err.message, 'error'); }
});

window.editEvent = (id) => {
  const ev = state.events.find(e => e.id === id);
  openEventModal(ev);
};
window.deleteEvent = async (id) => {
  if (!confirm('Delete this event and ALL its booking records?')) return;
  try {
    await api(`/events/${id}`, { method: 'DELETE' });
    toast('Event deleted', 'success');
    await loadEvents(true);
  } catch (err) { toast(err.message, 'error'); }
};

// ---------- Users ----------
async function loadUsers() {
  const data = await api('/users');
  $('#users-tbody').innerHTML = data.rows.map(u => `
    <tr>
      <td>${esc(u.name)}</td>
      <td>${esc(u.username)}</td>
      <td><span class="role-badge role-${u.role}">${esc(u.role)}</span></td>
      <td>${u.is_active ? '<span class="status-badge status-confirmed">Active</span>' : '<span class="status-badge status-cancelled">Disabled</span>'}</td>
      <td>${esc((u.created_at || '').split(' ')[0])}</td>
      <td class="row-actions">
        <button class="btn btn-secondary" onclick='editUser(${u.id})'>Edit</button>
        <button class="btn btn-danger" onclick="deleteUser(${u.id})">Delete</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="6" class="empty-state">No users yet.</td></tr>`;
  window._usersCache = data.rows;
}

$('#add-user-btn').addEventListener('click', () => openUserModal());
$('#user-modal-close').addEventListener('click', closeUserModal);
$('#user-cancel-btn').addEventListener('click', closeUserModal);

function openUserModal(u = null) {
  $('#user-form').reset();
  $('#user-id').value = u ? u.id : '';
  $('#user-modal-title').textContent = u ? 'Edit User' : 'Add User';
  $('#u-name').value = u?.name || '';
  $('#u-username').value = u?.username || '';
  $('#u-username').disabled = !!u;
  $('#u-password').required = !u;
  $('#u-password-label').textContent = u ? 'New Password (leave blank to keep)' : 'Password *';
  $('#u-role').value = u?.role || 'staff';
  $('#user-modal-overlay').style.display = 'flex';
}
function closeUserModal() { $('#user-modal-overlay').style.display = 'none'; $('#u-username').disabled = false; }

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#user-id').value;
  const payload = {
    name: $('#u-name').value,
    username: $('#u-username').value,
    password: $('#u-password').value,
    role: $('#u-role').value,
  };
  try {
    if (id) await api(`/users/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    else await api('/users', { method: 'POST', body: JSON.stringify(payload) });
    toast('User saved', 'success');
    closeUserModal();
    await loadUsers();
  } catch (err) { toast(err.message, 'error'); }
});

window.editUser = (id) => {
  const u = (window._usersCache || []).find(x => x.id === id);
  openUserModal(u);
};
window.deleteUser = async (id) => {
  if (!confirm('Delete this user account?')) return;
  try {
    await api(`/users/${id}`, { method: 'DELETE' });
    toast('User deleted', 'success');
    await loadUsers();
  } catch (err) { toast(err.message, 'error'); }
};

// ---------- Activity ----------
async function loadActivity() {
  const data = await api('/dashboard/activity');
  $('#activity-tbody').innerHTML = data.rows.map(r => `
    <tr>
      <td>${esc(r.created_at)}</td>
      <td>${esc(r.user_name || r.username || 'System')}</td>
      <td>${esc(r.action)}</td>
      <td>${esc(r.details || '-')}</td>
    </tr>
  `).join('') || `<tr><td colspan="4" class="empty-state">No activity recorded yet.</td></tr>`;
}

// ---------- Halls & Booths (Master Inventory) ----------
const HALL_ICON_MAP = {
  'Hall 5': '🏟️', 'Hall 6': '🏬', 'Hall 7': '🏢', 'Hall 8': '🏛️', 'Hall 9': '🏫', 'Hall 10': '🏭',
  'Ambulance': '🚑', 'Convention': '🏛️', 'Foyer': '🚪', 'Exhibition': '🖼️',
};
const hallsViewState = { page: 1, pageSize: 100, hall: '', status: '', search: '', total: 0 };

async function loadHallsView() {
  const eventId = state.selectedEventId || (state.events[0] && state.events[0].id);
  if (!eventId) {
    $('#halls-summary-cards').innerHTML = '';
    $('#halls-tbody').innerHTML = `<tr><td colspan="6" class="empty-state">Select an event from the top bar to view its booth inventory.</td></tr>`;
    return;
  }

  // byHall comes back pre-ordered to match this event's plot: International events get
  // Hall 5-10 + Ambulance; everything else gets Convention / Foyer / Exhibition / Ambulance.
  const summary = await api(`/inventory/summary?event_id=${eventId}`);

  $('#halls-active-filter-header h3').dataset.plotLabel = summary.isInternational ? "🌐 International plot" : '🏠 Domestic plot';

  $('#halls-summary-cards').innerHTML = summary.byHall.map((h, idx) => {
    const isActive = hallsViewState.hall === h.hall;
    return `
    <button type="button" class="hall-card hall-card-c${idx % 7} ${isActive ? 'active' : ''}" data-hall="${esc(h.hall)}">
      <div class="hall-icon">${HALL_ICON_MAP[h.hall] || '🏬'}</div>
      <div class="hall-body">
        <div class="hall-value">${h.booked}/${h.total}</div>
        <div class="hall-label">${esc(h.hall)}</div>
      </div>
    </button>`;
  }).join('');

  $('#halls-summary-cards').querySelectorAll('.hall-card').forEach(card => {
    card.addEventListener('click', () => {
      const hall = card.dataset.hall;
      hallsViewState.hall = hallsViewState.hall === hall ? '' : hall;
      hallsViewState.page = 1;
      loadHallsView();
    });
  });

  const plotLabel = summary.isInternational ? "🌐 International plot" : '🏠 Domestic plot';
  $('#halls-active-filter-header h3').textContent = hallsViewState.hall ? `${hallsViewState.hall} Booths` : `All Halls (${plotLabel})`;
  $('#halls-clear-filter').style.display = hallsViewState.hall ? 'inline' : 'none';

  await loadHallsTable(eventId);
}

$('#halls-clear-filter').addEventListener('click', () => {
  hallsViewState.hall = '';
  hallsViewState.page = 1;
  loadHallsView();
});

$('#halls-status-pills').addEventListener('click', (e) => {
  const btn = e.target.closest('.status-pill');
  if (!btn) return;
  $all('#halls-status-pills .status-pill').forEach(p => p.classList.remove('active'));
  btn.classList.add('active');
  hallsViewState.status = btn.dataset.status;
  hallsViewState.page = 1;
  loadHallsView();
});

async function loadHallsTable(eventId) {
  const params = new URLSearchParams();
  params.set('event_id', eventId);
  params.set('page', hallsViewState.page);
  params.set('pageSize', hallsViewState.pageSize);
  if (hallsViewState.hall) params.set('hall', hallsViewState.hall);
  if (hallsViewState.status) params.set('status', hallsViewState.status);
  if (hallsViewState.search) params.set('search', hallsViewState.search);

  const data = await api(`/inventory?${params.toString()}`);
  hallsViewState.total = data.total;
  const canEdit = state.user.role === 'admin' || state.user.role === 'staff';
  const canDelete = state.user.role === 'admin';

  $('#halls-tbody').innerHTML = data.rows.map(r => `
    <tr>
      <td>${esc(r.hall)}</td>
      <td>${canEdit ? `<button type="button" class="booth-slot-link" onclick="openEditSlotModal(${r.id})">${esc(r.booth_number)}</button>` : `<strong>${esc(r.booth_number)}</strong>`}</td>
      <td>${esc(r.size || '-')}</td>
      <td><span class="status-badge status-${r.status === 'available' ? 'confirmed' : (r.status === 'booked' ? 'pending' : 'cancelled')}">${esc(r.status)}</span></td>
      <td>${esc(r.booked_by_company || '-')}</td>
      <td class="row-actions">
        ${canEdit ? `<button class="btn btn-secondary btn-sm" onclick="openEditSlotModal(${r.id})">✏️ Edit</button>` : ''}
        ${canEdit && r.status !== 'booked' ? `<button class="btn btn-secondary btn-sm" onclick="toggleBlockSlot(${r.id}, '${r.status}')">${r.status === 'blocked' ? 'Unblock' : 'Block'}</button>` : ''}
        ${canDelete && r.status !== 'booked' ? `<button class="btn btn-danger btn-sm" onclick="deleteInventorySlot(${r.id})">Delete</button>` : ''}
      </td>
    </tr>
  `).join('') || `<tr><td colspan="6" class="empty-state">No booth slots found for this filter.</td></tr>`;

  $('#halls-count-label').textContent = `${data.total} slot${data.total === 1 ? '' : 's'}`;
  renderPagination(data.total, hallsViewState.pageSize, hallsViewState.page, (p) => { hallsViewState.page = p; loadHallsTable(eventId); }, '#halls-pagination');
}

$('#halls-view-search').addEventListener('input', debounce((e) => { hallsViewState.search = e.target.value; hallsViewState.page = 1; loadHallsView(); }, 300));

window.toggleBlockSlot = async (id, currentStatus) => {
  const newStatus = currentStatus === 'blocked' ? 'available' : 'blocked';
  try {
    await api(`/inventory/${id}`, { method: 'PUT', body: JSON.stringify({ status: newStatus }) });
    toast(`Booth slot ${newStatus}`, 'success');
    await loadHallsView();
  } catch (err) { toast(err.message, 'error'); }
};
window.deleteInventorySlot = async (id) => {
  if (!confirm('Delete this booth slot from inventory?')) return;
  try {
    await api(`/inventory/${id}`, { method: 'DELETE' });
    toast('Booth slot deleted', 'success');
    await loadHallsView();
  } catch (err) { toast(err.message, 'error'); }
};

// ---------- Edit Booth Slot Modal (direct edit of hall/booth number/size/status) ----------
window.openEditSlotModal = async (id) => {
  try {
    const data = await api(`/inventory/${id}`);
    const slot = data.row;
    if (!slot) { toast('Booth slot not found', 'error'); return; }

    await populateHallSelect($('#es-hall'), slot.event_id);
    $('#es-id').value = slot.id;
    $('#es-hall').value = slot.hall;
    $('#es-booth-number').value = slot.booth_number;
    $('#es-size').value = slot.size || '';
    $('#es-status').value = slot.status;
    const isBooked = slot.status === 'booked';
    $('#es-booked-notice').style.display = isBooked ? 'block' : 'none';
    $('#es-hall').disabled = isBooked;
    $('#es-booth-number').disabled = isBooked;
    $('#edit-slot-overlay').style.display = 'flex';
  } catch (err) {
    toast(err.message, 'error');
  }
};
$('#edit-slot-close').addEventListener('click', () => $('#edit-slot-overlay').style.display = 'none');
$('#edit-slot-cancel').addEventListener('click', () => $('#edit-slot-overlay').style.display = 'none');

$('#edit-slot-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#es-id').value;
  const payload = {
    hall: $('#es-hall').value,
    booth_number: $('#es-booth-number').value,
    size: $('#es-size').value,
    status: $('#es-status').value,
  };
  try {
    await api(`/inventory/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
    toast('Booth slot updated', 'success');
    $('#edit-slot-overlay').style.display = 'none';
    await loadHallsView();
  } catch (err) {
    toast(err.message, 'error');
  }
});

// ---------- Generate Inventory Modal ----------
$('#generate-inventory-btn').addEventListener('click', async () => {
  $('#gi-event-id').innerHTML = state.events.map(ev => `<option value="${ev.id}">${esc(ev.name)}</option>`).join('');
  if (state.selectedEventId) $('#gi-event-id').value = state.selectedEventId;
  await populateHallSelect($('#gi-hall'), $('#gi-event-id').value);
  $('#generate-inventory-overlay').style.display = 'flex';
});
$('#gi-event-id').addEventListener('change', (e) => populateHallSelect($('#gi-hall'), e.target.value));
$('#generate-inventory-close').addEventListener('click', () => $('#generate-inventory-overlay').style.display = 'none');
$('#generate-inventory-cancel').addEventListener('click', () => $('#generate-inventory-overlay').style.display = 'none');

$('#generate-inventory-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    event_id: Number($('#gi-event-id').value),
    hall: $('#gi-hall').value,
    count: Number($('#gi-count').value || 0),
    size: $('#gi-size').value || '3x3',
    prefix: $('#gi-prefix').value || undefined,
  };
  try {
    const data = await api('/inventory/generate', { method: 'POST', body: JSON.stringify(payload) });
    toast(`Generated ${data.inserted} new booth slots in ${payload.hall}`, 'success');
    $('#generate-inventory-overlay').style.display = 'none';
    await loadHallsView();
  } catch (err) { toast(err.message, 'error'); }
});

// ---------- Bootstrap ----------
(async function bootstrap() {
  if (state.token && state.user) {
    try {
      await api('/auth/me');
      await initApp();
      return;
    } catch (e) {
      doLogout(false);
    }
  }
  $('#login-screen').style.display = 'flex';
  $('#app-shell').style.display = 'none';
})();
