'use strict';

require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');

const ROOT = __dirname;
const DB_PATH = process.env.ACUITY_DB_PATH ? path.resolve(process.env.ACUITY_DB_PATH) : path.join(ROOT, 'acuity.db');
const UPLOADS = process.env.ACUITY_UPLOADS_PATH ? path.resolve(process.env.ACUITY_UPLOADS_PATH) : path.join(ROOT, 'private_uploads');
const PORT = Number(process.env.PORT) || 3000;
const STATUSES = new Set(['PENDING', 'DOCUMENT_VERIFICATION', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISBURSED', 'CLOSED']);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const SESSION_DAYS = 7;

fs.mkdirSync(UPLOADS, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

function now() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`; }
function applicationNumber() { return `AF-${crypto.randomBytes(4).toString('hex').toUpperCase()}`; }
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}$${crypto.pbkdf2Sync(password, salt, 200000, 32, 'sha256').toString('hex')}`;
}
function verifyPassword(password, stored) {
  if (typeof stored !== 'string' || !stored.includes('$')) return false;
  const [salt, expected] = stored.split('$', 2);
  const actual = hashPassword(password, salt).split('$')[1];
  return expected.length === actual.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(actual));
}
function publicUser(row) { const { password_hash, ...user } = row; return user; }
function asNumber(value) { return value === '' || value === null || value === undefined ? null : Number(value); }
function validText(value, max = 5000) { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
function safeName(name) {
  const base = path.basename(String(name || 'upload'));
  return base.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 120) || 'upload';
}

function initialiseDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,full_name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,phone TEXT NOT NULL,password_hash TEXT NOT NULL,date_of_birth TEXT,gender TEXT,address TEXT,city TEXT,state TEXT,pincode TEXT,employment_type TEXT,company_name TEXT,monthly_income REAL,pan TEXT,role TEXT NOT NULL DEFAULT 'CLIENT',created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS loan_applications(id TEXT PRIMARY KEY,application_number TEXT UNIQUE NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),loan_type TEXT NOT NULL,loan_amount REAL NOT NULL,interest_rate REAL,tenure INTEGER NOT NULL,purpose TEXT NOT NULL,monthly_income REAL,existing_emi REAL DEFAULT 0,status TEXT NOT NULL DEFAULT 'PENDING',admin_remarks TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS application_documents(id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),document_type TEXT NOT NULL,file_name TEXT NOT NULL,file_path TEXT NOT NULL,verification_status TEXT NOT NULL DEFAULT 'PENDING',admin_remarks TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS application_status_history(id TEXT PRIMARY KEY,application_id TEXT NOT NULL REFERENCES loan_applications(id) ON DELETE CASCADE,status TEXT NOT NULL,remarks TEXT,changed_by TEXT,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),application_id TEXT REFERENCES loan_applications(id),title TEXT NOT NULL,message TEXT NOT NULL,is_read INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
  `);
  if (!db.prepare("SELECT 1 FROM users WHERE role = 'ADMIN'").get()) {
    const adminPassword = process.env.ACUITY_ADMIN_PASSWORD;
    if (!adminPassword) throw new Error('ACUITY_ADMIN_PASSWORD is required before the initial administrator can be created.');
    const timestamp = now();
    db.prepare('INSERT INTO users(id,full_name,email,phone,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
      .run('admin-001', 'Acuity Administrator', 'admin@acuity.local', '0000000000', hashPassword(adminPassword), 'ADMIN', timestamp, timestamp);
  }
}
initialiseDatabase();

const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'same-origin' } }));
const allowedOrigins = (process.env.APP_ORIGIN || '').split(',').map(value => value.trim()).filter(Boolean);
app.use(cors({ origin(origin, callback) { if (!origin || !allowedOrigins.length || allowedOrigins.includes(origin)) return callback(null, true); return callback(new Error('Origin not allowed')); }, credentials: true }));
app.use(express.json({ limit: '1mb', type: ['application/json', 'application/*+json'] }));
app.use(cookieParser());

function sendError(res, status, error) { return res.status(status).json({ error }); }
function requireAuth(role) {
  return (req, res, next) => {
    const token = req.cookies.acuity_session;
    if (!token || typeof token !== 'string' || token.length > 256) return sendError(res, 403, 'Not found or unauthorized.');
    const user = db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(token);
    if (!user || (user.expires_at && user.expires_at < now())) {
      if (user && user.expires_at < now()) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
      return sendError(res, 403, 'Not found or unauthorized.');
    }
    if (role && user.role !== role) return sendError(res, 403, 'Not found or unauthorized.');
    req.user = user;
    next();
  };
}
function sessionOptions() { return { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge: SESSION_DAYS * 86400000 }; }

const storage = multer.diskStorage({
  destination(req, file, cb) { const folder = path.join(UPLOADS, req.params.id); fs.mkdir(folder, { recursive: true }, err => cb(err, folder)); },
  filename(req, file, cb) { cb(null, `${crypto.randomUUID()}-${safeName(file.originalname)}`); }
});
const upload = multer({ storage, limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 }, fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  const allowed = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx']);
  if (!allowed.has(ext) || /[\\/\0]/.test(file.originalname)) return cb(new Error('Invalid document file type.'));
  cb(null, true);
} });

app.post('/api/auth/register', (req, res) => {
  const data = req.body || {};
  if (!validText(data.full_name, 150) || !validText(data.email, 254) || !validText(data.phone, 30) || typeof data.password !== 'string' || data.password.length < 8) return sendError(res, 400, 'Name, email, phone and an 8-character password are required.');
  const timestamp = now();
  const userId = id('cli');
  try {
    db.prepare('INSERT INTO users(id,full_name,email,phone,password_hash,date_of_birth,gender,address,city,state,pincode,employment_type,company_name,monthly_income,pan,role,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(userId, data.full_name.trim(), data.email.trim().toLowerCase(), data.phone.trim(), hashPassword(data.password), data.date_of_birth || null, data.gender || null, data.address || null, data.city || null, data.state || null, data.pincode || null, data.employment_type || null, data.company_name || null, asNumber(data.monthly_income), data.pan || null, 'CLIENT', timestamp, timestamp);
  } catch (error) { if (error.code && error.code.includes('SQLITE_CONSTRAINT')) return sendError(res, 409, 'An account with this email already exists.'); throw error; }
  res.status(201).json({ id: userId, message: 'Registration successful.' });
});

app.post('/api/auth/login', (req, res) => {
  const data = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email=?').get(String(data.email || '').trim().toLowerCase());
  if (!user || !verifyPassword(String(data.password || ''), user.password_hash)) return sendError(res, 401, 'Invalid email or password.');
  const token = crypto.randomBytes(32).toString('base64url');
  const expiry = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, user.id, expiry);
  res.cookie('acuity_session', token, sessionOptions()).json({ role: user.role, name: user.full_name });
});

app.post('/api/auth/logout', (req, res) => { if (req.cookies.acuity_session) db.prepare('DELETE FROM sessions WHERE token=?').run(req.cookies.acuity_session); res.clearCookie('acuity_session', sessionOptions()).json({ ok: true }); });

app.route('/api/client/profile').get(requireAuth('CLIENT'), (req, res) => res.json({ user: publicUser(req.user) })).put(requireAuth('CLIENT'), (req, res) => {
  const data = req.body || {}; const fields = ['full_name', 'phone', 'date_of_birth', 'gender', 'address', 'city', 'state', 'pincode', 'employment_type', 'company_name', 'monthly_income', 'pan'];
  if (!validText(data.full_name, 150) || !validText(data.phone, 30)) return sendError(res, 400, 'Name and phone are required.');
  const values = fields.map(field => field === 'monthly_income' ? asNumber(data[field]) : (data[field] || null));
  db.prepare(`UPDATE users SET ${fields.map(field => `${field}=?`).join(',')},updated_at=? WHERE id=?`).run(...values, now(), req.user.id);
  res.json({ ok: true });
});

app.route('/api/client/applications').get(requireAuth('CLIENT'), (req, res) => res.json({ applications: db.prepare('SELECT * FROM loan_applications WHERE user_id=? ORDER BY created_at DESC').all(req.user.id) })).post(requireAuth('CLIENT'), (req, res) => {
  const data = req.body || {}; const amount = asNumber(data.loan_amount); const tenure = asNumber(data.tenure);
  if (!validText(data.loan_type, 100) || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(tenure) || tenure <= 0 || !validText(data.purpose, 1000)) return sendError(res, 400, 'Missing loan information.');
  const appId = id('app'); const number = applicationNumber(); const timestamp = now();
  const create = db.transaction(() => { db.prepare('INSERT INTO loan_applications VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(appId, number, req.user.id, data.loan_type.trim(), amount, asNumber(data.interest_rate), tenure, data.purpose.trim(), asNumber(data.monthly_income), asNumber(data.existing_emi) || 0, 'PENDING', null, timestamp, timestamp); db.prepare('INSERT INTO application_status_history VALUES(?,?,?,?,?,?)').run(crypto.randomUUID().replace(/-/g, ''), appId, 'PENDING', 'Application submitted', req.user.id, timestamp); });
  try { create(); } catch (error) { if (error.code && error.code.includes('SQLITE_CONSTRAINT')) return sendError(res, 409, 'Could not create application.'); throw error; }
  res.status(201).json({ id: appId, application_number: number });
});

app.get('/api/client/applications/:id', requireAuth('CLIENT'), (req, res) => { const application = db.prepare('SELECT * FROM loan_applications WHERE id=? AND user_id=?').get(req.params.id, req.user.id); if (!application) return sendError(res, 404, 'Not found'); res.json({ application, history: db.prepare('SELECT * FROM application_status_history WHERE application_id=? ORDER BY created_at DESC').all(req.params.id), documents: db.prepare('SELECT id,application_id,document_type,file_name,verification_status,admin_remarks,created_at FROM application_documents WHERE application_id=? AND user_id=?').all(req.params.id, req.user.id) }); });

function addDocument(req, res, originalName, bytes, storedPath) { const application = db.prepare('SELECT id FROM loan_applications WHERE id=? AND user_id=?').get(req.params.id, req.user.id); if (!application) return sendError(res, 404, 'Not found'); const docId = id('doc'); db.prepare('INSERT INTO application_documents VALUES(?,?,?,?,?,?,?,?,?)').run(docId, req.params.id, req.user.id, String(req.body.document_type || 'Supporting document').slice(0, 100), safeName(originalName), storedPath, 'PENDING', null, now()); return res.status(201).json({ id: docId, message: 'Document uploaded.' }); }
function requireOwnedApplication(req, res, next) { if (!db.prepare('SELECT id FROM loan_applications WHERE id=? AND user_id=?').get(req.params.id, req.user.id)) return sendError(res, 404, 'Not found'); next(); }
app.post('/api/client/applications/:id/documents', requireAuth('CLIENT'), requireOwnedApplication, (req, res, next) => { if (req.is('application/json')) return next(); upload.single('file')(req, res, error => { if (error) return next(error); if (!req.file) return sendError(res, 400, 'A document file is required and must be under 5 MB.'); return addDocument(req, res, req.file.originalname, req.file.size, path.relative(ROOT, req.file.path)); }); }, (req, res) => {
  const data = req.body || {}; if (!validText(data.content, 7000000)) return sendError(res, 400, 'A document file is required and must be under 5 MB.');
  let raw; try { raw = Buffer.from(String(data.content).split(',', 2).pop(), 'base64'); if (!raw.length || raw.length > MAX_UPLOAD_BYTES || !/^[A-Za-z0-9+/=\s]+$/.test(String(data.content).split(',', 2).pop())) throw new Error('invalid'); } catch (_) { return sendError(res, 400, 'Invalid document data.'); }
  const filename = safeName(data.file_name); const extension = path.extname(filename).toLowerCase(); if (!new Set(['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx']).has(extension)) return sendError(res, 400, 'Invalid document file type.');
  const folder = path.join(UPLOADS, req.params.id); fs.mkdirSync(folder, { recursive: true }); const stored = `${crypto.randomUUID()}-${filename}`; fs.writeFileSync(path.join(folder, stored), raw); return addDocument(req, res, filename, raw.length, path.relative(ROOT, path.join(folder, stored)));
});
app.get('/api/client/notifications', requireAuth('CLIENT'), (req, res) => res.json({ notifications: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC').all(req.user.id) }));

app.get('/api/admin/dashboard', requireAuth('ADMIN'), (req, res) => res.json({ stats: db.prepare("SELECT COUNT(*) clients,(SELECT COUNT(*) FROM loan_applications) applications,(SELECT COUNT(*) FROM loan_applications WHERE status='PENDING') pending,(SELECT COALESCE(SUM(loan_amount),0) FROM loan_applications) total FROM users WHERE role='CLIENT'").get() }));
app.get('/api/admin/clients', requireAuth('ADMIN'), (req, res) => res.json({ clients: db.prepare("SELECT u.id,u.full_name,u.email,u.phone,u.employment_type,u.monthly_income,u.created_at,COUNT(a.id) applications FROM users u LEFT JOIN loan_applications a ON a.user_id=u.id WHERE u.role='CLIENT' GROUP BY u.id ORDER BY u.created_at DESC").all() }));
app.get('/api/admin/clients/:id', requireAuth('ADMIN'), (req, res) => { const client = db.prepare("SELECT id,full_name,email,phone,date_of_birth,gender,address,city,state,pincode,employment_type,company_name,monthly_income,pan,role,created_at,updated_at FROM users WHERE id=? AND role='CLIENT'").get(req.params.id); if (!client) return sendError(res, 404, 'Not found'); res.json({ client, applications: db.prepare('SELECT * FROM loan_applications WHERE user_id=? ORDER BY created_at DESC').all(req.params.id) }); });
app.delete('/api/admin/clients/:id', requireAuth('ADMIN'), (req, res) => { const client = db.prepare("SELECT id FROM users WHERE id=? AND role='CLIENT'").get(req.params.id); if (!client) return sendError(res, 404, 'Client not found.'); db.transaction(() => { db.prepare('DELETE FROM notifications WHERE user_id=?').run(req.params.id); db.prepare('DELETE FROM application_documents WHERE user_id=?').run(req.params.id); db.prepare('DELETE FROM application_status_history WHERE application_id IN (SELECT id FROM loan_applications WHERE user_id=?)').run(req.params.id); db.prepare('DELETE FROM loan_applications WHERE user_id=?').run(req.params.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(req.params.id); db.prepare('DELETE FROM users WHERE id=?').run(req.params.id); })(); res.json({ ok: true }); });
app.get('/api/admin/applications', requireAuth('ADMIN'), (req, res) => res.json({ applications: db.prepare('SELECT a.*,u.full_name,u.email,u.phone FROM loan_applications a JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC').all() }));
app.get('/api/admin/applications/:id/documents', requireAuth('ADMIN'), (req, res) => res.json({ documents: db.prepare('SELECT * FROM application_documents WHERE application_id=?').all(req.params.id) }));
app.get('/api/admin/applications/:id', requireAuth('ADMIN'), (req, res) => { const application = db.prepare('SELECT a.*,u.full_name,u.email,u.phone,u.address,u.city,u.state,u.employment_type,u.monthly_income,u.company_name FROM loan_applications a JOIN users u ON a.user_id=u.id WHERE a.id=?').get(req.params.id); if (!application) return sendError(res, 404, 'Not found'); res.json({ application, documents: db.prepare('SELECT * FROM application_documents WHERE application_id=?').all(req.params.id), history: db.prepare('SELECT * FROM application_status_history WHERE application_id=? ORDER BY created_at DESC').all(req.params.id) }); });
app.put('/api/admin/applications/:id/status', requireAuth('ADMIN'), (req, res) => { const { status, remarks } = req.body || {}; if (!STATUSES.has(status)) return sendError(res, 400, 'Invalid status.'); const application = db.prepare('SELECT user_id,application_number FROM loan_applications WHERE id=?').get(req.params.id); if (!application) return sendError(res, 404, 'Not found'); const timestamp = now(); db.transaction(() => { db.prepare('UPDATE loan_applications SET status=?,admin_remarks=?,updated_at=? WHERE id=?').run(status, remarks || null, timestamp, req.params.id); db.prepare('INSERT INTO application_status_history VALUES(?,?,?,?,?,?)').run(crypto.randomUUID().replace(/-/g, ''), req.params.id, status, remarks || null, req.user.id, timestamp); db.prepare('INSERT INTO notifications VALUES(?,?,?,?,?,?,?)').run(id('note'), application.user_id, req.params.id, 'Application status updated', `Your application ${application.application_number} is now ${status}.`, 0, timestamp); })(); res.json({ ok: true }); });

// Documents remain private; this download endpoint is intentionally authenticated and authorised.
app.get('/api/documents/:id/download', requireAuth(), (req, res) => { const document = db.prepare('SELECT d.*,a.user_id application_owner FROM application_documents d JOIN loan_applications a ON a.id=d.application_id WHERE d.id=?').get(req.params.id); if (!document || (req.user.role !== 'ADMIN' && document.application_owner !== req.user.id)) return sendError(res, 404, 'Not found'); const file = path.resolve(ROOT, document.file_path); if (!file.startsWith(`${path.resolve(UPLOADS)}${path.sep}`) || !fs.existsSync(file)) return sendError(res, 404, 'Not found'); res.download(file, safeName(document.file_name)); });

app.use('/api', (req, res) => sendError(res, 404, 'Not found or unauthorized.'));
// The frontend currently lives at the project root. Explicitly deny all private and
// deployment files before mounting the static handler.
app.use((req, res, next) => {
  const requested = path.basename(req.path).toLowerCase();
  if (['acuity.db', 'server.js', 'server.py', '.env', 'package.json', 'package-lock.json'].includes(requested) || req.path.startsWith('/private_uploads/')) return sendError(res, 404, 'Not found');
  next();
});
app.use(express.static(ROOT, { dotfiles: 'deny', index: 'index.html', fallthrough: true, setHeaders(res) { res.setHeader('Cache-Control', 'no-store'); } }));
app.get(['/','/admin'], (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.use((error, req, res, next) => { if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') return sendError(res, 400, 'A document file is too large.'); if (error && error.message === 'Invalid document file type.') return sendError(res, 400, error.message); if (error && error.message === 'Origin not allowed') return sendError(res, 403, 'Origin not allowed.'); console.error('Request failed:', error && error.message); return sendError(res, 500, 'An unexpected error occurred.'); });

if (require.main === module) app.listen(PORT, '0.0.0.0', () => console.log(`Acuity Finance listening on port ${PORT}`));
module.exports = { app, db, hashPassword, verifyPassword };
