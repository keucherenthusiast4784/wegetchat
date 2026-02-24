const express = require('express');
const session = require('express-session');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'data', 'db.json');
const uploadDir = path.join(__dirname, 'uploads');

if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
if (!fs.existsSync(path.dirname(DB_FILE))) fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const defaultDb = {
  users: [],
  conversations: [],
  messages: [],
  friendships: [],
  notifications: []
};

const loadDb = () => {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(defaultDb, null, 2));
    return structuredClone(defaultDb);
  }
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...defaultDb, ...parsed };
  } catch {
    return structuredClone(defaultDb);
  }
};

let db = loadDb();

const saveDb = () => {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
};

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: 'wegetchat-secret-key',
  resave: false,
  saveUninitialized: false
}));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '');
    cb(null, `${Date.now()}-${uuidv4()}${ext}`);
  }
});
const upload = multer({ storage });

app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, 'public')));

const auth = (req, res, next) => {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  const user = db.users.find((u) => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session expired' });
  req.user = user;
  next();
};

const getConversationForUsers = (a, b) => {
  return db.conversations.find(
    (c) => c.participants.includes(a) && c.participants.includes(b) && c.participants.length === 2
  );
};

const upsertNotification = (userId, text) => {
  db.notifications.push({
    id: uuidv4(),
    userId,
    text,
    createdAt: new Date().toISOString(),
    read: false
  });
};

app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required' });
  const normalized = username.trim().toLowerCase();
  if (normalized.length < 3) return res.status(400).json({ error: 'Username must have at least 3 characters' });
  if (password.length < 4) return res.status(400).json({ error: 'Password must have at least 4 characters' });
  if (db.users.some((u) => u.usernameLower === normalized)) return res.status(409).json({ error: 'Username already taken' });

  const user = {
    id: uuidv4(),
    username: username.trim(),
    usernameLower: normalized,
    passwordHash: await bcrypt.hash(password, 10),
    pfpUrl: '',
    statusText: 'Hey there! I am using WeGetChat.',
    notificationsEnabled: true,
    createdAt: new Date().toISOString()
  };
  db.users.push(user);
  saveDb();
  req.session.userId = user.id;
  res.json({ user: { id: user.id, username: user.username, pfpUrl: user.pfpUrl, statusText: user.statusText, notificationsEnabled: user.notificationsEnabled } });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = db.users.find((u) => u.usernameLower === (username || '').trim().toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });
  req.session.userId = user.id;
  res.json({ user: { id: user.id, username: user.username, pfpUrl: user.pfpUrl, statusText: user.statusText, notificationsEnabled: user.notificationsEnabled } });
});

app.post('/api/logout', auth, (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', auth, (req, res) => {
  const user = req.user;
  res.json({
    user: {
      id: user.id,
      username: user.username,
      pfpUrl: user.pfpUrl,
      statusText: user.statusText,
      notificationsEnabled: user.notificationsEnabled
    }
  });
});

app.put('/api/settings', auth, upload.single('pfp'), (req, res) => {
  const user = req.user;
  if (typeof req.body.statusText === 'string') user.statusText = req.body.statusText.slice(0, 140);
  if (typeof req.body.notificationsEnabled !== 'undefined') {
    user.notificationsEnabled = req.body.notificationsEnabled === 'true' || req.body.notificationsEnabled === true;
  }
  if (req.file) {
    user.pfpUrl = `/uploads/${req.file.filename}`;
  }
  saveDb();
  res.json({ user: { id: user.id, username: user.username, pfpUrl: user.pfpUrl, statusText: user.statusText, notificationsEnabled: user.notificationsEnabled } });
});

app.get('/api/users/search', auth, (req, res) => {
  const q = (req.query.q || '').toString().trim().toLowerCase();
  const friends = db.friendships.filter((f) => f.userId === req.user.id).map((f) => f.friendId);
  const users = db.users
    .filter((u) => u.id !== req.user.id && u.usernameLower.includes(q))
    .slice(0, 20)
    .map((u) => ({
      id: u.id,
      username: u.username,
      pfpUrl: u.pfpUrl,
      isFriend: friends.includes(u.id)
    }));
  res.json({ users });
});

app.post('/api/friends/:friendId', auth, (req, res) => {
  const { friendId } = req.params;
  if (friendId === req.user.id) return res.status(400).json({ error: 'Cannot add yourself' });
  const friend = db.users.find((u) => u.id === friendId);
  if (!friend) return res.status(404).json({ error: 'User not found' });

  const exists = db.friendships.some((f) => f.userId === req.user.id && f.friendId === friendId);
  if (!exists) {
    db.friendships.push({ userId: req.user.id, friendId, createdAt: new Date().toISOString() });
    db.friendships.push({ userId: friendId, friendId: req.user.id, createdAt: new Date().toISOString() });
  }

  if (!getConversationForUsers(req.user.id, friendId)) {
    db.conversations.push({
      id: uuidv4(),
      participants: [req.user.id, friendId],
      createdAt: new Date().toISOString()
    });
  }
  upsertNotification(friendId, `${req.user.username} added you as a friend.`);
  saveDb();
  res.json({ ok: true });
});

app.get('/api/conversations', auth, (req, res) => {
  const myConvos = db.conversations
    .filter((c) => c.participants.includes(req.user.id))
    .map((c) => {
      const otherId = c.participants.find((id) => id !== req.user.id);
      const otherUser = db.users.find((u) => u.id === otherId);
      const msgs = db.messages.filter((m) => m.conversationId === c.id);
      const latest = msgs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
      const unreadCount = msgs.filter((m) => m.senderId === otherId && !m.readBy.includes(req.user.id)).length;
      return {
        id: c.id,
        otherUser: otherUser ? { id: otherUser.id, username: otherUser.username, pfpUrl: otherUser.pfpUrl } : null,
        latestMessage: latest || null,
        unreadCount
      };
    })
    .sort((a, b) => {
      const aTime = a.latestMessage ? new Date(a.latestMessage.createdAt).getTime() : 0;
      const bTime = b.latestMessage ? new Date(b.latestMessage.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  res.json({ conversations: myConvos });
});

app.get('/api/conversations/:id/messages', auth, (req, res) => {
  const convo = db.conversations.find((c) => c.id === req.params.id);
  if (!convo || !convo.participants.includes(req.user.id)) return res.status(404).json({ error: 'Conversation not found' });
  const messages = db.messages
    .filter((m) => m.conversationId === convo.id)
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  res.json({ messages });
});

app.post('/api/conversations/:id/messages', auth, upload.single('attachment'), (req, res) => {
  const convo = db.conversations.find((c) => c.id === req.params.id);
  if (!convo || !convo.participants.includes(req.user.id)) return res.status(404).json({ error: 'Conversation not found' });
  const body = (req.body.body || '').trim();
  if (!body && !req.file) return res.status(400).json({ error: 'Message body or attachment required' });

  const msg = {
    id: uuidv4(),
    conversationId: convo.id,
    senderId: req.user.id,
    body,
    attachmentUrl: req.file ? `/uploads/${req.file.filename}` : '',
    attachmentName: req.file ? req.file.originalname : '',
    createdAt: new Date().toISOString(),
    readBy: [req.user.id]
  };
  db.messages.push(msg);

  const recipientId = convo.participants.find((id) => id !== req.user.id);
  upsertNotification(recipientId, `New message from ${req.user.username}`);

  saveDb();
  res.json({ message: msg });
});

app.post('/api/conversations/:id/read', auth, (req, res) => {
  const convo = db.conversations.find((c) => c.id === req.params.id);
  if (!convo || !convo.participants.includes(req.user.id)) return res.status(404).json({ error: 'Conversation not found' });
  db.messages
    .filter((m) => m.conversationId === convo.id && m.senderId !== req.user.id)
    .forEach((m) => {
      if (!m.readBy.includes(req.user.id)) m.readBy.push(req.user.id);
    });
  saveDb();
  res.json({ ok: true });
});

app.get('/api/notifications', auth, (req, res) => {
  const notifications = db.notifications
    .filter((n) => n.userId === req.user.id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json({ notifications });
});

app.post('/api/notifications/read-all', auth, (req, res) => {
  db.notifications
    .filter((n) => n.userId === req.user.id)
    .forEach((n) => {
      n.read = true;
    });
  saveDb();
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`wegetchat listening on http://localhost:${PORT}`);
});
