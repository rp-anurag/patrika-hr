'use strict';

const { Candidate, Position } = require('../models');
const { sequelize }           = require('../config/db');
const { analyseSmartFit, PARAM_META } = require('../utils/smartFitAnalyst');
const { Op } = require('sequelize');

// ── helpers ──────────────────────────────────────────────────────────────────

async function ensureTables() {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS smart_fit_configs (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      positionName VARCHAR(255) NOT NULL UNIQUE,
      config       TEXT NOT NULL,
      updatedAt    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS smart_fit_scores (
      id             INT AUTO_INCREMENT PRIMARY KEY,
      candidateId    INT NOT NULL,
      positionName   VARCHAR(255) NOT NULL,
      totalScore     INT NOT NULL,
      breakdown      LONGTEXT,
      configSnapshot TEXT,
      analysedAt     DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cand_pos (candidateId, positionName),
      INDEX (positionName),
      INDEX (candidateId)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// ── show page ─────────────────────────────────────────────────────────────────

exports.showPage = async (req, res) => {
  try {
    await ensureTables();

    const isSuperAdmin = req.session.adminRole === 'admin';
    const depts  = req.session.adminDepartments || (req.session.adminDepartment ? [req.session.adminDepartment] : []);
    const posns  = req.session.adminPositions   || [];
    const isInverse = posns.includes('__INVERSE__');
    const realPosns = posns.filter(p => p !== '__NULL__' && p !== '__INVERSE__');
    const hasPosFilter  = !isSuperAdmin && posns.length > 0;
    const hasDeptFilter = !isSuperAdmin && !hasPosFilter && depts.length > 0;

    const positions = await Position.findAll({
      where: hasPosFilter && !isInverse
        ? { isActive: true, name: { [Op.in]: realPosns } }
        : hasDeptFilter
          ? { isActive: true, department: { [Op.in]: depts } }
          : { isActive: true },
      order: [['sortOrder', 'ASC'], ['name', 'ASC']]
    });

    // Load saved configs
    const [cfgRows] = await sequelize.query('SELECT positionName, config FROM smart_fit_configs');
    const savedConfigs = {};
    cfgRows.forEach(r => {
      try { savedConfigs[r.positionName] = JSON.parse(r.config); } catch(e) {}
    });

    res.render('admin/smart-fit', {
      title:           'Smart Fit Analyzer – Patrika HR',
      adminName:       req.session.adminName,
      adminRole:       req.session.adminRole,
      adminDepartment: req.session.adminDepartment,
      positions,
      savedConfigs,
      paramMeta:       PARAM_META,
      v:               res.locals.v
    });
  } catch (err) {
    console.error('smartFit showPage error:', err);
    res.status(500).send('<h2>Error</h2><pre>' + err.message + '</pre>');
  }
};

// ── save config ───────────────────────────────────────────────────────────────

exports.saveConfig = async (req, res) => {
  try {
    const { positionName, config } = req.body;
    if (!positionName || !config) return res.status(400).json({ error: 'positionName and config required' });

    const total = Object.values(config).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    if (Math.round(total) !== 100) return res.status(400).json({ error: `Weights must sum to 100 (got ${total})` });

    await sequelize.query(
      `INSERT INTO smart_fit_configs (positionName, config) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE config = VALUES(config), updatedAt = NOW()`,
      { replacements: [positionName, JSON.stringify(config)] }
    );
    res.json({ success: true });
  } catch (err) {
    console.error('smartFit saveConfig error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── analyse ───────────────────────────────────────────────────────────────────

exports.analyse = async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(400).json({ error: 'GROQ_API_KEY not configured' });

    const { positionName, config, candidateIds } = req.body;
    if (!positionName || !config) return res.status(400).json({ error: 'positionName and config required' });

    const total = Object.values(config).reduce((s, v) => s + (parseFloat(v) || 0), 0);
    if (Math.round(total) !== 100) return res.status(400).json({ error: `Weights must sum to 100 (got ${Math.round(total)})` });

    // Build candidate where clause
    const where = {};
    if (candidateIds && candidateIds.length) {
      where.id = { [Op.in]: candidateIds };
    } else {
      where.positionApplying = positionName;
    }

    const candidates = await Candidate.findAll({
      where,
      order: [['submittedAt', 'DESC']],
      limit: 100
    });

    if (!candidates.length) return res.json({ success: true, results: [] });

    const results = [];
    for (const c of candidates) {
      const fit = await analyseSmartFit(c, positionName, config);
      if (fit) {
        // Save to smart_fit_scores (upsert)
        await sequelize.query(
          `INSERT INTO smart_fit_scores (candidateId, positionName, totalScore, breakdown, configSnapshot, analysedAt)
           VALUES (?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE totalScore=VALUES(totalScore), breakdown=VALUES(breakdown),
             configSnapshot=VALUES(configSnapshot), analysedAt=NOW()`,
          { replacements: [c.id, positionName, fit.total, JSON.stringify(fit), JSON.stringify(config)] }
        );
        results.push({ candidateId: c.id, name: c.fullName, status: c.status, location: c.currentLocation, fit });
      } else {
        results.push({ candidateId: c.id, name: c.fullName, status: c.status, location: c.currentLocation, error: 'Analysis failed' });
      }
    }

    // Sort by fit score desc
    results.sort((a, b) => (b.fit?.total || 0) - (a.fit?.total || 0));

    res.json({ success: true, results, positionName });
  } catch (err) {
    console.error('smartFit analyse error:', err);
    res.status(500).json({ error: err.message });
  }
};

// ── load saved scores for a position ─────────────────────────────────────────

exports.getScores = async (req, res) => {
  try {
    const { positionName } = req.query;
    if (!positionName) return res.status(400).json({ error: 'positionName required' });

    const [rows] = await sequelize.query(
      `SELECT s.candidateId, s.totalScore, s.breakdown, s.analysedAt, c.fullName, c.status, c.currentLocation
       FROM smart_fit_scores s
       JOIN candidates c ON c.id = s.candidateId
       WHERE s.positionName = ?
       ORDER BY s.totalScore DESC`,
      { replacements: [positionName] }
    );

    const results = rows.map(r => {
      let fit = null;
      try { fit = JSON.parse(r.breakdown); } catch(e) {}
      return { candidateId: r.candidateId, name: r.fullName, status: r.status, location: r.currentLocation, analysedAt: r.analysedAt, fit };
    });

    res.json({ success: true, results, positionName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
