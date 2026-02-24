const qs = (id) => document.getElementById(id);

const state = {
  me: null,
  conversationId: null
};

const api = async (url, options = {}) => {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
};

const fmt = (iso) => new Date(iso).toLocaleString();

async function loadMe() {
  try {
    const { user } = await api('/api/me');
    state.me = user;
    qs('authView').classList.add('hidden');
    qs('appView').classList.remove('hidden');
    renderMe();
    await refreshAll();
  } catch {
    qs('authView').classList.remove('hidden');
    qs('appView').classList.add('hidden');
  }
}

function renderMe() {
  qs('myName').textContent = state.me.username;
  qs('myStatus').textContent = state.me.statusText || '';
  qs('myPfp').src = state.me.pfpUrl || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44"><rect width="100%" height="100%" fill="%23ddd"/></svg>';
  qs('statusInput').value = state.me.statusText || '';
  qs('notificationsEnabled').checked = !!state.me.notificationsEnabled;
}

async function refreshConversations() {
  const { conversations } = await api('/api/conversations');
  const ul = qs('conversations');
  ul.innerHTML = '';
  conversations.forEach((c) => {
    const li = document.createElement('li');
    li.innerHTML = `<strong>${c.otherUser?.username || 'Unknown'}</strong> ${c.unreadCount ? `(${c.unreadCount} unread)` : ''}<br><small>${c.latestMessage ? c.latestMessage.body || `[Attachment] ${c.latestMessage.attachmentName}` : 'No messages yet'}</small>`;
    li.style.cursor = 'pointer';
    li.onclick = async () => {
      state.conversationId = c.id;
      qs('chatTitle').textContent = `Chat with ${c.otherUser?.username || 'Unknown'}`;
      await refreshMessages();
      await api(`/api/conversations/${c.id}/read`, { method: 'POST' });
      await refreshConversations();
    };
    ul.appendChild(li);
  });
}

async function refreshMessages() {
  if (!state.conversationId) return;
  const { messages } = await api(`/api/conversations/${state.conversationId}/messages`);
  const box = qs('messages');
  box.innerHTML = '';
  messages.forEach((m) => {
    const div = document.createElement('div');
    const mine = m.senderId === state.me.id;
    const readState = mine ? (m.readBy.length > 1 ? 'Read' : 'Sent') : 'Received';
    div.className = `message ${mine ? 'mine' : 'theirs'}`;
    div.innerHTML = `
      <div>${m.body || ''}</div>
      ${m.attachmentUrl ? `<div><a href="${m.attachmentUrl}" target="_blank">📎 ${m.attachmentName || 'Attachment'}</a></div>` : ''}
      <div class="meta">${fmt(m.createdAt)} • ${readState}</div>
    `;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

async function refreshNotifications() {
  const { notifications } = await api('/api/notifications');
  const ul = qs('notifications');
  ul.innerHTML = '';
  notifications.slice(0, 30).forEach((n) => {
    const li = document.createElement('li');
    li.innerHTML = `${n.read ? '' : '🔔 '} ${n.text}<br><small>${fmt(n.createdAt)}</small>`;
    ul.appendChild(li);
  });
}

async function refreshAll() {
  await Promise.all([refreshConversations(), refreshNotifications()]);
  await refreshMessages();
}

qs('loginBtn').onclick = async () => {
  try {
    const username = qs('username').value;
    const password = qs('password').value;
    await api('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    qs('authError').textContent = '';
    await loadMe();
  } catch (e) {
    qs('authError').textContent = e.message;
  }
};

qs('registerBtn').onclick = async () => {
  try {
    const username = qs('username').value;
    const password = qs('password').value;
    await api('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    qs('authError').textContent = '';
    await loadMe();
  } catch (e) {
    qs('authError').textContent = e.message;
  }
};

qs('logoutBtn').onclick = async () => {
  await api('/api/logout', { method: 'POST' });
  state.me = null;
  state.conversationId = null;
  await loadMe();
};

qs('searchBtn').onclick = async () => {
  const q = qs('searchInput').value.trim();
  const { users } = await api(`/api/users/search?q=${encodeURIComponent(q)}`);
  const ul = qs('searchResults');
  ul.innerHTML = '';
  users.forEach((u) => {
    const li = document.createElement('li');
    const button = u.isFriend ? '<em>Added</em>' : `<button data-id="${u.id}">Add</button>`;
    li.innerHTML = `${u.username} ${button}`;
    ul.appendChild(li);
  });
  ul.querySelectorAll('button[data-id]').forEach((btn) => {
    btn.onclick = async () => {
      await api(`/api/friends/${btn.dataset.id}`, { method: 'POST' });
      await refreshConversations();
      await qs('searchBtn').onclick();
    };
  });
};

qs('messageForm').onsubmit = async (e) => {
  e.preventDefault();
  if (!state.conversationId) return;
  const form = new FormData();
  const body = qs('messageInput').value;
  if (body) form.append('body', body);
  if (qs('attachmentInput').files[0]) form.append('attachment', qs('attachmentInput').files[0]);
  await api(`/api/conversations/${state.conversationId}/messages`, {
    method: 'POST',
    body: form
  });
  qs('messageInput').value = '';
  qs('attachmentInput').value = '';
  await refreshAll();
};

qs('settingsForm').onsubmit = async (e) => {
  e.preventDefault();
  const form = new FormData();
  form.append('statusText', qs('statusInput').value || '');
  form.append('notificationsEnabled', String(qs('notificationsEnabled').checked));
  if (qs('pfpInput').files[0]) form.append('pfp', qs('pfpInput').files[0]);
  const { user } = await api('/api/settings', { method: 'PUT', body: form });
  state.me = user;
  renderMe();
};

qs('readNotifsBtn').onclick = async () => {
  await api('/api/notifications/read-all', { method: 'POST' });
  await refreshNotifications();
};

loadMe();
setInterval(() => {
  if (state.me) refreshAll().catch(() => {});
}, 5000);
