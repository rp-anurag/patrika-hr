const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const InterviewSheet = sequelize.define('InterviewSheet', {
  id:          { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  candidateId: { type: DataTypes.INTEGER, allowNull: false },

  // Header
  interviewMode: {
    type: DataTypes.ENUM('Zoom','Physical','Telephonic'),
    defaultValue: 'Physical'
  },
  scheduledDate: { type: DataTypes.STRING(20), allowNull: true },

  // Preliminary Round
  prelimInterviewedBy: { type: DataTypes.STRING(255), allowNull: true },
  prelimDate:          { type: DataTypes.STRING(20),  allowNull: true },
  prelimFamilyNotes:   { type: DataTypes.TEXT,        allowNull: true },

  // Round 1
  r1InterviewedBy: { type: DataTypes.STRING(255), allowNull: true },
  r1Date:          { type: DataTypes.STRING(20),  allowNull: true },
  r1Recommendation: {
    type: DataTypes.ENUM('Can be hired','Can be considered for','Recommended Future Opening','Not Recommended'),
    allowNull: true
  },
  r1ConsiderFor:       { type: DataTypes.STRING(255), allowNull: true },
  r1RecommendedSalary: { type: DataTypes.STRING(100), allowNull: true },
  r1Designation:       { type: DataTypes.STRING(255), allowNull: true },
  r1Marks:             { type: DataTypes.INTEGER,     allowNull: true },
  r1Feedback:          { type: DataTypes.TEXT,        allowNull: true },

  // Round 2
  r2InterviewedBy: { type: DataTypes.STRING(255), allowNull: true },
  r2Date:          { type: DataTypes.STRING(20),  allowNull: true },
  r2Recommendation: {
    type: DataTypes.ENUM('Can be hired','Can be considered for','Recommended Future Opening','Not Recommended'),
    allowNull: true
  },
  r2ConsiderFor:       { type: DataTypes.STRING(255), allowNull: true },
  r2RecommendedSalary: { type: DataTypes.STRING(100), allowNull: true },
  r2Designation:       { type: DataTypes.STRING(255), allowNull: true },
  r2Marks:             { type: DataTypes.INTEGER,     allowNull: true },
  r2Feedback:          { type: DataTypes.TEXT,        allowNull: true },

  // HR Round
  hrInterviewedBy: { type: DataTypes.STRING(255), allowNull: true },
  hrDate:          { type: DataTypes.STRING(20),  allowNull: true },
  hrRecommendation: {
    type: DataTypes.ENUM('Can be hired','Can be considered for','Recommended Future Opening','Not Recommended'),
    allowNull: true
  },
  hrConsiderFor:       { type: DataTypes.STRING(255), allowNull: true },
  hrRecommendedSalary: { type: DataTypes.STRING(100), allowNull: true },
  hrDesignation:       { type: DataTypes.STRING(255), allowNull: true },
  hrMarks:             { type: DataTypes.INTEGER,     allowNull: true },
  hrFeedback:          { type: DataTypes.TEXT,        allowNull: true },

  // Final Offer
  salaryOffered:   { type: DataTypes.STRING(100), allowNull: true },
  reportingTo:     { type: DataTypes.STRING(255), allowNull: true },
  otherConditions: { type: DataTypes.TEXT,        allowNull: true },
  buddyName:       { type: DataTypes.STRING(255), allowNull: true },
  natureOfAppointment: {
    type: DataTypes.ENUM('Permanent','Contract','Probationary'),
    defaultValue: 'Probationary'
  },
  probationPeriod: { type: DataTypes.STRING(100), allowNull: true },
  exitClause: {
    type: DataTypes.ENUM('Applicable','Not Applicable'),
    defaultValue: 'Applicable'
  },
  joiningPeriod: { type: DataTypes.STRING(100), allowNull: true },
  finalRemarks:  { type: DataTypes.TEXT,        allowNull: true },

  // Final Decision
  finalDecision: {
    type: DataTypes.ENUM('Selected','On Hold','Rejected','Pending'),
    defaultValue: 'Pending'
  },

  overallScore: { type: DataTypes.INTEGER, allowNull: true },

  createdAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW }

}, {
  tableName: 'interview_sheets',
  timestamps: false
});

module.exports = InterviewSheet;
