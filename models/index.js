const Candidate = require('./Candidate');
const Communication = require('./Communication');
const Admin = require('./Admin');

// Associations
Candidate.hasMany(Communication, { foreignKey: 'candidateId', as: 'communications', onDelete: 'CASCADE' });
Communication.belongsTo(Candidate, { foreignKey: 'candidateId' });

module.exports = { Candidate, Communication, Admin };
