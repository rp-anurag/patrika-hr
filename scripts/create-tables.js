/**
 * One-time setup: creates all tables on the configured MySQL database.
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS, never drops data.
 * Usage:  node scripts/create-tables.js
 */
require('dotenv').config();
const mysql2 = require('mysql2/promise');

const DB = {
  host:               process.env.DB_HOST,
  port:               parseInt(process.env.DB_PORT) || 3306,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASS,
  database:           process.env.DB_NAME,
  ssl:                process.env.DB_HOST.includes('amazonaws.com') ? { rejectUnauthorized: false } : false,
  connectTimeout:     20000,
  multipleStatements: true   // lets us send all DDL in one call
};

// Each entry: { label, sql }
const TABLES = [
  {
    label: 'sessions',
    sql: `CREATE TABLE IF NOT EXISTS sessions (
      session_id  VARCHAR(128)         NOT NULL,
      expires     INT(11) UNSIGNED     NOT NULL,
      data        MEDIUMTEXT,
      PRIMARY KEY (session_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  },
  {
    label: 'admins',
    sql: `CREATE TABLE IF NOT EXISTS admins (
      id         INT(11)      NOT NULL AUTO_INCREMENT,
      username   VARCHAR(100) NOT NULL,
      password   VARCHAR(255) NOT NULL,
      name       VARCHAR(255) DEFAULT 'Admin',
      createdAt  DATETIME     DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_admin_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  },
  {
    label: 'candidates',
    sql: `CREATE TABLE IF NOT EXISTS candidates (
      id                 INT(11)      NOT NULL AUTO_INCREMENT,
      fullName           VARCHAR(255) NOT NULL,
      contactNumber      VARCHAR(20)  NOT NULL,
      email              VARCHAR(255) NOT NULL,
      currentLocation    VARCHAR(255) NOT NULL,
      positionApplying   ENUM('FMCG Jaipur','FMCG Rajasthan','FMCG MPCG','Chief Digital Officer','NHM Marketing Analyst','CTO','CFO') NOT NULL,
      packageFixed       DECIMAL(10,2) DEFAULT 0.00,
      packageVariables   DECIMAL(10,2) DEFAULT 0.00,
      packageOthers      DECIMAL(10,2) DEFAULT 0.00,
      noticePeriod       ENUM('Immediate','15 Days','30 Days','60 Days','90 Days') NOT NULL,
      resumeOriginalName VARCHAR(500)  DEFAULT NULL,
      resumeStoredName   VARCHAR(500)  DEFAULT NULL,
      resumePath         VARCHAR(1000) DEFAULT NULL,
      resumeMimetype     VARCHAR(100)  DEFAULT NULL,
      resumeSize         INT(11)       DEFAULT NULL,
      parsedName         VARCHAR(255)  DEFAULT NULL,
      parsedEmail        VARCHAR(255)  DEFAULT NULL,
      parsedPhone        VARCHAR(30)   DEFAULT NULL,
      parsedLocation     VARCHAR(255)  DEFAULT NULL,
      parsedSkills       TEXT          DEFAULT NULL,
      parsedRawText      LONGTEXT      DEFAULT NULL,
      status             ENUM('New','Screening','Shortlisted','Interview Scheduled','Offer Extended','Hired','Rejected') DEFAULT 'New',
      adminNotes         TEXT          DEFAULT NULL,
      submittedAt        DATETIME      DEFAULT CURRENT_TIMESTAMP,
      updatedAt          DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_status    (status),
      KEY idx_position  (positionApplying),
      KEY idx_submitted (submittedAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  },
  {
    label: 'communications',
    sql: `CREATE TABLE IF NOT EXISTS communications (
      id           INT(11)      NOT NULL AUTO_INCREMENT,
      candidateId  INT(11)      NOT NULL,
      channel      ENUM('Email','WhatsApp') NOT NULL,
      subject      VARCHAR(500) DEFAULT NULL,
      message      TEXT         NOT NULL,
      sentAt       DATETIME     DEFAULT CURRENT_TIMESTAMP,
      sentBy       VARCHAR(100) DEFAULT 'Admin',
      status       ENUM('Sent','Failed') DEFAULT 'Sent',
      PRIMARY KEY (id),
      KEY idx_comm_candidate (candidateId),
      CONSTRAINT fk_comm_candidate
        FOREIGN KEY (candidateId) REFERENCES candidates (id)
        ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  }
];

async function run() {
  console.log('\n  Connecting to MySQL...');
  console.log(`  Host : ${DB.host}`);
  console.log(`  DB   : ${DB.database}`);
  console.log(`  User : ${DB.user}\n`);

  const conn = await mysql2.createConnection(DB);

  for (const { label, sql } of TABLES) {
    try {
      await conn.execute(sql);
      console.log(`  [OK]  Table '${label}' ready`);
    } catch (err) {
      console.error(`  [ERR] Table '${label}': ${err.message}`);
    }
  }

  // Show final table list
  console.log('\n  Tables now in database:');
  const [rows] = await conn.execute('SHOW TABLES');
  rows.forEach(r => console.log('    -', Object.values(r)[0]));

  // Show column count per table for quick sanity check
  console.log('\n  Column counts:');
  for (const { label } of TABLES) {
    try {
      const [cols] = await conn.execute(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [DB.database, label]
      );
      console.log(`    - ${label}: ${cols[0].cnt} columns`);
    } catch (_) {}
  }

  await conn.end();
  console.log('\n  Setup complete.\n');
}

run().catch(err => {
  console.error('\n  Fatal error:', err.message);
  process.exit(1);
});
