const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const ActivityLog = sequelize.define('ActivityLog', {
  id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  candidateId: { type: DataTypes.INTEGER, allowNull: false },
  activityType: {
    type: DataTypes.ENUM(
      'application_received',
      'status_changed',
      'note_saved',
      'email_sent',
      'whatsapp_sent',
      'interview_updated',
      'detail_form_submitted'
    ),
    allowNull: false
  },
  title:       { type: DataTypes.STRING(255), allowNull: true },
  details:     { type: DataTypes.TEXT,        allowNull: true },
  oldValue:    { type: DataTypes.STRING(255), allowNull: true },
  newValue:    { type: DataTypes.STRING(255), allowNull: true },
  performedBy: { type: DataTypes.STRING(100), defaultValue: 'System' },
  createdAt:   { type: DataTypes.DATE,        defaultValue: DataTypes.NOW }
}, {
  tableName: 'candidate_activity_logs',
  timestamps: false
});

module.exports = ActivityLog;
