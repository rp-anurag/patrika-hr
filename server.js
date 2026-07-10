require('dotenv').config();
const express    = require('express');
const session    = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path       = require('path');
const { connectDB } = require('./config/db');
const candidateRoutes    = require('./routes/candidateRoutes');
const adminRoutes        = require('./routes/adminRoutes');
const detailFormRoutes   = require('./routes/detailFormRoutes');
const requisitionRoutes  = require('./routes/requisitionRoutes');
const testRoutes         = require('./routes/testRoutes');
const testController     = require('./controllers/testController');
const { requireAdmin, requireCandidateAccess } = require('./middleware/auth');
const { generateQR }     = require('./utils/qrGenerator');

const app = express();

// ── MySQL session store ───────────────────────────────────────────────────────
// Use our own mysql2 pool with keep-alive so idle connections to AWS RDS are
// not silently dropped (dropped connections caused ECONNRESET crashes).
const mysql2 = require('mysql2/promise');
const sessionPool = mysql2.createPool({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'patrika_hr',
  waitForConnections:   true,
  connectionLimit:      5,
  enableKeepAlive:      true,
  keepAliveInitialDelay: 10000
});
const sessionStore = new MySQLStore({
  clearExpired:            true,
  checkExpirationInterval: 900000,
  expiration:              86400000
}, sessionPool);

// Never let a dropped DB connection kill the whole server
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err && err.message ? err.message : err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err && err.message ? err.message : err);
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
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true }
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/', candidateRoutes);
app.use('/', detailFormRoutes);
app.use('/', requisitionRoutes);
app.use('/', testRoutes);

// Assessment test routes — registered directly to avoid router mounting ambiguity
app.post('/admin/candidate/:id/send-test', requireAdmin, requireCandidateAccess, testController.sendTest);
app.get('/admin/candidate/:id/tests',      requireAdmin, requireCandidateAccess, testController.listTests);
app.get('/admin/test-result/:testId',      requireAdmin, testController.viewResult);

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

// ── Start server ──────────────────────────────────────────────────────────────
const PORT    = parseInt(process.env.PORT) || 4000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

async function seedDepartments() {
  const { Department } = require('./models');
  const defaults = [
    'Finance','HR','IT','Legal','Marketing','OOH',
    'Print','Print Advertising','Radio','Sales & Distribution'
  ];
  for (const name of defaults) {
    await Department.findOrCreate({ where: { name } });
  }
}

async function migratePositionColumn() {
  const { sequelize } = require('./config/db');
  await sequelize.query(
    "ALTER TABLE candidates MODIFY COLUMN positionApplying VARCHAR(255) NULL"
  );
}

async function migrateDepartmentColumn() {
  const { sequelize } = require('./config/db');
  await sequelize.query("ALTER TABLE admins MODIFY COLUMN department TEXT NULL");
}

async function migrateActivityLogEnum() {
  const { sequelize } = require('./config/db');
  await sequelize.query(`
    ALTER TABLE candidate_activity_logs MODIFY COLUMN activityType
    ENUM('application_received','status_changed','note_saved','email_sent',
         'whatsapp_sent','interview_updated','detail_form_submitted',
         'test_sent','test_submitted') NOT NULL
  `);
}

async function migrateCandidateTests() {
  const { sequelize } = require('./config/db');
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS candidate_tests (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      candidateId   INT NOT NULL,
      positionName  VARCHAR(255),
      token         VARCHAR(64) UNIQUE NOT NULL,
      questions     LONGTEXT,
      answers       TEXT,
      score         INT DEFAULT NULL,
      maxScore      INT DEFAULT 100,
      status        ENUM('pending','completed') DEFAULT 'pending',
      sentAt        DATETIME DEFAULT CURRENT_TIMESTAMP,
      submittedAt   DATETIME DEFAULT NULL,
      INDEX (candidateId),
      INDEX (token)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

connectDB().then(async () => {
  await migratePositionColumn().catch(e => console.warn('Migration warning:', e.message));
  await migrateDepartmentColumn().catch(e => console.warn('Dept column migration warning:', e.message));
  await migrateCandidateTests().catch(e => console.warn('Candidate tests table warning:', e.message));
  await migrateActivityLogEnum().catch(e => console.warn('Activity log enum warning:', e.message));
  await seedDepartments().catch(e => console.warn('Dept seed warning:', e.message));
  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n========================================`);
    console.log(`  Patrika HR System running`);
    console.log(`  Local   : http://localhost:${PORT}/admin`);
    console.log(`  Network : ${APP_URL}/admin`);
    console.log(`  Form    : ${APP_URL}/apply`);
    console.log(`========================================\n`);

    try {
      await generateQR(`${APP_URL}/apply`);
    } catch (err) {
      console.warn('QR generation warning:', err.message);
    }
  });
});
