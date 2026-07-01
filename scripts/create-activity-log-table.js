/**
 * Migration: create candidate_activity_logs table
 * Run once: node scripts/create-activity-log-table.js
 */
require('dotenv').config();
const { sequelize } = require('../config/db');

async function run() {
  try {
    await sequelize.authenticate();
    console.log('DB connected.');

    await sequelize.query(`
      CREATE TABLE IF NOT EXISTS candidate_activity_logs (
        id            INT AUTO_INCREMENT PRIMARY KEY,
        candidateId   INT NOT NULL,
        activityType  ENUM(
          'application_received',
          'status_changed',
          'note_saved',
          'email_sent',
          'whatsapp_sent',
          'interview_updated',
          'detail_form_submitted'
        ) NOT NULL,
        title         VARCHAR(255),
        details       TEXT,
        oldValue      VARCHAR(255),
        newValue      VARCHAR(255),
        performedBy   VARCHAR(100) DEFAULT 'System',
        createdAt     DATETIME DEFAULT NOW(),
        INDEX idx_candidate (candidateId),
        CONSTRAINT fk_activity_candidate
          FOREIGN KEY (candidateId) REFERENCES candidates(id)
          ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    console.log('Table candidate_activity_logs created (or already exists).');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  }
}

run();
