'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { sequelize } = require('../config/db');
const { Candidate } = require('../models');
const { analyseSmartFit } = require('../utils/smartFitAnalyst');

const NTL_POSITION = 'NEWS TECH LAB- JUNIOR JOURNALIST (20 OPENINGS)- JAIPUR';

async function main() {
  await sequelize.authenticate();
  console.log('DB connected\n');

  // Load Smart Fit config
  const [cfgRows] = await sequelize.query(
    'SELECT config FROM smart_fit_configs WHERE positionName = ?',
    { replacements: [NTL_POSITION] }
  );
  if (!cfgRows.length) {
    console.error('No Smart Fit config saved for NTL position. Open Smart Fit Analyzer and save a config first.');
    process.exit(1);
  }
  const config = JSON.parse(cfgRows[0].config);
  console.log('Smart Fit config loaded.');

  // Fetch all NTL candidates
  const candidates = await Candidate.findAll({
    where: { positionApplying: NTL_POSITION },
    order: [['submittedAt', 'DESC']]
  });
  console.log(`Found ${candidates.length} NTL candidates to re-grade.\n`);

  let done = 0, failed = 0;
  for (const c of candidates) {
    process.stdout.write(`[${done + failed + 1}/${candidates.length}] ${c.fullName} ... `);
    try {
      const fit = await analyseSmartFit(c, NTL_POSITION, config);
      if (!fit) throw new Error('analyseSmartFit returned null');

      const score = fit.total;
      const grade = score >= 75 ? 'A' : score >= 50 ? 'B' : score >= 25 ? 'C' : 'D';

      await c.update({
        grade,
        gradeScore:  score,
        gradeReason: (fit.summary || '').substring(0, 1000),
        gradeSource: 'smart-fit',
        updatedAt:   new Date()
      });

      await sequelize.query(
        `INSERT INTO smart_fit_scores (candidateId, positionName, totalScore, breakdown, configSnapshot, analysedAt)
         VALUES (?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE totalScore=VALUES(totalScore), breakdown=VALUES(breakdown),
           configSnapshot=VALUES(configSnapshot), analysedAt=NOW()`,
        { replacements: [c.id, NTL_POSITION, score, JSON.stringify(fit), JSON.stringify(config)] }
      );

      console.log(`Grade ${grade} (${score}/100)`);
      done++;
    } catch (err) {
      console.log(`FAILED — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Graded: ${done}  Failed: ${failed}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
