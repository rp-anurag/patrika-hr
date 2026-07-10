const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Communication = sequelize.define('Communication', {
  id:          { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  candidateId: { type: DataTypes.INTEGER, allowNull: false },
  channel:     { type: DataTypes.ENUM('Email', 'WhatsApp'), allowNull: false },
  direction:   { type: DataTypes.ENUM('outbound', 'inbound'), defaultValue: 'outbound' },
  subject:     { type: DataTypes.STRING(500) },
  message:     { type: DataTypes.TEXT, allowNull: false },
  sentAt:      { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  sentBy:      { type: DataTypes.STRING(100), defaultValue: 'Admin' },
  status:      { type: DataTypes.ENUM('Sent', 'Failed'), defaultValue: 'Sent' }
}, {
  tableName: 'communications',
  timestamps: false
});

module.exports = Communication;
