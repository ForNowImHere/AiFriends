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

// ==================================================
// FULL FAKE-AI VOICE SERVER (ACTUALLY YOU)
// Embedded Character.ai-like pages with left sidebar, dynamic middle content, right sidebar
// Ultimate account has full audio upload library and special features
// ==================================================

// ---------------- PATHS ----------------
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const UPLOADS = path.join(PUBLIC, 'uploads');
const AUDIO_UPLOADS = path.join(UPLOADS, 'audio');
const IMAGES = path.join(UPLOADS, 'images');
const DATA = path.join(ROOT, 'data');

[PUBLIC, UPLOADS, AUDIO_UPLOADS, IMAGES, DATA].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ---------------- DATA FILES ----------------
const USERS_FILE = path.join(DATA, 'users.json');
const CHARS_FILE = path.join(DATA, 'characters.json');
const CHATS_FILE = path.join(DATA, 'chats.json');
const VOICES_FILE = path.join(DATA, 'voices.json');

function load(file, fallback) { if (!fs.existsSync(file)) return fallback; try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function save(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

let users = load(USERS_FILE, []);
let characters = load(CHARS_FILE, []);
let chats = load(CHATS_FILE, []);
let voices = load(VOICES_FILE, []);

// ---------------- MIDDLEWARE ----------------
app.use('/uploads', express.static(UPLOADS));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'dev-secret-change-me', resave: false, saveUninitialized: false }));

// ---------------- AUTH HELPERS ----------------
function requireAuth(req, res, next) { const u = users.find(x => x.id === req.session.uid); if (!u) return res.status(401).json({ error: 'not_logged_in' }); req.user = u; next(); }
function requireUltimate(req, res, next) { if (req.user.role !== 'ultimate') return res.status(403).json({ error: 'ultimate_only' }); next(); }
function createUser(username, password) { const role = users.length === 0 ? 'ultimate' : 'user'; const user = { id: Date.now(), username, password, role, theme: 'dark' }; users.push(user); save(USERS_FILE, users); return user; }

// ---------------- AUTH API ----------------
app.post('/api/signup', (req, res) => { const { username, password } = req.body; if (!username || !password) return res.status(400).json({ error: 'missing_fields' }); if (users.some(u => u.username === username)) return res.status(409).json({ error: 'user_exists' }); const u = createUser(username, password); req.session.uid = u.id; res.json({ ok: true, role: u.role }); });
app.post('/api/login', (req, res) => { const { username, password } = req.body; const u = users.find(x => x.username === username && x.password === password); if (!u) return res.status(401).json({ error: 'bad_login' }); req.session.uid = u.id; res.json({ ok: true, role: u.role }); });
app.get('/api/me', requireAuth, (req, res) => { res.json(req.user); });
app.post('/api/logout', requireAuth, (req, res) => { req.session.destroy(() => res.json({ ok: true })); });

// ---------------- CHARACTERS ----------------
app.post('/api/characters', requireAuth, (req, res) => { const { name } = req.body; if (!name) return res.status(400).json({ error: 'missing_name' }); const char = { id: Date.now(), name, image: null }; characters.push(char); save(CHARS_FILE, characters); res.json(char); });
app.get('/api/characters', requireAuth, (req, res) => { res.json(characters); });

// ---------------- UPLOADS ----------------
const audioUpload = multer({ dest: AUDIO_UPLOADS });
const imageUpload = multer({ dest: IMAGES });
app.post('/api/upload/voice', requireAuth, audioUpload.single('audio'), (req, res) => { const v = { id: Date.now(), filename: req.file.filename, userId: req.user.id, time: Date.now() }; voices.push(v); save(VOICES_FILE, voices); io.emit('voice_waiting'); res.json(v); });
app.post('/api/upload/character-image', requireAuth, imageUpload.single('image'), (req, res) => { const { charId } = req.body; const c = characters.find(x => x.id == charId); if (!c) return res.status(404).json({ error: 'char_not_found' }); c.image = `/uploads/images/${req.file.filename}`; save(CHARS_FILE, characters); res.json(c); });

// ---------------- SOCKET.IO CHAT ----------------
io.on('connection', socket => {
  socket.on('send_text', data => {
    const msg = { id: Date.now(), charId: data.charId, from: 'user', text: data.text, audio: null, status: 'waiting', time: Date.now() };
    chats.push(msg);
    save(CHATS_FILE, chats);
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

// ---------------- EMBEDDED CHARACTER.AI-LIKE PAGES ----------------
const renderPage = (page, middleContent, rightContent, user) => `<!DOCTYPE html>
<html>
<head>
<title>${page}</title>
<style>
body{margin:0;font-family:sans-serif;background:#0b0b0f;color:#eee;}
#app{display:flex;height:100vh;}
aside{width:220px;background:#111;padding:10px;}
main{flex:1;padding:10px;overflow-y:auto;}
#right{width:260px;background:#161616;padding:10px;}
button{margin:5px;}
</style>
</head>
<body>
<div id='app'>
<aside>
<button onclick="location.href='/home'">Home</button>
<button onclick="location.href='/library'">Library</button>
<button onclick="location.href='/ai'">AI</button>
<button onclick="location.href='/settings'">Settings</button>
${user && user.role==='ultimate'?`<button onclick="location.href='/uploadedonlymods'">Ultimate Library</button>`:''}
</aside>
<main>${middleContent}</main>
<section id='right'>${rightContent}</section>
</div>
<script src='/socket.io/socket.io.js'></script>
<script>
const socket=io();
// Here add per-page JS logic: update chat list, show last chat, handle audio buttons
</script>
</body>
</html>`;

app.get('/', requireAuth, (req, res) => res.redirect('/home'));
app.get('/login', (req, res) => res.send(renderPage('Login', `<form method='POST' action='/api/login'><h1>Login</h1><input name='username' placeholder='username'><input type='password' name='password' placeholder='password'><button>Login</button></form>`, '', {role:'user'})));
app.get('/signup', (req, res) => res.send(renderPage('Sign Up', `<form method='POST' action='/api/signup'><h1>Sign Up</h1><input name='username' placeholder='username'><input type='password' name='password' placeholder='password'><button>Create Account</button></form>`, '', {role:'user'})));

const pageRoutes = ['home','library','ai','settings','special','uploadedonlymods'];
pageRoutes.forEach(page => {
  app.get(`/${page}`, requireAuth, (req, res) => {
    let middleContent = `<h1>${page.charAt(0).toUpperCase()+page.slice(1)} Page</h1>`;
    let rightContent = page==='ai'? `<h2>AI Details / Voice Controls</h2>` : '';
    if(page==='uploadedonlymods' && req.user.role!=='ultimate') return res.status(403).send('Ultimate only');
    res.send(renderPage(page, middleContent, rightContent, req.user));
  });
});

// ---------------- START ----------------
server.listen(3000, () => console.log('Server running on http://localhost:3000'));

/* ---------------- PACKAGE.JSON ----------------
{
  "name": "fake-ai-voice-server",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "socket.io": "^4.7.2",
    "express-session": "^1.17.3",
    "multer": "^1.4.5"
  }
}
*/
