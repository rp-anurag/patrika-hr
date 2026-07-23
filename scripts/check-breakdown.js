'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { sequelize } = require('../config/db');
sequelize.authenticate().then(async () => {
  const [rows] = await sequelize.query('SELECT breakdown FROM smart_fit_scores LIMIT 1');
  const parsed = JSON.parse(rows[0].breakdown);
  console.log(JSON.stringify(parsed, null, 2));
  process.exit(0);
}).catch(e => { console.error(e.message); process.exit(1); });
