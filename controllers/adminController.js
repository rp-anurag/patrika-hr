const { Candidate, Communication, Admin, Position, CandidateDetailForm, ManpowerRequisition, InterviewSheet, ActivityLog } = require('../models');
const { sequelize } = require('../config/db');
const { sendEmail } = require('../utils/emailService');
const { sendWhatsApp } = require('../utils/whatsappService');
const { Op } = require('sequelize');
const XLSX = require('xlsx');
const { computeGrade, computeGradeAsync } = require('../utils/grader');
const path = require('path');
const fs   = require('fs');
const bcrypt = require('bcryptjs');

// ─── AUTH ─────────────────────────────────────────────────────────────────────

exports.showLogin = (req, res) => {
  res.render('admin/login', { title: 'Admin Login – Patrika HR', error: null });
};

exports.processLogin = async (req, res) => {
  const { username, password } = req.body;
  try {
    // .env credentials (simple / no DB required)
    if (username === (process.env.ADMIN_USERNAME || 'admin') &&
        password === (process.env.ADMIN_PASSWORD || 'Patrika@2024')) {
      req.session.adminId   = 'env-admin';
      req.session.adminName = 'Admin';
      const returnTo = req.session.returnTo || '/admin/dashboard';
      delete req.session.returnTo;
      return res.redirect(returnTo);
    }

    // DB admin fallback
    const admin = await Admin.findOne({ where: { username } });
    if (!admin || !(await admin.comparePassword(password))) {
      return res.render('admin/login', {
        title: 'Admin Login – Patrika HR',
        error: 'Invalid username or password'
      });
    }
    req.session.adminId   = admin.id;
    req.session.adminName = admin.name;
    const returnTo = req.session.returnTo || '/admin/dashboard';
    delete req.session.returnTo;
    res.redirect(returnTo);
  } catch (err) {
    console.error(err);
    res.render('admin/login', { title: 'Admin Login', error: 'Server error. Try again.' });
  }
};

exports.logout = (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
};

// ─── DASHBOARD (Overview & Analytics) ────────────────────────────────────────

exports.dashboard = async (req, res) => {
  try {
    const [statusRows, positionRows, todayRows, recentCandidates, recentActivity, totalRow] = await Promise.all([
      sequelize.query(
        `SELECT status, COUNT(*) as count FROM candidates GROUP BY status`,
        { type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT p.name as position, COUNT(c.id) as count FROM positions p LEFT JOIN candidates c ON c.positionApplying COLLATE utf8mb4_general_ci = p.name COLLATE utf8mb4_general_ci WHERE p.isActive = 1 GROUP BY p.name ORDER BY count DESC`,
        { type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT COUNT(*) as count FROM candidates WHERE DATE(submittedAt) = CURDATE()`,
        { type: sequelize.QueryTypes.SELECT }
      ),
      Candidate.findAll({
        order: [['submittedAt', 'DESC']],
        limit: 8,
        attributes: ['id', 'fullName', 'email', 'positionApplying', 'grade', 'status', 'submittedAt']
      }),
      ActivityLog.findAll({
        order: [['createdAt', 'DESC']],
        limit: 8,
        include: [{ model: Candidate, as: 'candidate', attributes: ['fullName', 'id'] }]
      }),
      sequelize.query(
        `SELECT COUNT(*) as count FROM candidates`,
        { type: sequelize.QueryTypes.SELECT }
      )
    ]);

    const statusCounts = {};
    statusRows.forEach(r => { statusCounts[r.status] = parseInt(r.count); });

    const newToday = parseInt(todayRows[0].count) || 0;
    const total    = parseInt(totalRow[0].count)  || 0;

    res.render('admin/dashboard', {
      title:            'Dashboard – Patrika HR',
      adminName:        req.session.adminName,
      statusCounts,
      positionCounts:   positionRows,
      newToday,
      recentCandidates,
      recentActivity,
      total
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error: ' + err.message);
  }
};

// ─── CANDIDATES LIST ──────────────────────────────────────────────────────────

exports.candidatesList = async (req, res) => {
  try {
    const { search, status, position, grade, sort = 'submittedAt', order = 'desc', page = 1, dateFrom, dateTo } = req.query;
    const limit  = 20;
    const offset = (parseInt(page) - 1) * limit;

    // Build where clause
    const where = {};
    if (search) {
      where[Op.or] = [
        { fullName:       { [Op.like]: `%${search}%` } },
        { email:          { [Op.like]: `%${search}%` } },
        { contactNumber:  { [Op.like]: `%${search}%` } }
      ];
    }
    if (status)   where.status           = status;
    if (position) where.positionApplying = position;
    if (grade)    where.grade            = grade;
    if (dateFrom || dateTo) {
      where.submittedAt = {};
      if (dateFrom) where.submittedAt[Op.gte] = new Date(dateFrom);
      if (dateTo)   where.submittedAt[Op.lte] = new Date(dateTo + 'T23:59:59');
    }

    // Validate sort column to prevent SQL injection
    const SAFE_SORT_COLS = ['fullName','email','submittedAt','status','positionApplying','grade'];
    const safeSort  = SAFE_SORT_COLS.includes(sort) ? sort : 'submittedAt';
    const safeOrder = order === 'asc' ? 'ASC' : 'DESC';

    const [{ rows: candidates, count: total }, statusRows, allPositions] = await Promise.all([
      Candidate.findAndCountAll({
        where,
        order: [[safeSort, safeOrder]],
        limit,
        offset,
        attributes: { exclude: ['parsedRawText'] }
      }),
      sequelize.query(
        `SELECT status, COUNT(*) as count FROM candidates GROUP BY status`,
        { type: sequelize.QueryTypes.SELECT }
      ),
      Position.findAll({ order: [['sortOrder','ASC'],['name','ASC']] })
    ]);

    const statusCounts = {};
    statusRows.forEach(r => { statusCounts[r.status] = parseInt(r.count); });

    res.render('admin/candidates', {
      title:      'Candidates – Patrika HR',
      candidates,
      total,
      page:       parseInt(page),
      totalPages: Math.ceil(total / limit),
      query:      req.query,
      statusCounts,
      adminName:  req.session.adminName,
      allPositions
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error: ' + err.message);
  }
};

// ─── CANDIDATE DETAIL ─────────────────────────────────────────────────────────

exports.candidateDetail = async (req, res) => {
  try {
    const [candidate, detailForm] = await Promise.all([
      Candidate.findByPk(req.params.id, {
        include: [{
          model: Communication,
          as:    'communications',
          order: [['sentAt', 'DESC']]
        }]
      }),
      CandidateDetailForm.findOne({ where: { candidateId: req.params.id }, order: [['createdAt','DESC']] })
    ]);
    if (!candidate) return res.status(404).send('Candidate not found');

    res.render('admin/candidate-detail', {
      title:      `${candidate.fullName} – Patrika HR`,
      candidate,
      detailForm: detailForm || null,
      adminName:  req.session.adminName,
      flash:      req.query.flash,
      flashType:  req.query.flashType || 'success'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error: ' + err.message);
  }
};

// ─── UPDATE STATUS / NOTES ────────────────────────────────────────────────────

exports.updateCandidate = async (req, res) => {
  try {
    const { status, adminNotes } = req.body;
    const candidateId = req.params.id;

    // Fetch current values before overwriting
    const current = await Candidate.findByPk(candidateId);
    const oldStatus = current ? current.status : null;
    const oldNotes  = current ? (current.adminNotes || '') : '';

    await Candidate.update(
      { status, adminNotes, updatedAt: new Date() },
      { where: { id: candidateId } }
    );

    // Log status change
    if (current && status && oldStatus !== status) {
      await ActivityLog.create({
        candidateId,
        activityType: 'status_changed',
        title: 'Status updated',
        oldValue: oldStatus,
        newValue: status,
        performedBy: req.session.adminName || 'Admin',
        createdAt: new Date()
      }).catch(e => console.error('ActivityLog status error:', e.message));
    }

    // Log note change
    if (adminNotes && adminNotes.trim() && adminNotes.trim() !== oldNotes.trim()) {
      await ActivityLog.create({
        candidateId,
        activityType: 'note_saved',
        title: 'Admin note saved',
        details: adminNotes.substring(0, 500),
        performedBy: req.session.adminName || 'Admin',
        createdAt: new Date()
      }).catch(e => console.error('ActivityLog note error:', e.message));
    }

    res.redirect(`/admin/candidate/${candidateId}?flash=Updated+successfully`);
  } catch (err) {
    res.redirect(`/admin/candidate/${req.params.id}?flash=Update+failed&flashType=danger`);
  }
};

// ─── SEND COMMUNICATION ───────────────────────────────────────────────────────

exports.sendCommunication = async (req, res) => {
  const { channel, subject, message } = req.body;
  let commStatus = 'Sent';
  try {
    const candidate = await Candidate.findByPk(req.params.id);
    if (!candidate) return res.status(404).json({ success: false, message: 'Candidate not found' });

    if (channel === 'Email') {
      await sendEmail({
        to:      candidate.email,
        subject: subject || 'Message from Patrika HR',
        html:    `<p>${message.replace(/\n/g, '<br>')}</p><br><p>Regards,<br>Patrika HR Team</p>`
      });
    } else if (channel === 'WhatsApp') {
      await sendWhatsApp(candidate.contactNumber, message);
    } else {
      return res.json({ success: false, message: 'Invalid channel' });
    }

    await Communication.create({
      candidateId: candidate.id,
      channel,
      subject: subject || null,
      message,
      sentBy:  req.session.adminName || 'Admin',
      status:  'Sent'
    });

    await ActivityLog.create({
      candidateId: candidate.id,
      activityType: channel === 'Email' ? 'email_sent' : 'whatsapp_sent',
      title: subject || 'Message sent',
      details: message.substring(0, 300),
      performedBy: req.session.adminName || 'Admin',
      createdAt: new Date()
    }).catch(e => console.error('ActivityLog comm error:', e.message));

    res.json({ success: true, message: `${channel} sent successfully` });
  } catch (err) {
    console.error('Communication error:', err);
    // Log as failed
    await Communication.create({
      candidateId: req.params.id,
      channel,
      subject: subject || null,
      message,
      sentBy:  req.session.adminName || 'Admin',
      status:  'Failed'
    }).catch(() => {});

    res.json({ success: false, message: err.message });
  }
};

// ─── DOWNLOAD RESUME ──────────────────────────────────────────────────────────

exports.downloadResume = async (req, res) => {
  try {
    const candidate = await Candidate.findByPk(req.params.id);
    if (!candidate || !candidate.resumeOriginalName) return res.status(404).send('No resume found');
    const filePath = path.resolve(candidate.resumePath);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found on server');
    res.download(filePath, candidate.resumeOriginalName);
  } catch (err) {
    res.status(500).send('Error downloading file');
  }
};

// ─── PREVIEW RESUME ───────────────────────────────────────────────────────────

exports.previewResume = async (req, res) => {
  try {
    const candidate = await Candidate.findByPk(req.params.id);
    if (!candidate || !candidate.resumeOriginalName) {
      return res.status(404).send('<h3>No resume found for this candidate.</h3>');
    }
    const filePath = path.resolve(candidate.resumePath);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('<h3>Resume file not found on server.</h3>');
    }

    const mime = candidate.resumeMimetype;

    // PDF — stream inline so the browser renders it natively
    if (mime === 'application/pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${candidate.resumeOriginalName}"`);
      return fs.createReadStream(filePath).pipe(res);
    }

    // DOCX / DOC — convert to HTML via mammoth and render in browser
    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mime === 'application/msword'
    ) {
      const mammoth = require('mammoth');
      const result  = await mammoth.convertToHtml({ path: filePath });
      const html = `<!DOCTYPE html><html><head>
        <meta charset="UTF-8">
        <title>${candidate.resumeOriginalName}</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 900px; margin: 40px auto; padding: 0 20px; color: #333; line-height: 1.6; }
          h1,h2,h3 { color: #1a1a2e; } table { width:100%; border-collapse:collapse; }
          td,th { border:1px solid #ddd; padding:6px; } img { max-width:100%; }
        </style>
      </head><body>${result.value}</body></html>`;
      res.setHeader('Content-Type', 'text/html');
      return res.send(html);
    }

    // Fallback — force download for unknown types
    res.download(filePath, candidate.resumeOriginalName);
  } catch (err) {
    console.error('Preview error:', err);
    res.status(500).send(`<h3>Preview failed: ${err.message}</h3>`);
  }
};

// ─── DELETE CANDIDATE ────────────────────────────────────────────────────────

exports.deleteCandidate = async (req, res) => {
  try {
    const candidate = await Candidate.findByPk(req.params.id);
    if (!candidate) return res.json({ success: false, message: 'Not found' });
    if (candidate.resumePath) fs.unlink(candidate.resumePath, () => {});
    await Communication.destroy({ where: { candidateId: req.params.id } });
    await candidate.destroy();
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};

// ─── OFFLINE RESUME PARSER PAGE ──────────────────────────────────────────────

exports.showResumeParser = (req, res) => {
  res.render('admin/resume-parser', {
    title:     'Resume Parser – Patrika HR',
    adminName: req.session.adminName
  });
};

exports.parseOfflineResume = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    const { parseResume } = require('../utils/resumeParser');
    const parsed = await parseResume(req.file.buffer, req.file.mimetype);
    res.json({ success: true, data: parsed });
  } catch (err) {
    console.error('Offline parse error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.saveOfflineCandidate = async (req, res) => {
  try {
    const {
      fullName, contactNumber, email, linkedInProfile, currentLocation,
      positionApplying, noticePeriod,
      packageFixed, packageVariables, packageOthers,
      parsedLinkedIn, parsedSummary, parsedTotalExperience, parsedCurrentRole,
      parsedSkills, parsedExperienceEntries, parsedEducation, parsedRawText
    } = req.body;

    const candidateData = {
      fullName:        (fullName || '').trim(),
      contactNumber:   (contactNumber || '').trim(),
      email:           (email || '').trim().toLowerCase(),
      linkedInProfile: (linkedInProfile || '').trim() || null,
      currentLocation: (currentLocation || '').trim(),
      positionApplying,
      noticePeriod,
      packageFixed:     parseFloat(packageFixed)     || 0,
      packageVariables: parseFloat(packageVariables) || 0,
      packageOthers:    parseFloat(packageOthers)    || 0,

      parsedName:              (fullName || '').trim(),
      parsedEmail:             (email || '').trim().toLowerCase(),
      parsedPhone:             (contactNumber || '').trim(),
      parsedLocation:          (currentLocation || '').trim(),
      parsedSkills:            parsedSkills || '[]',
      parsedLinkedIn:          parsedLinkedIn || null,
      parsedSummary:           parsedSummary || null,
      parsedTotalExperience:   parsedTotalExperience || null,
      parsedCurrentRole:       parsedCurrentRole || null,
      parsedExperienceEntries: parsedExperienceEntries || '[]',
      parsedEducation:         parsedEducation || '[]',
      parsedRawText:           parsedRawText || null,

      submittedAt: new Date(),
      updatedAt:   new Date()
    };

    // Save resume file if uploaded
    if (req.file) {
      candidateData.resumeOriginalName = req.file.originalname;
      candidateData.resumeStoredName   = req.file.filename;
      candidateData.resumePath         = req.file.path;
      candidateData.resumeMimetype     = req.file.mimetype;
      candidateData.resumeSize         = req.file.size;
    }

    const candidate = await Candidate.create(candidateData);
    res.json({ success: true, candidateId: candidate.id });
  } catch (err) {
    console.error('Save offline candidate error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── STATS API ────────────────────────────────────────────────────────────────

exports.getStats = async (req, res) => {
  try {
    const [byPosition, byStatus, byNotice, recentCount] = await Promise.all([
      sequelize.query(`SELECT positionApplying AS _id, COUNT(*) AS count FROM candidates GROUP BY positionApplying`, { type: sequelize.QueryTypes.SELECT }),
      sequelize.query(`SELECT status AS _id, COUNT(*) AS count FROM candidates GROUP BY status`,                   { type: sequelize.QueryTypes.SELECT }),
      sequelize.query(`SELECT noticePeriod AS _id, COUNT(*) AS count FROM candidates GROUP BY noticePeriod`,       { type: sequelize.QueryTypes.SELECT }),
      Candidate.count({ where: { submittedAt: { [Op.gte]: new Date(Date.now() - 7*24*60*60*1000) } } })
    ]);
    res.json({ byPosition, byStatus, byNotice, recentCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── EXCEL EXPORT ─────────────────────────────────────────────────────────────

exports.exportCandidates = async (req, res) => {
  try {
    const { search, status, position } = req.query;
    const where = {};
    if (search) {
      where[Op.or] = [
        { fullName:      { [Op.like]: `%${search}%` } },
        { email:         { [Op.like]: `%${search}%` } },
        { contactNumber: { [Op.like]: `%${search}%` } }
      ];
    }
    if (status)   where.status           = status;
    if (position) where.positionApplying = position;

    const candidates = await Candidate.findAll({ where, order: [['submittedAt','DESC']] });

    const rows = candidates.map((c, i) => {
      const pkg = (parseFloat(c.packageFixed)||0) + (parseFloat(c.packageVariables)||0) + (parseFloat(c.packageOthers)||0);
      let skills = '';
      try { const s = c.parsedSkills ? JSON.parse(c.parsedSkills) : []; skills = Array.isArray(s) ? s.join(', ') : s; } catch(e){}
      return {
        '#':               i + 1,
        'Name':            c.fullName,
        'Position':        c.positionApplying,
        'Grade':           c.grade || '—',
        'Grade Score':     c.gradeScore != null ? c.gradeScore : '—',
        'Grade Source':    c.gradeSource || '—',
        'Grade Reason':    c.gradeReason || '',
        'Email':           c.email,
        'Mobile':          c.contactNumber,
        'LinkedIn':        c.linkedInProfile || '',
        'Current Location': c.currentLocation,
        'Parsed Location': c.parsedLocation || '',
        'Notice Period':   c.noticePeriod,
        'Total Package (L)': pkg.toFixed(2),
        'Fixed (L)':       parseFloat(c.packageFixed||0).toFixed(2),
        'Variable (L)':    parseFloat(c.packageVariables||0).toFixed(2),
        'Others (L)':      parseFloat(c.packageOthers||0).toFixed(2),
        'Experience':      c.parsedTotalExperience || '',
        'Current Role':    c.parsedCurrentRole || '',
        'Skills':          skills,
        'Summary':         c.parsedSummary || '',
        'Status':          c.status,
        'Applied On':      c.submittedAt ? new Date(c.submittedAt).toLocaleDateString('en-IN') : '',
        'Why Join Us':     c.whyJoinUs || '',
        'First 90 Days':   c.first90DaysPlan || ''
      };
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto column widths
    const colWidths = Object.keys(rows[0] || {}).map(k => ({ wch: Math.max(k.length, 18) }));
    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const filename = `candidates_${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).send('Export failed: ' + err.message);
  }
};

// ─── GRADING ──────────────────────────────────────────────────────────────────

exports.gradeAll = async (req, res) => {
  try {
    const [candidates, positions] = await Promise.all([
      Candidate.findAll(),
      Position.findAll()
    ]);
    const posMap = {};
    positions.forEach(p => { posMap[p.name] = { jdHtml: p.jdHtml || '', name: p.name }; });

    let updated = 0;
    for (const c of candidates) {
      const pos = posMap[c.positionApplying] || {};
      const result = await computeGradeAsync(c, pos.jdHtml || '', pos.name || c.positionApplying);
      await c.update({
        grade:       result.grade,
        gradeScore:  result.score,
        gradeReason: result.gradeReason,
        gradeSource: result.gradeSource,
        updatedAt:   new Date()
      });
      updated++;
    }
    res.json({ success: true, updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

exports.gradeOne = async (req, res) => {
  try {
    const c = await Candidate.findByPk(req.params.id);
    if (!c) return res.status(404).json({ error: 'Not found' });
    const pos = await Position.findOne({ where: { name: c.positionApplying } });
    const result = await computeGradeAsync(c, pos ? (pos.jdHtml || '') : '', c.positionApplying);
    await c.update({
      grade:       result.grade,
      gradeScore:  result.score,
      gradeReason: result.gradeReason,
      gradeSource: result.gradeSource,
      updatedAt:   new Date()
    });
    res.json({ success: true, grade: result.grade, score: result.score, source: result.gradeSource, reason: result.gradeReason });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── POSITIONS MANAGEMENT ─────────────────────────────────────────────────────

exports.listPositions = async (req, res) => {
  try {
    const positions = await Position.findAll({ order: [['sortOrder','ASC'],['name','ASC']] });
    res.render('admin/positions', {
      title: 'Manage Positions – Patrika HR',
      adminName: req.session.adminName,
      positions,
      v: res.locals.v
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

exports.createPosition = async (req, res) => {
  try {
    const { name, department, icon, badge, jdHtml, sortOrder } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });
    const pos = await Position.create({
      name: name.trim(), department: (department||'').trim(),
      icon: (icon||'briefcase').trim(), badge: (badge||'').trim(),
      jdHtml: (jdHtml||'').trim(), isActive: true,
      sortOrder: parseInt(sortOrder)||0
    });
    res.json({ success: true, position: pos });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'A position with this name already exists' });
    res.status(500).json({ error: err.message });
  }
};

exports.updatePosition = async (req, res) => {
  try {
    const pos = await Position.findByPk(req.params.id);
    if (!pos) return res.status(404).json({ error: 'Position not found' });
    const { name, department, icon, badge, jdHtml, sortOrder } = req.body;
    await pos.update({
      name: (name||pos.name).trim(),
      department: (department !== undefined ? department : pos.department).trim(),
      icon: (icon || pos.icon).trim(),
      badge: (badge !== undefined ? badge : pos.badge).trim(),
      jdHtml: (jdHtml !== undefined ? jdHtml : pos.jdHtml),
      sortOrder: sortOrder !== undefined ? parseInt(sortOrder)||0 : pos.sortOrder,
      updatedAt: new Date()
    });
    res.json({ success: true, position: pos });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError')
      return res.status(400).json({ error: 'A position with this name already exists' });
    res.status(500).json({ error: err.message });
  }
};

exports.togglePosition = async (req, res) => {
  try {
    const pos = await Position.findByPk(req.params.id);
    if (!pos) return res.status(404).json({ error: 'Position not found' });
    await pos.update({ isActive: !pos.isActive, updatedAt: new Date() });
    res.json({ success: true, isActive: pos.isActive });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deletePosition = async (req, res) => {
  try {
    const pos = await Position.findByPk(req.params.id);
    if (!pos) return res.status(404).json({ error: 'Position not found' });
    await pos.destroy();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
