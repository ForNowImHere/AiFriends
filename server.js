const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// ---------------- PATHS ----------------
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(PUBLIC, 'uploads');
const AUDIO_UPLOADS = path.join(UPLOADS, 'audio');
const IMAGES = path.join(UPLOADS, 'images');
const DATA = path.join(ROOT, 'data');

// ---------------- ENSURE DIRS ----------------
[PUBLIC, UPLOADS, AUDIO_UPLOADS, IMAGES, DATA].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ---------------- DATA FILES ----------------
const USERS_FILE = path.join(DATA, 'users.json');
const CHARS_FILE = path.join(DATA, 'characters.json');
const CHATS_FILE = path.join(DATA, 'chats.json');
const VOICES_FILE = path.join(DATA, 'voices.json');

function load(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
}
function save(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

let users = load(USERS_FILE, []); // {id, username, password, role, theme}
let characters = load(CHARS_FILE, []); // {id, name, image}
let chats = load(CHATS_FILE, []); // {id, charId, from, text, audio, status, time}
let voices = load(VOICES_FILE, []); // {id, filename, userId, time}

// ---------------- MIDDLEWARE ----------------
app.use(express.static(PUBLIC));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false
}));

// ---------------- AUTH HELPERS ----------------
function requireAuth(req, res, next) {
  const u = users.find(x => x.id === req.session.uid);
  if (!u) return res.redirect('/login.html');
  req.user = u;
  next();
}
function requireUltimate(req, res, next) {
  if (req.user.role !== 'ultimate') return res.status(403).end();
  next();
}

function createUser(username, password) {
  const role = users.length === 0 ? 'ultimate' : 'user';
  const user = { id: Date.now(), username, password, role, theme: 'dark' };
  users.push(user); save(USERS_FILE, users);
  return user;
}

// ---------------- AUTH ROUTES ----------------
app.post('/signup', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.redirect('/signup.html');
  if (users.some(u => u.username === username)) return res.redirect('/signup.html');
  const u = createUser(username, password);
  req.session.uid = u.id;
  res.redirect('/app.html');
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const u = users.find(x => x.username === username && x.password === password);
  if (!u) return res.redirect('/login.html');
  req.session.uid = u.id;
  res.redirect('/app.html');
});

app.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// ---------------- CHARACTERS ----------------
app.post('/characters', requireAuth, (req, res) => {
  const { name } = req.body;
  const char = { id: Date.now(), name, image: null };
  characters.push(char); save(CHARS_FILE, characters);
  res.json(char);
});

app.get('/characters', requireAuth, (req, res) => {
  res.json(characters);
});

// ---------------- UPLOADS ----------------
const audioUpload = multer({ dest: AUDIO_UPLOADS });
const imageUpload = multer({ dest: IMAGES });

app.post('/upload/voice', requireAuth, audioUpload.single('audio'), (req, res) => {
  const v = { id: Date.now(), filename: req.file.filename, userId: req.user.id, time: Date.now() };
  voices.push(v); save(VOICES_FILE, voices);
  io.emit('voice_waiting');
  res.json(v);
});

app.post('/upload/character-image', requireAuth, imageUpload.single('image'), (req, res) => {
  const { charId } = req.body;
  const c = characters.find(x => x.id == charId);
  if (!c) return res.status(404).end();
  c.image = '/uploads/images/' + req.file.filename;
  save(CHARS_FILE, characters);
  res.json(c);
});

// ---------------- SOCKET.IO CHAT ----------------
io.on('connection', socket => {
  socket.on('send_text', data => {
    const msg = { id: Date.now(), charId: data.charId, from: 'user', text: data.text, audio: null, status: 'waiting', time: Date.now() };
    chats.push(msg); save(CHATS_FILE, chats);
    io.emit('update');
  });

  socket.on('ultimate_reply', data => {
    const msg = chats.find(m => m.id === data.id);
    if (!msg) return;
    msg.text = data.text;
    msg.audio = data.audio || null;
    msg.status = 'ready';
    save(CHATS_FILE, chats);
    io.emit('update');
  });
});

// ---------------- PROTECTED APP ----------------
app.get('/app.html', requireAuth, (req, res) => {
  res.sendFile(path.join(PUBLIC, 'app.html'));
});

// ---------------- START ----------------
server.listen(3000, () => console.log('http://localhost:3000'));

// ================================
// package.json (CREATE THIS FILE)
// ================================
/*
{
  "name": "human-ai-server",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "express": "^4.19.2",
    "express-session": "^1.17.3",
    "multer": "^1.4.5",
    "socket.io": "^4.7.5"
  }
}
*/

// ================================
// FRONTEND FILES (public/)
// ================================
/*
public/login.html
public/signup.html
public/app.html
public/style.css
public/app.js

NOTE:
- public/uploads/audio = voice uploads
- public/uploads/images = profile + character images
- JSON persistence in /data
*/
