require('dotenv').config();
const mysql = require('mysql2/promise');

async function run() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false }
  });

  const alterations = [
    // Remove CTO from ENUM
    "ALTER TABLE candidates MODIFY COLUMN positionApplying ENUM('FMCG Jaipur','FMCG Rajasthan','FMCG MPCG','Business Analyst','Raj Head- Radio','Jaipur Head- Radio','Delhi Head- Print','OOH Delhi','OOH Mumbai','Dy. Raj Head-Print') NOT NULL",
    // Add motivational question columns
    "ALTER TABLE candidates ADD COLUMN whyJoinUs TEXT AFTER adminNotes",
    "ALTER TABLE candidates ADD COLUMN first90DaysPlan TEXT AFTER whyJoinUs"
  ];

  for (const sql of alterations) {
    try {
      await conn.execute(sql);
      console.log('OK:', sql.slice(0, 70));
    } catch (e) {
      if (e.errno === 1060) {
        console.log('Already exists, skipping:', sql.slice(0, 70));
      } else {
        throw e;
      }
    }
  }

  await conn.end();
  console.log('Done.');
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
