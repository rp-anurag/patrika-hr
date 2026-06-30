require('dotenv').config();
const express    = require('express');
const https      = require('https');
const http       = require('http');
const session    = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path       = require('path');
const fs         = require('fs');
const { connectDB } = require('./config/db');
const candidateRoutes  = require('./routes/candidateRoutes');
const adminRoutes      = require('./routes/adminRoutes');
const detailFormRoutes = require('./routes/detailFormRoutes');
const { generateQR }   = require('./utils/qrGenerator');

const app = express();

// ── SSL certificate (generated via: openssl req -x509 ..., stored in certs/) ─
const sslOptions = {
  key:  fs.readFileSync(path.join(__dirname, 'certs', 'key.pem')),
  cert: fs.readFileSync(path.join(__dirname, 'certs', 'cert.pem'))
};

// ── MySQL session store ───────────────────────────────────────────────────────
const sessionStore = new MySQLStore({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'patrika_hr',
  clearExpired:            true,
  checkExpirationInterval: 900000,
  expiration:              86400000
});

// ── View engine ───────────────────────────────────────────────────────────────
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Static assets ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1m', etag: false }));
app.use('/uploads/photos', express.static(path.join(__dirname, 'uploads/photos')));

// ── Redirect HTTP → HTTPS ─────────────────────────────────────────────────────
const HTTP_PORT  = parseInt(process.env.HTTP_PORT)  || 4080;
const HTTPS_PORT = parseInt(process.env.PORT)        || 4000;

http.createServer((req, res) => {
  const host = req.headers.host ? req.headers.host.replace(`:${HTTP_PORT}`, `:${HTTPS_PORT}`) : req.headers.host;
  res.writeHead(301, { Location: `https://${host}${req.url}` });
  res.end();
}).listen(HTTP_PORT, () => {
  console.log(`  HTTP → HTTPS redirect on port ${HTTP_PORT}`);
});

// ── No-cache middleware ───────────────────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path.endsWith('/preview')) return next();
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// ── Asset version for cache busting ──────────────────────────────────────────
const ASSET_VERSION = Date.now();
app.use((req, res, next) => { res.locals.v = ASSET_VERSION; next(); });

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || 'patrika-hr-secret-2024',
  resave:            false,
  saveUninitialized: false,
  store:             sessionStore,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, secure: true }
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', candidateRoutes);
app.use('/', detailFormRoutes);
app.use('/admin', adminRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).send('<h2 style="font-family:sans-serif">404 – Page Not Found</h2><a href="/">Go Home</a>');
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send(`<h2>Server Error</h2><pre>${err.message}</pre>`);
});

// ── Start HTTPS server ────────────────────────────────────────────────────────
const APP_URL = process.env.APP_URL || `https://localhost:${HTTPS_PORT}`;

connectDB().then(async () => {
  https.createServer(sslOptions, app).listen(HTTPS_PORT, async () => {
    console.log(`\n========================================`);
    console.log(`  Patrika HR System (HTTPS)`);
    console.log(`  App URL   : ${APP_URL}`);
    console.log(`  Form URL  : ${APP_URL}/apply`);
    console.log(`  Admin URL : ${APP_URL}/admin`);
    console.log(`========================================\n`);

    try {
      await generateQR(`${APP_URL}/apply`);
    } catch (err) {
      console.warn('QR generation warning:', err.message);
    }
  });
});
