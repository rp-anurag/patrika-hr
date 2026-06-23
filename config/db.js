const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
  process.env.DB_NAME || 'patrika_hr',
  process.env.DB_USER || 'root',
  process.env.DB_PASS || '',
  {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT) || 3306,
    dialect: 'mysql',
    logging: false,
    pool: { max: 10, min: 0, acquire: 30000, idle: 10000 }
  }
);

const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('MySQL Connected successfully.');

    // Auto-create tables if they don't exist (safe — never drops data)
    const { Candidate, Communication, Admin } = require('../models');
    await sequelize.sync({ alter: false, force: false });
    console.log('Database tables ready.');
  } catch (error) {
    console.error('MySQL connection error:', error.message);
    process.exit(1);
  }
};

module.exports = { sequelize, connectDB };
