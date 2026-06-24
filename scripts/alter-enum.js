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

  const sql = "ALTER TABLE candidates MODIFY COLUMN positionApplying ENUM('FMCG Jaipur','FMCG Rajasthan','FMCG MPCG','Chief Digital Officer','Business Analyst','CTO','Raj Head- Radio','Jaipur Head- Radio','Delhi Head- Print','OOH Delhi','OOH Mumbai','Dy. Raj Head-Print') NOT NULL";

  await conn.execute(sql);
  console.log('Done — NHM Marketing Analyst renamed to Business Analyst on RDS');
  await conn.end();
}

run().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
