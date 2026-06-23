require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const path = require('path');
const { connectDB } = require('./config/db');
const candidateRoutes = require('./routes/candidateRoutes');
const adminRoutes = require('./routes/adminRoutes');
const { generateQR } = require('./utils/qrGenerator');

const app = express();

// MySQL session store — sessions survive server restarts
const sessionStore = new MySQLStore({
  host:     process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER || 'root',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'patrika_hr',
  clearExpired:           true,
  checkExpirationInterval: 900000,   // 15 min cleanup
  expiration:             86400000   // 24 hr session TTL
});

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// Session
app.use(session({
  secret:            process.env.SESSION_SECRET || 'patrika-hr-secret-2024',
  resave:            false,
  saveUninitialized: false,
  store:             sessionStore,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true }
}));

// Routes
app.use('/', candidateRoutes);
app.use('/admin', adminRoutes);

// 404
app.use((req, res) => {
  res.status(404).send('<h2 style="font-family:sans-serif">404 – Page Not Found</h2><a href="/">Go Home</a>');
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send(`<h2>Server Error</h2><pre>${err.message}</pre>`);
});

const PORT    = process.env.PORT    || 3000;
const APP_URL = process.env.APP_URL || `http://localhost:${PORT}`;

// Connect to MySQL first, then start server
connectDB().then(async () => {
  app.listen(PORT, async () => {
    console.log(`\n========================================`);
    console.log(`  Patrika HR System running on port ${PORT}`);
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
