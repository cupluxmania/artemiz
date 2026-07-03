const CHANNEL = {
  whatsapp: { label: "WhatsApp", color: "#25D366" },
  telegram: { label: "Telegram", color: "#2AABEE" },
};
const AMBER = "#FFB454";

const ICONS = {
  search: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8B909C" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
  send: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0F1115" stroke-width="2.5"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
  phone: `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0F1115" stroke-width="3"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  paperplane: `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#0F1115" stroke-width="3"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`,
  paperclip: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B909C" stroke-width="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>`,
  smile: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B909C" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`,
  back: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EDEEF2" stroke-width="2"><path d="m12 19-7-7 7-7"/><path d="M19 12H5"/></svg>`,
  check: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6 7 17l-5-5"/><path d="m22 10-7.5 7.5L13 16"/></svg>`,
  tag: `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#EDEEF2" stroke-width="2"><path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.41 0l8.29-8.29a1 1 0 0 0 0-1.41L12 2Z"/><circle cx="7" cy="7" r="1"/></svg>`,
  clock: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8B909C" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
};

const AVATAR_HUES = ["#7C6BFF", "#FF8A65", "#4ECDC4", "#F4A259", "#7BA5FF"];

function initials(name) {
  return name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}
function avatarColor(name) {
  return AVATAR_HUES[name.charCodeAt(0) % AVATAR_HUES.length];
}
function el(tag, attrs = {}, html = "") {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "style") node.style.cssText = v;
    else node.setAttribute(k, v);
  });
  if (html) node.innerHTML = html;
  return node;
}

const state = {
  conversations: [],
  selectedId: null,
  filter: "all",
  query: "",
  mobileView: "list",
  whatsapp: { ready: false },
  telegram: { ready: false },
  qrDataUrl: null,
  me: null,
};

const socket = io();

// Any API call can come back 401 if the session expired or was revoked elsewhere —
// bounce to the login page rather than showing a broken dashboard.
async function apiFetch(url, opts) {
  const res = await fetch(url, opts);
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("unauthorized");
  }
  return res;
}

async function fetchMe() {
  const res = await apiFetch("/api/auth/me");
  state.me = await res.json();
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/login.html";
}

async function fetchConversations() {
  const res = await apiFetch("/api/conversations");
  state.conversations = await res.json();
  if (!state.selectedId && state.conversations.length) {
    state.selectedId = state.conversations[0].id;
  }
  render();
}

socket.on("conversations:update", fetchConversations);

socket.on("message:new", ({ convId, message }) => {
  const conv = state.conversations.find((c) => c.id === convId);
  if (conv) {
    conv.messages = conv.messages || [];
    conv.messages.push(message);
    conv.lastAt = message.time;
  }
  fetchConversations();
});

socket.on("whatsapp:qr", ({ dataUrl }) => {
  state.qrDataUrl = dataUrl;
  state.whatsapp.ready = false;
  render();
});
socket.on("whatsapp:status", (status) => {
  state.whatsapp = { ...state.whatsapp, ...status };
  if (status.ready) state.qrDataUrl = null;
  render();
});
socket.on("telegram:status", (status) => {
  state.telegram = { ...state.telegram, ...status };
  render();
});

async function selectConversation(id) {
  state.selectedId = id;
  state.mobileView = "chat";
  const conv = state.conversations.find((c) => c.id === id);
  if (conv && conv.unread) {
    await apiFetch(`/api/conversations/${id}/read`, { method: "POST" });
    conv.unread = 0;
  }
  render();
}

async function sendMessage(text) {
  const conv = state.conversations.find((c) => c.id === state.selectedId);
  if (!conv || !text.trim()) return;
  const res = await apiFetch(`/api/conversations/${conv.id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert("Gagal mengirim pesan: " + (err.detail || err.error || "unknown error"));
  }
}

function renderAvatar(name, size) {
  const wrap = el("div", {
    class: "gi-avatar",
    style: `width:${size}px;height:${size}px;background:${avatarColor(name)}`,
  });
  wrap.innerHTML = `<span class="gi-display" style="color:#0F1115;font-size:${size * 0.36}px">${escapeHtml(initials(name))}</span>`;
  return wrap;
}

function renderChannelBadge(channel, size) {
  const c = CHANNEL[channel];
  const badge = el("div", {
    class: "gi-channel-badge",
    style: `width:${size + 8}px;height:${size + 8}px;background:${c.color}`,
  });
  badge.innerHTML = channel === "whatsapp" ? ICONS.phone : ICONS.paperplane;
  return badge;
}

function renderStatusBar() {
  const bar = el("div", { class: "gi-status-bar" });
  const wa = state.whatsapp.ready;
  const tg = state.telegram.ready;
  bar.innerHTML = `
    <div class="gi-status-pill">
      <span class="gi-status-dot" style="background:${wa ? "#25D366" : "#4A4F5A"}"></span>
      WhatsApp ${wa ? "terhubung" : "belum terhubung"}
    </div>
    <div class="gi-status-pill">
      <span class="gi-status-dot" style="background:${tg ? "#2AABEE" : "#4A4F5A"}"></span>
      Telegram ${tg ? "terhubung" : "belum terhubung"}
    </div>
  `;
  return bar;
}

function renderSidebar() {
  const wrap = el("div", { class: `gi-sidebar ${state.mobileView === "chat" ? "hide-mobile" : ""}` });

  const brand = el("div", { class: "gi-brand" });
  brand.innerHTML = `
    <div class="gi-brand-row"><span class="gi-dot"></span><h1 class="gi-display">Gerbang Inbox</h1></div>
    <p class="gi-tagline">Satu pintu untuk WhatsApp & Telegram</p>
  `;
  wrap.appendChild(brand);

  if (state.me) {
    const agentBar = el("div", { class: "gi-agent-bar" });
    const name = el("span", { class: "gi-agent-name" }, `\u{1F464} ${escapeHtml(state.me.displayName || state.me.username)}`);
    const logoutBtn = el("button", { class: "gi-logout-btn" }, "Keluar");
    logoutBtn.onclick = () => logout();
    agentBar.appendChild(name);
    agentBar.appendChild(logoutBtn);
    wrap.appendChild(agentBar);
  }

  wrap.appendChild(renderStatusBar());

  const searchWrap = el("div", { class: "gi-search" });
  searchWrap.innerHTML = ICONS.search;
  const input = el("input", { placeholder: "Cari kontak..." });
  input.value = state.query;
  input.oninput = (e) => {
    state.query = e.target.value;
    renderConvList(list);
  };
  searchWrap.appendChild(input);

  const filters = el("div", { class: "gi-filters" });
  [
    { key: "all", label: "Semua", color: AMBER },
    { key: "whatsapp", label: "WhatsApp", color: CHANNEL.whatsapp.color },
    { key: "telegram", label: "Telegram", color: CHANNEL.telegram.color },
  ].forEach((f) => {
    const btn = el("button", { class: `gi-filter-btn ${state.filter === f.key ? "active" : ""}`, style: `--accent:${f.color}` }, f.label);
    btn.onclick = () => {
      state.filter = f.key;
      render();
    };
    filters.appendChild(btn);
  });

  const filterSection = el("div", { class: "gi-brand" });
  filterSection.style.padding = "0 18px 14px";
  filterSection.appendChild(searchWrap);
  filterSection.appendChild(filters);
  wrap.appendChild(filterSection);

  const list = el("div", { class: "gi-conv-list" });
  wrap.appendChild(list);
  renderConvList(list);

  return wrap;
}

function renderConvList(list) {
  list.innerHTML = "";
  const filtered = state.conversations.filter((c) => {
    const matchesFilter = state.filter === "all" || c.channel === state.filter;
    const matchesQuery = c.name.toLowerCase().includes(state.query.toLowerCase());
    return matchesFilter && matchesQuery;
  });

  if (!filtered.length) {
    list.appendChild(el("div", { style: "color:#8B909C;font-size:12.5px;padding:20px 10px;text-align:center" }, "Belum ada percakapan. Kirim pesan ke bot Telegram atau nomor WhatsApp yang terhubung untuk memulai."));
    return;
  }

  filtered.forEach((c) => {
    const item = el("button", { class: `gi-conv-item ${c.id === state.selectedId ? "active" : ""}` });
    item.onclick = () => selectConversation(c.id);

    const avatarWrap = el("div", { class: "gi-avatar-wrap" });
    avatarWrap.appendChild(renderAvatar(c.name, 40));
    avatarWrap.appendChild(renderChannelBadge(c.channel, 13));

    const lastMsg = c.messages && c.messages.length ? c.messages[c.messages.length - 1].text : "";
    const body = el("div", { style: "flex:1;min-width:0" });
    body.innerHTML = `
      <div class="gi-conv-top">
        <span class="gi-conv-name">${escapeHtml(c.name)}</span>
        <span class="gi-conv-time ${c.unread ? "unread" : ""}">${escapeHtml(c.lastAt || "")}</span>
      </div>
      <div class="gi-conv-bottom">
        <span class="gi-conv-preview">${escapeHtml(lastMsg)}</span>
        ${c.unread ? `<span class="gi-badge">${c.unread}</span>` : ""}
      </div>
    `;

    item.appendChild(avatarWrap);
    item.appendChild(body);
    list.appendChild(item);
  });
}

function renderChat() {
  const conv = state.conversations.find((c) => c.id === state.selectedId);
  const wrap = el("div", { class: `gi-chat ${state.mobileView === "list" ? "hide-mobile" : ""}` });

  if (!conv) {
    wrap.appendChild(el("div", { class: "gi-empty" }, "Belum ada percakapan untuk ditampilkan."));
    return wrap;
  }

  const accent = CHANNEL[conv.channel].color;

  const header = el("div", { class: "gi-chat-header" });
  const backBtn = el("button", { class: "gi-back-btn" });
  backBtn.innerHTML = ICONS.back;
  backBtn.onclick = () => {
    state.mobileView = "list";
    render();
  };
  header.appendChild(backBtn);
  header.appendChild(renderAvatar(conv.name, 36));
  const headInfo = el("div", { style: "flex:1;min-width:0" });
  headInfo.innerHTML = `
    <div class="gi-chat-name">${escapeHtml(conv.name)}</div>
    <div class="gi-chat-sub">
      <span class="gi-online-dot" style="background:${conv.online ? "#25D366" : "#4A4F5A"}"></span>
      ${conv.online ? "Online" : "Offline"} · ${CHANNEL[conv.channel].label}
    </div>
  `;
  header.appendChild(headInfo);
  wrap.appendChild(header);

  const messages = el("div", { class: "gi-messages", id: "gi-messages" });
  (conv.messages || []).forEach((m) => {
    const mine = m.from === "me";
    const row = el("div", { class: `gi-msg-row ${mine ? "mine" : ""}` });
    const bubble = el("div", { class: "gi-bubble", style: mine ? `--accent:${accent}` : "" });
    const agentLabel = mine && m.agent ? `<div class="gi-msg-agent">${escapeHtml(m.agent)}</div>` : "";
    bubble.innerHTML = `${agentLabel}${escapeHtml(m.text)}<div class="gi-meta">${m.time}${mine ? ICONS.check : ""}</div>`;
    row.appendChild(bubble);
    messages.appendChild(row);
  });
  wrap.appendChild(messages);

  const composer = el("div", { class: "gi-composer" });
  const clip = el("div", { class: "gi-icon-btn" }, ICONS.paperclip);
  const smile = el("div", { class: "gi-icon-btn" }, ICONS.smile);
  const input = el("input", { placeholder: "Tulis pesan...", "data-testid": "composer-input" });
  const sendBtn = el("button", { class: "gi-send-btn", style: `--accent:${accent}` });
  sendBtn.innerHTML = ICONS.send;

  const doSend = () => {
    if (!input.value.trim()) return;
    sendMessage(input.value);
    input.value = "";
  };
  input.onkeydown = (e) => { if (e.key === "Enter") doSend(); };
  sendBtn.onclick = doSend;

  composer.appendChild(clip);
  composer.appendChild(smile);
  composer.appendChild(input);
  composer.appendChild(sendBtn);
  wrap.appendChild(composer);

  setTimeout(() => { messages.scrollTop = messages.scrollHeight; }, 0);

  return wrap;
}

function renderDetail() {
  const conv = state.conversations.find((c) => c.id === state.selectedId);
  if (!conv) return el("div", { class: "gi-detail" });

  const accent = CHANNEL[conv.channel].color;
  const wrap = el("div", { class: "gi-detail" });
  wrap.innerHTML = `
    <div class="gi-detail-head">
      <div class="gi-avatar" style="width:64px;height:64px;background:${avatarColor(conv.name)};margin:0 auto"><span class="gi-display" style="color:#0F1115;font-size:23px">${escapeHtml(initials(conv.name))}</span></div>
      <div class="gi-detail-name gi-display">${escapeHtml(conv.name)}</div>
      <div class="gi-detail-handle">${escapeHtml(conv.handle || "")}</div>
    </div>
    <div class="gi-detail-section">
      <div class="gi-channel-pill" style="background:${accent}22;border:1px solid ${accent}44;color:${accent}">
        ${CHANNEL[conv.channel].label}
      </div>
      <div>
        <div class="gi-label-title">Label</div>
        <div class="gi-tag-chip">${ICONS.tag} ${escapeHtml(conv.tag || "Baru")}</div>
      </div>
      <div>
        <div class="gi-label-title">Status</div>
        <div style="display:flex;align-items:center;gap:6px;color:#8B909C;font-size:12.5px">${ICONS.clock} Terakhir aktif ${escapeHtml(conv.lastAt || "-")}</div>
      </div>
    </div>
  `;
  return wrap;
}

function renderQrModal() {
  if (!state.qrDataUrl || state.whatsapp.ready) return null;
  const overlay = el("div", { class: "gi-modal-overlay" });
  const modal = el("div", { class: "gi-modal" });
  modal.innerHTML = `
    <h2 class="gi-display">Hubungkan WhatsApp</h2>
    <p>Buka WhatsApp di ponsel → Perangkat Tertaut → Tautkan Perangkat, lalu pindai kode ini.</p>
    <img src="${state.qrDataUrl}" alt="QR code WhatsApp" />
    <p>Kode akan diperbarui otomatis jika kedaluwarsa.</p>
  `;
  overlay.appendChild(modal);
  return overlay;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.innerText = str;
  return d.innerHTML;
}

function render() {
  const app = document.getElementById("app");
  app.innerHTML = "";
  app.appendChild(renderSidebar());
  const conv = state.conversations.find((c) => c.id === state.selectedId);
  app.appendChild(el("div", { class: "gi-gate-rail", style: `--accent:${conv ? CHANNEL[conv.channel].color : AMBER}` }));
  app.appendChild(renderChat());
  app.appendChild(renderDetail());
  const modal = renderQrModal();
  if (modal) app.appendChild(modal);
}

async function init() {
  await fetchMe();
  render();
  await fetchConversations();
}
init();
