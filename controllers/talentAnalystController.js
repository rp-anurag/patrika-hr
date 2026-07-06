const { Candidate, Position } = require('../models');
const { analyseCandidate, reportToGrade } = require('../utils/talentAnalyst');

exports.showPage = async (req, res) => {
  try {
    const isSuperAdmin = req.session.adminRole === 'admin';
    const dept = req.session.adminDepartment;
    const [candidates, positions] = await Promise.all([
      Candidate.findAll({
        where: !isSuperAdmin && dept ? { positionApplying: { [require('sequelize').Op.in]: require('sequelize').literal(`(SELECT name COLLATE utf8mb4_unicode_ci FROM positions WHERE department = ${require('../config/db').sequelize.escape(dept)})`) } } : {},
        attributes: ['id','fullName','positionApplying','status','grade'],
        order: [['submittedAt','DESC']]
      }),
      Position.findAll({
        where: { isActive: true, ...(!isSuperAdmin && dept ? { department: dept } : {}) },
        attributes: ['id','name','department','jdHtml'],
        order: [['sortOrder','ASC'],['name','ASC']]
      })
    ]);
    res.render('admin/talent-analyst', {
      title:           'AI Talent Analyst',
      adminName:       req.session.adminName || 'Admin',
      adminRole:       req.session.adminRole,
      adminDepartment: req.session.adminDepartment,
      candidates,
      positions,
      v: res.locals.v
    });
  } catch (err) {
    console.error('talent-analyst showPage error:', err);
    res.status(500).send('<h2>Error</h2><pre>' + err.message + '</pre>');
  }
};

exports.analyse = async (req, res) => {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) return res.status(400).json({ success: false, error: 'GROQ_API_KEY not configured' });

    const { candidateIds, jd, roleName, customRubric } = req.body;

    if (!candidateIds || !candidateIds.length) {
      return res.status(400).json({ success: false, error: 'No candidates selected' });
    }

    const ids = Array.isArray(candidateIds) ? candidateIds : [candidateIds];
    const candidates = await Candidate.findAll({ where: { id: ids } });
    if (!candidates.length) return res.status(404).json({ success: false, error: 'Candidates not found' });

    const results = [];

    for (const c of candidates) {
      const report = await analyseCandidate(c, jd || '', roleName || c.positionApplying, customRubric);

      if (report && report.tier) {
        // Persist the report + derived grade so it shows in the Candidates tab
        const g = reportToGrade(report);
        await c.update({
          grade:         g.grade,
          gradeScore:    g.score,
          gradeReason:   g.gradeReason,
          gradeSource:   g.gradeSource,
          analystReport: JSON.stringify(report),
          updatedAt:     new Date()
        }).catch(e => console.error('Analyst save error:', e.message));

        results.push({
          candidateId:   c.id,
          candidateName: c.fullName,
          position:      c.positionApplying,
          currentGrade:  g.grade,
          report
        });
      } else {
        results.push({
          candidateId:   c.id,
          candidateName: c.fullName,
          position:      c.positionApplying,
          error:         'Analysis failed — check GROQ API key / connectivity'
        });
      }
    }

    res.json({ success: true, results, roleName: roleName || '' });
  } catch (err) {
    console.error('talent-analyst analyse error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
