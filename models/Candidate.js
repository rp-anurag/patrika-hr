const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/db');

const Candidate = sequelize.define('Candidate', {
  id:               { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  fullName:         { type: DataTypes.STRING(255), allowNull: false },
  contactNumber:    { type: DataTypes.STRING(20),  allowNull: false },
  email:            { type: DataTypes.STRING(255), allowNull: false },
  linkedInProfile:  { type: DataTypes.STRING(500) },
  currentLocation:  { type: DataTypes.STRING(255), allowNull: false },
  positionApplying: {
    type: DataTypes.ENUM('FMCG Jaipur','FMCG Rajasthan','FMCG MPCG','Business Analyst','Raj Head- Radio','Jaipur Head- Radio','Delhi Head- Print','OOH Delhi','OOH Mumbai','Dy. Raj Head-Print'),
    allowNull: false
  },

  // Package — stored flat, exposed as nested via virtual
  packageFixed:     { type: DataTypes.DECIMAL(10,2), defaultValue: 0 },
  packageVariables: { type: DataTypes.DECIMAL(10,2), defaultValue: 0 },
  packageOthers:    { type: DataTypes.DECIMAL(10,2), defaultValue: 0 },

  noticePeriod: {
    type: DataTypes.ENUM('Immediate','15 Days','30 Days','60 Days','90 Days'),
    allowNull: false
  },

  // Resume file — stored flat, exposed as nested via virtual
  resumeOriginalName: { type: DataTypes.STRING(500) },
  resumeStoredName:   { type: DataTypes.STRING(500) },
  resumePath:         { type: DataTypes.STRING(1000) },
  resumeMimetype:     { type: DataTypes.STRING(100) },
  resumeSize:         { type: DataTypes.INTEGER },

  // Parsed data — stored flat, exposed as nested via virtual
  parsedName:               { type: DataTypes.STRING(255) },
  parsedEmail:              { type: DataTypes.STRING(255) },
  parsedPhone:              { type: DataTypes.STRING(30) },
  parsedLocation:           { type: DataTypes.STRING(255) },
  parsedSkills:             { type: DataTypes.TEXT },
  parsedLinkedIn:           { type: DataTypes.STRING(500) },
  parsedSummary:            { type: DataTypes.TEXT },
  parsedTotalExperience:    { type: DataTypes.STRING(100) },
  parsedCurrentRole:        { type: DataTypes.STRING(255) },
  parsedExperienceEntries:  { type: DataTypes.TEXT('long') }, // JSON string
  parsedEducation:          { type: DataTypes.TEXT('long') }, // JSON string
  parsedRawText:            { type: DataTypes.TEXT('long') },

  status: {
    type: DataTypes.ENUM('New','Screening','Shortlisted','Interview Scheduled','Offer Extended','Hired','Rejected'),
    defaultValue: 'New'
  },
  adminNotes: { type: DataTypes.TEXT, defaultValue: '' },

  // Motivational questions
  whyJoinUs:       { type: DataTypes.TEXT },
  first90DaysPlan: { type: DataTypes.TEXT },

  // ── Virtuals (keep view templates unchanged from MongoDB version) ────────────

  currentPackage: {
    type: DataTypes.VIRTUAL,
    get() {
      return {
        fixed:     parseFloat(this.getDataValue('packageFixed'))     || 0,
        variables: parseFloat(this.getDataValue('packageVariables')) || 0,
        others:    parseFloat(this.getDataValue('packageOthers'))    || 0
      };
    }
  },

  resumeFile: {
    type: DataTypes.VIRTUAL,
    get() {
      if (!this.getDataValue('resumeOriginalName')) return null;
      return {
        originalName: this.getDataValue('resumeOriginalName'),
        storedName:   this.getDataValue('resumeStoredName'),
        path:         this.getDataValue('resumePath'),
        mimetype:     this.getDataValue('resumeMimetype'),
        size:         this.getDataValue('resumeSize')
      };
    }
  },

  parsedData: {
    type: DataTypes.VIRTUAL,
    get() {
      const safeJSON = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
      return {
        name:              this.getDataValue('parsedName'),
        email:             this.getDataValue('parsedEmail'),
        phone:             this.getDataValue('parsedPhone'),
        location:          this.getDataValue('parsedLocation'),
        skills:            safeJSON(this.getDataValue('parsedSkills')) || [],
        linkedin:          this.getDataValue('parsedLinkedIn'),
        summary:           this.getDataValue('parsedSummary'),
        totalExperience:   this.getDataValue('parsedTotalExperience'),
        currentRole:       this.getDataValue('parsedCurrentRole'),
        experienceEntries: safeJSON(this.getDataValue('parsedExperienceEntries')) || [],
        education:         safeJSON(this.getDataValue('parsedEducation')) || []
      };
    }
  },

  totalPackage: {
    type: DataTypes.VIRTUAL,
    get() {
      return (parseFloat(this.getDataValue('packageFixed'))     || 0)
           + (parseFloat(this.getDataValue('packageVariables')) || 0)
           + (parseFloat(this.getDataValue('packageOthers'))    || 0);
    }
  },

  submittedAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
  updatedAt:   { type: DataTypes.DATE, defaultValue: DataTypes.NOW }

}, {
  tableName: 'candidates',
  timestamps: false   // we handle submittedAt / updatedAt manually
});

module.exports = Candidate;
