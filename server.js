const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const UPLOAD_DIR = path.join(ROOT, 'uploads');
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'playtube.sqlite'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
 password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS videos (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
 title TEXT NOT NULL, description TEXT DEFAULT '', category TEXT DEFAULT 'Lainnya',
 filename TEXT NOT NULL, original_name TEXT NOT NULL, mime_type TEXT NOT NULL,
 views INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS likes (
 user_id INTEGER NOT NULL, video_id INTEGER NOT NULL,
 PRIMARY KEY(user_id, video_id), FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(video_id) REFERENCES videos(id)
);
CREATE TABLE IF NOT EXISTS comments (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, video_id INTEGER NOT NULL,
 body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id), FOREIGN KEY(video_id) REFERENCES videos(id)
);
CREATE TABLE IF NOT EXISTS playlists (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS playlist_videos (
 playlist_id INTEGER NOT NULL, video_id INTEGER NOT NULL,
 PRIMARY KEY(playlist_id, video_id), FOREIGN KEY(playlist_id) REFERENCES playlists(id),
 FOREIGN KEY(video_id) REFERENCES videos(id)
);
CREATE TABLE IF NOT EXISTS history (
 user_id INTEGER NOT NULL, video_id INTEGER NOT NULL, watched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(user_id, video_id), FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(video_id) REFERENCES videos(id)
);
CREATE TABLE IF NOT EXISTS streams (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, title TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'live', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const adminName = process.env.ADMIN_USERNAME || 'admin';
const adminPass = process.env.ADMIN_PASSWORD || 'Admin123!';
if (!db.prepare('SELECT id FROM users WHERE username=?').get(adminName)) {
  db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)')
    .run(adminName, bcrypt.hashSync(adminPass, 10), 'admin');
  console.log(`Admin awal dibuat: username=${adminName}, password=${adminPass}`);
}

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'ubah-secret-ini-sebelum-deploy',
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7*24*60*60*1000 }
}));
app.use('/uploads', express.static(UPLOAD_DIR));
app.use(express.static(path.join(ROOT, 'public')));

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,9)}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage, limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ok = ['video/mp4','video/webm','video/ogg','video/quicktime'].includes(file.mimetype);
    cb(ok ? null : new Error('Format video yang didukung: MP4, WebM, OGG, MOV.'), ok);
  }
});

function currentUser(req) {
  if (!req.session.userId) return null;
  return db.prepare('SELECT id, username, role, created_at FROM users WHERE id=?').get(req.session.userId) || null;
}
function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Silakan login terlebih dahulu.' });
  req.user = user; next();
}
function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user || user.role !== 'admin') return res.status(403).json({ error: 'Khusus admin.' });
  req.user = user; next();
}
function videoSelect(where = '', order = 'v.created_at DESC') {
  return `SELECT v.id,v.user_id,v.title,v.description,v.category,v.filename,v.original_name,v.mime_type,v.views,v.created_at,u.username,
    (SELECT COUNT(*) FROM likes l WHERE l.video_id=v.id) AS likes,
    (SELECT COUNT(*) FROM comments c WHERE c.video_id=v.id) AS comments
    FROM videos v JOIN users u ON u.id=v.user_id ${where} ORDER BY ${order}`;
}
function publicVideo(v, userId) {
  return { ...v, url: `/uploads/${encodeURIComponent(v.filename)}`,
    liked: userId ? !!db.prepare('SELECT 1 FROM likes WHERE user_id=? AND video_id=?').get(userId,v.id) : false };
}
app.get('/api/me', (req,res) => res.json({ user: currentUser(req) }));
app.post('/api/register', (req,res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({error:'Username harus 3–24 karakter, hanya huruf, angka, dan underscore.'});
  if (password.length < 8) return res.status(400).json({error:'Password minimal 8 karakter.'});
  try {
    const result = db.prepare('INSERT INTO users(username,password_hash) VALUES(?,?)').run(username,bcrypt.hashSync(password,10));
    req.session.userId = Number(result.lastInsertRowid);
    res.json({user:currentUser(req)});
  } catch { res.status(409).json({error:'Username sudah digunakan.'}); }
});
app.post('/api/login', (req,res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user || !bcrypt.compareSync(password,user.password_hash)) return res.status(401).json({error:'Username atau password salah.'});
  req.session.userId = user.id;
  res.json({user:currentUser(req)});
});
app.post('/api/logout', (req,res) => req.session.destroy(() => res.json({ok:true})));

app.get('/api/videos', (req,res) => {
  const q = String(req.query.q || '').trim();
  const category = String(req.query.category || '').trim();
  const clauses = []; const params = [];
  if (q) { clauses.push('(v.title LIKE ? OR v.description LIKE ? OR u.username LIKE ?)'); params.push(`%${q}%`,`%${q}%`,`%${q}%`); }
  if (category && category !== 'Semua') { clauses.push('v.category=?'); params.push(category); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(videoSelect(where,'v.created_at DESC')).all(...params);
  res.json(rows.map(v=>publicVideo(v,req.session.userId)));
});
app.post('/api/videos', requireAuth, (req,res,next) => {
  upload.single('video')(req,res,err => {
    if (err) return res.status(400).json({error:err.message || 'Upload gagal.'});
    if (!req.file) return res.status(400).json({error:'Pilih file video terlebih dahulu.'});
    const title = String(req.body.title || '').trim();
    if (!title || title.length > 120) { fs.unlink(req.file.path,()=>{}); return res.status(400).json({error:'Judul wajib diisi (maksimal 120 karakter).'}); }
    const category = String(req.body.category || 'Lainnya').slice(0,40);
    const description = String(req.body.description || '').slice(0,5000);
    const result = db.prepare('INSERT INTO videos(user_id,title,description,category,filename,original_name,mime_type) VALUES(?,?,?,?,?,?,?)')
      .run(req.user.id,title,description,category,req.file.filename,req.file.originalname,req.file.mimetype);
    res.json({ok:true,id:Number(result.lastInsertRowid)});
  });
});
app.get('/api/videos/:id', (req,res) => {
  const id = Number(req.params.id);
  const video = db.prepare(videoSelect('WHERE v.id=?')).get(id);
  if (!video) return res.status(404).json({error:'Video tidak ditemukan.'});
  db.prepare('UPDATE videos SET views=views+1 WHERE id=?').run(id);
  if (req.session.userId) db.prepare(`INSERT INTO history(user_id,video_id,watched_at) VALUES(?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(user_id,video_id) DO UPDATE SET watched_at=CURRENT_TIMESTAMP`).run(req.session.userId,id);
  const updated = db.prepare(videoSelect('WHERE v.id=?')).get(id);
  const comments = db.prepare(`SELECT c.id,c.body,c.created_at,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.video_id=? ORDER BY c.created_at DESC`).all(id);
  res.json({video:publicVideo(updated,req.session.userId),comments});
});
app.post('/api/videos/:id/like', requireAuth, (req,res) => {
  const id = Number(req.params.id);
  if (!db.prepare('SELECT id FROM videos WHERE id=?').get(id)) return res.status(404).json({error:'Video tidak ditemukan.'});
  const existing = db.prepare('SELECT 1 FROM likes WHERE user_id=? AND video_id=?').get(req.user.id,id);
  if (existing) db.prepare('DELETE FROM likes WHERE user_id=? AND video_id=?').run(req.user.id,id);
  else db.prepare('INSERT INTO likes(user_id,video_id) VALUES(?,?)').run(req.user.id,id);
  res.json({liked:!existing,likes:db.prepare('SELECT COUNT(*) n FROM likes WHERE video_id=?').get(id).n});
});
app.post('/api/videos/:id/comments', requireAuth, (req,res) => {
  const id = Number(req.params.id), body = String(req.body.body || '').trim();
  if (!body || body.length > 1000) return res.status(400).json({error:'Komentar wajib diisi (maksimal 1000 karakter).'});
  if (!db.prepare('SELECT id FROM videos WHERE id=?').get(id)) return res.status(404).json({error:'Video tidak ditemukan.'});
  const r = db.prepare('INSERT INTO comments(user_id,video_id,body) VALUES(?,?,?)').run(req.user.id,id,body);
  res.json(db.prepare('SELECT c.id,c.body,c.created_at,u.username FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?').get(r.lastInsertRowid));
});
app.get('/api/history', requireAuth, (req,res) => {
  const rows = db.prepare(videoSelect('JOIN history h ON h.video_id=v.id WHERE h.user_id=?','h.watched_at DESC')).all(req.user.id);
  res.json(rows.map(v=>publicVideo(v,req.user.id)));
});
app.get('/api/playlists', requireAuth, (req,res) => {
  const lists = db.prepare('SELECT * FROM playlists WHERE user_id=? ORDER BY created_at DESC').all(req.user.id);
  res.json(lists.map(p=>({...p,videos:db.prepare(videoSelect('JOIN playlist_videos pv ON pv.video_id=v.id WHERE pv.playlist_id=?','v.created_at DESC')).all(p.id)})));
});
app.post('/api/playlists', requireAuth, (req,res) => {
  const name = String(req.body.name || '').trim();
  if (!name || name.length > 80) return res.status(400).json({error:'Nama playlist wajib diisi (maksimal 80 karakter).'});
  const r = db.prepare('INSERT INTO playlists(user_id,name) VALUES(?,?)').run(req.user.id,name);
  res.json({id:Number(r.lastInsertRowid),name});
});
app.post('/api/playlists/:id/videos', requireAuth, (req,res) => {
  const playlist = db.prepare('SELECT id FROM playlists WHERE id=? AND user_id=?').get(Number(req.params.id),req.user.id);
  if (!playlist) return res.status(404).json({error:'Playlist tidak ditemukan.'});
  const videoId = Number(req.body.videoId);
  if (!db.prepare('SELECT id FROM videos WHERE id=?').get(videoId)) return res.status(404).json({error:'Video tidak ditemukan.'});
  db.prepare('INSERT OR IGNORE INTO playlist_videos(playlist_id,video_id) VALUES(?,?)').run(playlist.id,videoId);
  res.json({ok:true});
});
app.get('/api/streams', (_req,res) => {
  res.json(db.prepare(`SELECT s.id,s.title,s.created_at,u.username FROM streams s JOIN users u ON u.id=s.user_id WHERE s.status='live' ORDER BY s.created_at DESC`).all());
});
app.post('/api/streams', requireAuth, (req,res) => {
  const title = String(req.body.title || '').trim();
  if (!title || title.length > 120) return res.status(400).json({error:'Judul live wajib diisi.'});
  const r = db.prepare('INSERT INTO streams(user_id,title) VALUES(?,?)').run(req.user.id,title);
  res.json({id:Number(r.lastInsertRowid),title});
});
app.post('/api/streams/:id/stop', requireAuth, (req,res) => {
  const r = db.prepare("UPDATE streams SET status='ended' WHERE id=? AND user_id=? AND status='live'").run(Number(req.params.id),req.user.id);
  if (!r.changes) return res.status(404).json({error:'Live tidak ditemukan atau bukan milikmu.'});
  io.to(`stream-${req.params.id}`).emit('stream-ended');
  res.json({ok:true});
});

app.get('/api/admin/stats', requireAdmin, (_req,res) => {
  res.json({
    users:db.prepare('SELECT COUNT(*) n FROM users').get().n,
    videos:db.prepare('SELECT COUNT(*) n FROM videos').get().n,
    comments:db.prepare('SELECT COUNT(*) n FROM comments').get().n,
    live:db.prepare("SELECT COUNT(*) n FROM streams WHERE status='live'").get().n,
    recent:db.prepare(videoSelect('', 'v.created_at DESC')+' LIMIT 10').all()
  });
});
app.delete('/api/admin/videos/:id', requireAdmin, (req,res) => {
  const video = db.prepare('SELECT filename FROM videos WHERE id=?').get(Number(req.params.id));
  if (!video) return res.status(404).json({error:'Video tidak ditemukan.'});
  const remove = db.transaction(() => {
    db.prepare('DELETE FROM likes WHERE video_id=?').run(Number(req.params.id));
    db.prepare('DELETE FROM comments WHERE video_id=?').run(Number(req.params.id));
    db.prepare('DELETE FROM history WHERE video_id=?').run(Number(req.params.id));
    db.prepare('DELETE FROM playlist_videos WHERE video_id=?').run(Number(req.params.id));
    db.prepare('DELETE FROM videos WHERE id=?').run(Number(req.params.id));
  });
  remove(); fs.unlink(path.join(UPLOAD_DIR,video.filename),()=>{}); res.json({ok:true});
});
app.delete('/api/admin/users/:id', requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({error:'Admin tidak bisa menghapus akun sendiri.'});
  const target = db.prepare('SELECT id FROM users WHERE id=?').get(id);
  if (!target) return res.status(404).json({error:'Pengguna tidak ditemukan.'});
  db.prepare('DELETE FROM likes WHERE user_id=?').run(id);
  db.prepare('DELETE FROM comments WHERE user_id=?').run(id);
  db.prepare('DELETE FROM history WHERE user_id=?').run(id);
  const lists = db.prepare('SELECT id FROM playlists WHERE user_id=?').all(id);
  lists.forEach(p=>db.prepare('DELETE FROM playlist_videos WHERE playlist_id=?').run(p.id));
  db.prepare('DELETE FROM playlists WHERE user_id=?').run(id);
  db.prepare('DELETE FROM streams WHERE user_id=?').run(id);
  db.prepare('DELETE FROM videos WHERE user_id=?').run(id);
  db.prepare('DELETE FROM users WHERE id=?').run(id);
  res.json({ok:true});
});
app.get('/api/admin/users', requireAdmin, (_req,res) => res.json(db.prepare('SELECT id,username,role,created_at FROM users ORDER BY created_at DESC').all()));

const liveOwners = new Map();
io.on('connection', socket => {
  socket.on('join-stream', ({streamId, role}) => {
    const id = Number(streamId);
    const stream = db.prepare("SELECT id,user_id FROM streams WHERE id=? AND status='live'").get(id);
    if (!stream) { socket.emit('stream-error','Live sudah berakhir atau tidak ditemukan.'); return; }
    socket.join(`stream-${id}`);
    socket.data.streamId = id;
    socket.data.role = role === 'broadcaster' ? 'broadcaster' : 'viewer';
    if (socket.data.role === 'broadcaster') {
      liveOwners.set(id,socket.id);
      socket.to(`stream-${id}`).emit('broadcaster-ready');
    } else {
      const owner = liveOwners.get(id);
      if (owner) io.to(owner).emit('viewer-joined', {viewerId:socket.id});
    }
  });
  socket.on('webrtc-offer', ({to,offer}) => io.to(to).emit('webrtc-offer',{from:socket.id,offer}));
  socket.on('webrtc-answer', ({to,answer}) => io.to(to).emit('webrtc-answer',{from:socket.id,answer}));
  socket.on('webrtc-ice', ({to,candidate}) => io.to(to).emit('webrtc-ice',{from:socket.id,candidate}));
  socket.on('disconnect', () => {
    const id=socket.data.streamId;
    if (id && socket.data.role==='broadcaster' && liveOwners.get(id)===socket.id) {
      liveOwners.delete(id); socket.to(`stream-${id}`).emit('broadcaster-left');
    }
    socket.broadcast.emit('peer-left',{id:socket.id});
  });
});

app.use((err,_req,res,_next) => {
  console.error(err);
  res.status(500).json({error:'Terjadi kesalahan server.'});
});
server.listen(PORT, () => console.log(`PlayTube berjalan di http://localhost:${PORT}`));
