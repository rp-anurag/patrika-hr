const { Candidate, Communication, Admin, Position, Department, CandidateDetailForm, ManpowerRequisition, InterviewSheet, ActivityLog } = require('../models');
const { sequelize } = require('../config/db');
const { sendEmail } = require('../utils/emailService');
const { sendWhatsApp } = require('../utils/whatsappService');
const { Op } = require('sequelize');
const XLSX = require('xlsx');
const { computeGrade, computeGradeAsync } = require('../utils/grader');
const path = require('path');
const fs   = require('fs');
const bcrypt = require('bcryptjs');
const { resolveResumePath } = require('../utils/resumePath');

// ─── AUTH ─────────────────────────────────────────────────────────────────────

exports.showLogin = (req, res) => {
  res.render('admin/login', { title: 'Admin Login – Patrika HR', error: null });
};

exports.processLogin = async (req, res) => {
  const { username, password } = req.body;
  try {
    // .env credentials (simple / no DB required) — always super-admin
    if (username === (process.env.ADMIN_USERNAME || 'admin') &&
        password === (process.env.ADMIN_PASSWORD || 'Patrika@2024')) {
      req.session.adminId         = 'env-admin';
      req.session.adminName       = 'Admin';
      req.session.adminRole       = 'admin';
      req.session.adminDepartment = null;
      const returnTo = req.session.returnTo || '/admin/dashboard';
      delete req.session.returnTo;
      return res.redirect(returnTo);
    }

    // DB admin/user fallback
    const admin = await Admin.findOne({ where: { username } });
    if (!admin || !(await admin.comparePassword(password))) {
      return res.render('admin/login', {
        title: 'Admin Login – Patrika HR',
        error: 'Invalid username or password'
      });
    }
    req.session.adminId          = admin.id;
    req.session.adminName        = admin.name;
    req.session.adminRole        = admin.role || 'admin';
    const depts = admin.department;
    req.session.adminDepartments = Array.isArray(depts) ? depts : [];
    req.session.adminDepartment  = req.session.adminDepartments[0] || null;
    const posns = admin.positions;
    req.session.adminPositions   = Array.isArray(posns) ? posns : [];
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
    const isSuperAdmin = req.session.adminRole === 'admin';
    const depts = req.session.adminDepartments || (req.session.adminDepartment ? [req.session.adminDepartment] : []);
    const posns       = req.session.adminPositions || [];
    const inclNull    = posns.includes('__NULL__');
    const isInverse   = posns.includes('__INVERSE__');
    const realPosns   = posns.filter(p => p !== '__NULL__' && p !== '__INVERSE__');
    const hasPosFilter  = !isSuperAdmin && posns.length > 0;
    const hasDeptFilter = !isSuperAdmin && !hasPosFilter && depts.length > 0;
    const hasFilter     = hasDeptFilter || hasPosFilter;

    const deptsEsc  = depts.map(d => sequelize.escape(d)).join(',');
    const posnsEsc  = realPosns.map(p => sequelize.escape(p)).join(',');
    // __INVERSE__ = exclude realPosns; __NULL__ = also include null-position rows
    const nullClause  = (inclNull || isInverse) ? ` OR c.positionApplying IS NULL OR c.positionApplying = ''` : '';
    const nullClauseS = (inclNull || isInverse) ? ` OR positionApplying IS NULL OR positionApplying = ''` : '';
    const inOp  = isInverse ? 'NOT IN' : 'IN';

    const deptFilter = hasDeptFilter ? `AND p.department IN (${deptsEsc})` : '';
    const candFilter = hasPosFilter
      ? `WHERE (c.positionApplying COLLATE utf8mb4_unicode_ci ${inOp} (${posnsEsc || "''"})${nullClause})`
      : hasDeptFilter
        ? `WHERE c.positionApplying COLLATE utf8mb4_unicode_ci IN (SELECT name COLLATE utf8mb4_unicode_ci FROM positions WHERE department IN (${deptsEsc}))`
        : '';
    const candFilterStatus = hasPosFilter
      ? `WHERE (positionApplying COLLATE utf8mb4_unicode_ci ${inOp} (${posnsEsc || "''"})${nullClauseS})`
      : hasDeptFilter
        ? `WHERE positionApplying COLLATE utf8mb4_unicode_ci IN (SELECT name COLLATE utf8mb4_unicode_ci FROM positions WHERE department IN (${deptsEsc}))`
        : '';

    // ORM where clause for position-scoped users
    const posOrmWhere = isInverse
      ? (inclNull
          ? { [Op.or]: [{ positionApplying: { [Op.notIn]: realPosns } }, { positionApplying: null }, { positionApplying: '' }] }
          : { positionApplying: { [Op.notIn]: realPosns } })
      : (inclNull
          ? { [Op.or]: [{ positionApplying: { [Op.in]: realPosns } }, { positionApplying: null }, { positionApplying: '' }] }
          : { positionApplying: { [Op.in]: realPosns } });

    const [statusRows, positionRows, todayRows, recentCandidates, recentActivity, totalRow] = await Promise.all([
      sequelize.query(
        `SELECT status, COUNT(*) as count FROM candidates ${candFilterStatus} GROUP BY status`,
        { type: sequelize.QueryTypes.SELECT }
      ),
      hasPosFilter
        ? sequelize.query(
            `SELECT positionApplying as position, COUNT(*) as count FROM candidates
             ${candFilterStatus ? candFilterStatus + ' AND' : 'WHERE'}
             positionApplying IS NOT NULL AND positionApplying != ''
             GROUP BY positionApplying ORDER BY count DESC`,
            { type: sequelize.QueryTypes.SELECT }
          )
        : sequelize.query(
            `SELECT p.name as position, COUNT(c.id) as count FROM positions p LEFT JOIN candidates c ON c.positionApplying COLLATE utf8mb4_general_ci = p.name COLLATE utf8mb4_general_ci WHERE p.isActive = 1 ${deptFilter} GROUP BY p.name ORDER BY count DESC`,
            { type: sequelize.QueryTypes.SELECT }
          ),
      sequelize.query(
        `SELECT COUNT(*) as count FROM candidates ${candFilterStatus ? candFilterStatus + ' AND DATE(submittedAt) = CURDATE()' : 'WHERE DATE(submittedAt) = CURDATE()'}`,
        { type: sequelize.QueryTypes.SELECT }
      ),
      Candidate.findAll({
        where: hasPosFilter
          ? posOrmWhere
          : hasDeptFilter
            ? { positionApplying: { [Op.in]: sequelize.literal(`(SELECT name COLLATE utf8mb4_unicode_ci FROM positions WHERE department IN (${deptsEsc}))`) } }
            : {},
        order: [['submittedAt', 'DESC']],
        limit: 8,
        attributes: ['id', 'fullName', 'email', 'positionApplying', 'grade', 'status', 'submittedAt']
      }),
      ActivityLog.findAll({
        order: [['createdAt', 'DESC']],
        limit: 8,
        include: [{
          model: Candidate,
          as: 'candidate',
          attributes: ['fullName', 'id'],
          ...(hasPosFilter ? {
            where: posOrmWhere,
            required: true
          } : hasDeptFilter ? {
            where: { positionApplying: { [Op.in]: sequelize.literal(`(SELECT name COLLATE utf8mb4_unicode_ci FROM positions WHERE department IN (${deptsEsc}))`) } },
            required: true
          } : { required: false })
        }]
      }),
      sequelize.query(
        `SELECT COUNT(*) as count FROM candidates ${candFilterStatus}`,
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
      adminRole:        req.session.adminRole,
      adminDepartment:  req.session.adminDepartment,
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

    const isSuperAdmin = req.session.adminRole === 'admin';
    const depts       = req.session.adminDepartments || (req.session.adminDepartment ? [req.session.adminDepartment] : []);
    const posns       = req.session.adminPositions || [];
    const inclNull    = posns.includes('__NULL__');
    const isInverse   = posns.includes('__INVERSE__');
    const realPosns   = posns.filter(p => p !== '__NULL__' && p !== '__INVERSE__');
    const hasPosFilter  = !isSuperAdmin && posns.length > 0;
    const hasDeptFilter = !isSuperAdmin && !hasPosFilter && depts.length > 0;
    const hasFilter     = hasDeptFilter || hasPosFilter;
    const deptsEsc  = depts.map(d => sequelize.escape(d)).join(',');
    const posnsEsc  = realPosns.map(p => sequelize.escape(p)).join(',');
    const nullClauseS = (inclNull || isInverse) ? ` OR positionApplying IS NULL OR positionApplying = ''` : '';
    const inOp = isInverse ? 'NOT IN' : 'IN';

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
    // Scope restriction for non-super-admin users
    if (hasPosFilter && !position) {
      const nullParts = (inclNull || isInverse) ? [{ positionApplying: null }, { positionApplying: '' }] : [];
      if (isInverse) {
        where[Op.or] = [{ positionApplying: { [Op.notIn]: realPosns } }, ...nullParts];
      } else {
        where[Op.or] = [{ positionApplying: { [Op.in]: realPosns } }, ...nullParts];
      }
    } else if (hasDeptFilter && !position) {
      where.positionApplying = { [Op.in]: sequelize.literal(`(SELECT name COLLATE utf8mb4_unicode_ci FROM positions WHERE department IN (${deptsEsc}))`) };
    }

    // Validate sort column to prevent SQL injection
    const SAFE_SORT_COLS = ['fullName','email','submittedAt','status','positionApplying','grade'];
    const safeSort  = SAFE_SORT_COLS.includes(sort) ? sort : 'submittedAt';
    const safeOrder = order === 'asc' ? 'ASC' : 'DESC';

    const scopeStatusFilter = hasPosFilter
      ? `WHERE (positionApplying COLLATE utf8mb4_unicode_ci ${inOp} (${posnsEsc || "''"})${nullClauseS})`
      : hasDeptFilter
        ? `WHERE positionApplying COLLATE utf8mb4_unicode_ci IN (SELECT name COLLATE utf8mb4_unicode_ci FROM positions WHERE department IN (${deptsEsc}))`
        : '';

    const [{ rows: candidates, count: total }, statusRows, allPositions] = await Promise.all([
      Candidate.findAndCountAll({
        where,
        order: [[safeSort, safeOrder]],
        limit,
        offset,
        attributes: { exclude: ['parsedRawText'] }
      }),
      sequelize.query(
        `SELECT status, COUNT(*) as count FROM candidates ${scopeStatusFilter} GROUP BY status`,
        { type: sequelize.QueryTypes.SELECT }
      ),
      sequelize.query(
        `SELECT DISTINCT positionApplying as name FROM candidates
         ${scopeStatusFilter ? scopeStatusFilter + ' AND' : 'WHERE'}
         positionApplying IS NOT NULL AND positionApplying != ''
         ORDER BY positionApplying ASC`,
        { type: sequelize.QueryTypes.SELECT }
      )
    ]);

    const statusCounts = {};
    statusRows.forEach(r => { statusCounts[r.status] = parseInt(r.count); });

    // Positions that have a saved Smart Fit config (for the Smart Fit Grade All button)
    const [sfCfgRows] = await sequelize.query('SELECT positionName FROM smart_fit_configs');
    const smartFitPositions = sfCfgRows.map(r => r.positionName);

    res.render('admin/candidates', {
      title:           'Candidates – Patrika HR',
      candidates,
      total,
      page:            parseInt(page),
      totalPages:      Math.ceil(total / limit),
      query:           req.query,
      statusCounts,
      adminName:       req.session.adminName,
      adminRole:       req.session.adminRole,
      adminDepartment: req.session.adminDepartment,
      allPositions,
      smartFitPositions
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error: ' + err.message);
  }
};

// ─── CANDIDATE DETAIL ─────────────────────────────────────────────────────────

exports.candidateDetail = async (req, res) => {
  try {
    const [candidate, detailForm, positionRows] = await Promise.all([
      Candidate.findByPk(req.params.id, {
        include: [{
          model: Communication,
          as:    'communications',
          order: [['sentAt', 'DESC']]
        }]
      }),
      CandidateDetailForm.findOne({ where: { candidateId: req.params.id }, order: [['createdAt','DESC']] }),
      Position.findAll({ where: { isActive: true }, order: [['sortOrder','ASC'],['name','ASC']] })
    ]);
    if (!candidate) return res.status(404).send('Candidate not found');

    res.render('admin/candidate-detail', {
      title:           `${candidate.fullName} – Patrika HR`,
      candidate,
      detailForm:      detailForm || null,
      positions:       positionRows,
      adminName:       req.session.adminName,
      adminRole:       req.session.adminRole,
      adminDepartment: req.session.adminDepartment,
      flash:           req.query.flash,
      flashType:       req.query.flashType || 'success'
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error: ' + err.message);
  }
};

// ─── UPDATE STATUS / NOTES ────────────────────────────────────────────────────

exports.updateCandidate = async (req, res) => {
  try {
    const { status, adminNotes, positionApplying } = req.body;
    const candidateId = req.params.id;

    // Fetch current values before overwriting
    const current = await Candidate.findByPk(candidateId);
    const oldStatus = current ? current.status : null;
    const oldNotes  = current ? (current.adminNotes || '') : '';

    const updateFields = { status, adminNotes, updatedAt: new Date() };
    if (positionApplying !== undefined) updateFields.positionApplying = positionApplying;

    await Candidate.update(
      updateFields,
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

    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
      return res.json({ success: true });
    }
    res.redirect(`/admin/candidate/${candidateId}?flash=Updated+successfully`);
  } catch (err) {
    if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
      return res.status(500).json({ success: false, error: err.message });
    }
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

// ─── BULK MESSAGE (common message to many candidates, e.g. all Shortlisted) ──

exports.bulkMessage = async (req, res) => {
  try {
    let { candidateIds, status, channel, subject, message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }
    if (!['Email', 'WhatsApp'].includes(channel)) {
      return res.status(400).json({ success: false, message: 'Invalid channel' });
    }

    // Target: explicit candidate IDs, or all candidates with a given status.
    // Department users are limited to candidates in their own departments.
    const bulkDeptScope = require('../utils/deptScope').deptWhere(req);
    let candidates = [];
    if (Array.isArray(candidateIds) && candidateIds.length) {
      candidates = await Candidate.findAll({ where: { id: candidateIds, ...(bulkDeptScope || {}) } });
    } else if (status) {
      candidates = await Candidate.findAll({ where: { status, ...(bulkDeptScope || {}) } });
    }
    if (!candidates.length) {
      return res.status(404).json({ success: false, message: 'No candidates found for the selected target' });
    }

    const sender = req.session.adminName || 'Admin';
    let sent = 0, failed = 0;
    const failures = [];

    for (const c of candidates) {
      // Personalise placeholders
      const msg  = message.replace(/{{\s*name\s*}}/gi, c.fullName).replace(/{{\s*position\s*}}/gi, c.positionApplying || '');
      const subj = (subject || 'Message from Patrika HR').replace(/{{\s*name\s*}}/gi, c.fullName).replace(/{{\s*position\s*}}/gi, c.positionApplying || '');

      try {
        if (channel === 'Email') {
          if (!c.email) throw new Error('No email address');
          await sendEmail({
            to: c.email,
            subject: subj,
            html: `<p>${msg.replace(/\n/g, '<br>')}</p><br><p>Regards,<br>Patrika HR Team</p>`
          });
        } else {
          if (!c.contactNumber) throw new Error('No contact number');
          await sendWhatsApp(c.contactNumber, msg);
        }

        await Communication.create({
          candidateId: c.id, channel, subject: subj, message: msg,
          sentBy: sender, status: 'Sent'
        }).catch(() => {});
        await ActivityLog.create({
          candidateId: c.id,
          activityType: channel === 'Email' ? 'email_sent' : 'whatsapp_sent',
          title: `Bulk: ${subj}`,
          details: msg.substring(0, 300),
          performedBy: sender,
          createdAt: new Date()
        }).catch(() => {});
        sent++;
      } catch (err) {
        failed++;
        failures.push(`${c.fullName}: ${err.message}`);
        await Communication.create({
          candidateId: c.id, channel, subject: subj, message: msg,
          sentBy: sender, status: 'Failed'
        }).catch(() => {});
      }
    }

    res.json({ success: true, sent, failed, total: candidates.length, failures: failures.slice(0, 10) });
  } catch (err) {
    console.error('bulkMessage error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ─── NEWS TECH LAB — SEND INTERVIEW + GD INVITE ──────────────────────────────

const NTL_POSITION = 'NEWS TECH LAB- JUNIOR JOURNALIST (20 OPENINGS)- JAIPUR';

exports.sendNTLInvite = async (req, res) => {
  try {
    const candidate = await Candidate.findByPk(req.params.id);
    if (!candidate) return res.status(404).json({ success: false, message: 'Candidate not found' });
    if (candidate.positionApplying !== NTL_POSITION)
      return res.status(400).json({ success: false, message: 'Not a News Tech Lab candidate' });

    const { interviewDate, interviewSlot, interviewLink, gdLink, saveOnly } = req.body;
    const isSaveOnly = saveOnly || req.query.saveOnly;

    // Save to candidate record
    await candidate.update({
      ntlInterviewDate: interviewDate !== undefined ? interviewDate : candidate.ntlInterviewDate,
      ntlInterviewSlot: interviewSlot !== undefined ? interviewSlot : candidate.ntlInterviewSlot,
      ntlInterviewLink: interviewLink !== undefined ? interviewLink : candidate.ntlInterviewLink,
      ntlGDLink:        gdLink        !== undefined ? gdLink        : candidate.ntlGDLink,
      ...(isSaveOnly ? {} : { ntlInviteSentAt: new Date() })
    });

    if (isSaveOnly) return res.json({ success: true, message: 'Saved' });

    if (!interviewLink && !gdLink && !candidate.ntlInterviewLink && !candidate.ntlGDLink)
      return res.status(400).json({ success: false, message: 'Provide at least one link before sending' });

    // Build email HTML
    const rows = [];
    if (interviewDate) rows.push(`<tr><td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap">Date &amp; Time</td><td style="padding:6px 12px">${interviewDate}</td></tr>`);
    if (interviewSlot) rows.push(`<tr><td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap">Slot</td><td style="padding:6px 12px">${interviewSlot}</td></tr>`);
    if (interviewLink) rows.push(`<tr><td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap">Interview Link</td><td style="padding:6px 12px"><a href="${interviewLink}" style="color:#c8a84b">${interviewLink}</a></td></tr>`);
    if (gdLink)        rows.push(`<tr><td style="padding:6px 12px;font-weight:600;color:#555;white-space:nowrap">GD Sheet Link</td><td style="padding:6px 12px"><a href="${gdLink}" style="color:#c8a84b">${gdLink}</a></td></tr>`);

    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#1a1a2e;padding:20px 30px">
    <h2 style="color:#c8a84b;margin:0">Patrika Group</h2>
    <p style="color:#aaa;margin:4px 0 0">News Tech Lab — Junior Journalist</p>
  </div>
  <div style="padding:24px 30px;border:1px solid #e5e5e5;border-top:none">
    <p style="font-size:15px">Dear <strong>${candidate.fullName}</strong>,</p>
    <p>We are pleased to invite you for the selection process for the position of <strong>Junior Journalist – News Tech Lab</strong> at Patrika Group.</p>
    <p>Please find your interview and group discussion details below:</p>
    <table style="border-collapse:collapse;width:100%;margin:16px 0;background:#f9f9f9;border-radius:6px;overflow:hidden">
      ${rows.join('')}
    </table>
    <p>Please ensure you join on time and keep this email handy for reference.</p>
    <p style="margin-top:24px">Best regards,<br><strong>HR Team</strong><br>Patrika Group</p>
  </div>
</div>`;

    await sendEmail({ to: candidate.email, subject: 'Interview Invitation – News Tech Lab, Patrika Group', html });

    await Communication.create({
      candidateId: candidate.id,
      channel: 'Email',
      subject: 'Interview Invitation – News Tech Lab, Patrika Group',
      message: `Interview Date: ${interviewDate || '—'} | Slot: ${interviewSlot || '—'} | Interview Link: ${interviewLink || '—'} | GD Link: ${gdLink || '—'}`,
      sentBy: req.session.adminName || 'Admin',
      status: 'Sent'
    });

    await ActivityLog.create({
      candidateId: candidate.id,
      activityType: 'email_sent',
      description: 'NTL interview + GD invite sent',
      performedBy: req.session.adminName || 'Admin'
    });

    res.json({ success: true, message: 'Invite sent and saved' });
  } catch (err) {
    console.error('sendNTLInvite error:', err);
    res.json({ success: false, message: err.message });
  }
};

// ─── DOWNLOAD RESUME ──────────────────────────────────────────────────────────

exports.downloadResume = async (req, res) => {
  try {
    const candidate = await Candidate.findByPk(req.params.id);
    if (!candidate || !candidate.resumeOriginalName) return res.status(404).send('No resume found');
    const filePath = resolveResumePath(candidate);
    if (!filePath) return res.status(404).send('File not found on server');
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
    const filePath = resolveResumePath(candidate);
    if (!filePath) {
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

exports.showResumeParser = async (req, res) => {
  const positions = await Position.findAll({
    where: { isActive: true },
    order: [['sortOrder','ASC'],['name','ASC']]
  });
  res.render('admin/resume-parser', {
    title:           'Resume Parser – Patrika HR',
    adminName:       req.session.adminName,
    adminRole:       req.session.adminRole,
    adminDepartment: req.session.adminDepartment,
    positions
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
    const isSuperAdmin = req.session.adminRole === 'admin';
    const depts      = req.session.adminDepartments || (req.session.adminDepartment ? [req.session.adminDepartment] : []);
    const posns      = req.session.adminPositions || [];
    const inclNull   = posns.includes('__NULL__');
    const isInverse  = posns.includes('__INVERSE__');
    const realPosns  = posns.filter(p => p !== '__NULL__' && p !== '__INVERSE__');
    const hasPosFilter  = !isSuperAdmin && posns.length > 0;
    const hasDeptFilter = !isSuperAdmin && !hasPosFilter && depts.length > 0;
    const deptsEsc = depts.map(d => sequelize.escape(d)).join(',');

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

    // Apply position/department scope
    if (hasPosFilter && !position) {
      const nullParts = (inclNull || isInverse) ? [{ positionApplying: null }, { positionApplying: '' }] : [];
      if (isInverse) {
        where[Op.or] = [{ positionApplying: { [Op.notIn]: realPosns } }, ...nullParts];
      } else {
        where[Op.or] = [{ positionApplying: { [Op.in]: realPosns } }, ...nullParts];
      }
    } else if (hasDeptFilter && !position) {
      where.positionApplying = { [Op.in]: sequelize.literal(`(SELECT name COLLATE utf8mb4_unicode_ci FROM positions WHERE department IN (${deptsEsc}))`) };
    }

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
    const gradeDeptScope = require('../utils/deptScope').deptWhere(req);
    const [candidates, positions] = await Promise.all([
      Candidate.findAll({ where: gradeDeptScope || {} }),
      Position.findAll()
    ]);
    const posMap = {};
    positions.forEach(p => { posMap[p.name] = { jdHtml: p.jdHtml || '', name: p.name }; });

    let updated = 0;
    for (const c of candidates) {
      // NTL position is graded via Smart Fit Grade All button — skip here
      if (c.positionApplying === NTL_POSITION) continue;
      const pos = posMap[c.positionApplying] || {};
      const result = await computeGradeAsync(c, pos.jdHtml || '', pos.name || c.positionApplying);
      await c.update({
        grade:         result.grade,
        gradeScore:    result.score,
        gradeReason:   result.gradeReason,
        gradeSource:   result.gradeSource,
        analystReport: result.analystReport || c.analystReport,
        updatedAt:     new Date()
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
  console.log('[gradeOne] called for candidate id:', req.params.id, '| session:', req.session && req.session.adminId ? 'OK' : 'NO SESSION');
  try {
    const c = await Candidate.findByPk(req.params.id);
    if (!c) { console.log('[gradeOne] candidate not found'); return res.status(404).json({ error: 'Not found' }); }
    console.log('[gradeOne] candidate:', c.fullName, '| position:', c.positionApplying);

    // Report is locked once set — never overwrite unless explicitly cleared from DB
    if (c.analystReport) {
      console.log('[gradeOne] report already exists — returning cached (locked)');
      let cached;
      try { cached = JSON.parse(c.analystReport); } catch(e) { cached = null; }
      if (cached && cached.tier) return res.json({ success: true, cached: true, report: cached });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) { console.log('[gradeOne] no API key'); return res.status(400).json({ success: false, error: 'GROQ_API_KEY not configured' }); }

    const pos = await Position.findOne({ where: { name: c.positionApplying } });
    const jdHtml = pos ? (pos.jdHtml || '') : '';
    console.log('[gradeOne] position found:', pos ? pos.name : 'NONE');

    // If the stored resume text is empty (e.g. scanned PDF parsed before OCR
    // support), re-parse the file with the OCR fallback before analysing.
    const rawLen = (c.parsedRawText || '').replace(/\s/g, '').length;
    if (rawLen < 100) {
      const { resolveResumePath } = require('../utils/resumePath');
      const filePath = resolveResumePath(c);
      if (filePath) {
        console.log('[gradeOne] empty resume text — re-parsing with OCR fallback...');
        try {
          const { parseResume } = require('../utils/resumeParser');
          const parsed = await parseResume(filePath, c.resumeMimetype);
          if ((parsed.rawText || '').replace(/\s/g, '').length >= 100) {
            await c.update({
              parsedSummary:           parsed.summary || c.parsedSummary,
              parsedTotalExperience:   parsed.totalExperience || c.parsedTotalExperience,
              parsedCurrentRole:       parsed.currentRole || c.parsedCurrentRole,
              parsedExperienceEntries: JSON.stringify(parsed.experienceEntries || []),
              parsedEducation:         JSON.stringify(parsed.education || []),
              parsedSkills:            JSON.stringify(parsed.skills || []),
              parsedRawText:           parsed.rawText
            });
            await c.reload();
            console.log('[gradeOne] re-parse OK — rawText now', parsed.rawText.length, 'chars');
          }
        } catch (e) {
          console.warn('[gradeOne] re-parse failed:', e.message);
        }
      } else {
        console.log('[gradeOne] resume file not on this machine — skipping re-parse');
      }
    }

    // NTL position uses Smart Fit Analyzer instead of Talent Analyst
    if (c.positionApplying === NTL_POSITION) {
      console.log('[gradeOne] NTL position — routing to Smart Fit Analyzer');
      const { analyseSmartFit } = require('../utils/smartFitAnalyst');
      const { sequelize }       = require('../config/db');
      const [cfgRows] = await sequelize.query(
        'SELECT config FROM smart_fit_configs WHERE positionName = ?',
        { replacements: [NTL_POSITION] }
      );
      if (!cfgRows.length) {
        return res.status(400).json({ success: false, error: 'No Smart Fit config saved for NTL position. Open Smart Fit Analyzer and save a configuration first.' });
      }
      const config = JSON.parse(cfgRows[0].config);
      const fit = await analyseSmartFit(c, NTL_POSITION, config);
      if (!fit) {
        return res.status(500).json({ success: false, error: 'Smart Fit Analyzer returned no result — check GROQ API key / connectivity' });
      }
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
      console.log('[gradeOne] NTL smart-fit grade:', grade, 'score:', score);
      return res.json({ success: true, grade, score, source: 'smart-fit' });
    }

    const { analyseCandidate, reportToGrade, ntlCustomRubric } = require('../utils/talentAnalyst');
    console.log('[gradeOne] calling analyseCandidate...');
    const report = await analyseCandidate(c, jdHtml, c.positionApplying, undefined);
    if (!report || !report.tier) {
      console.log('[gradeOne] analyseCandidate returned null');
      return res.status(500).json({ success: false, error: 'Talent Analyst returned no result — check GROQ API key / connectivity' });
    }
    console.log('[gradeOne] report tier:', report.tier, 'score:', report.weightedTotal);

    const g = reportToGrade(report);
    await c.update({
      grade:         g.grade,
      gradeScore:    g.score,
      gradeReason:   g.gradeReason,
      gradeSource:   g.gradeSource,
      analystReport: JSON.stringify(report),
      updatedAt:     new Date()
    });
    console.log('[gradeOne] saved grade:', g.grade, 'gradeSource:', g.gradeSource);
    res.json({ success: true, grade: g.grade, score: g.score, source: g.gradeSource });
  } catch (err) {
    console.error('[gradeOne] ERROR:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
};

// ─── POSITIONS MANAGEMENT ─────────────────────────────────────────────────────

exports.listPositions = async (req, res) => {
  try {
    const [positions, deptRows] = await Promise.all([
      Position.findAll({ order: [['sortOrder','ASC'],['name','ASC']] }),
      Department.findAll({ order: [['name','ASC']] })
    ]);
    res.render('admin/positions', {
      title:           'Manage Positions – Patrika HR',
      adminName:       req.session.adminName,
      adminRole:       req.session.adminRole,
      adminDepartment: req.session.adminDepartment,
      positions,
      departments:     deptRows.map(d => d.name),
      departmentObjs:  deptRows.map(d => ({ id: d.id, name: d.name })),
      v: res.locals.v
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error');
  }
};

// ─── DEPARTMENT MANAGEMENT ────────────────────────────────────────────────────

exports.createDepartment = async (req, res) => {
  try {
    const name = (req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Department name is required' });
    const [dept, created] = await Department.findOrCreate({ where: { name } });
    if (!created) return res.status(409).json({ error: 'Department already exists' });
    res.json({ success: true, department: { id: dept.id, name: dept.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.deleteDepartment = async (req, res) => {
  try {
    const dept = await Department.findByPk(req.params.id);
    if (!dept) return res.status(404).json({ error: 'Not found' });
    await dept.destroy();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
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
    const oldName = pos.name;
    const newName = (name || pos.name).trim();
    await pos.update({
      name: newName,
      department: (department !== undefined ? department : pos.department).trim(),
      icon: (icon || pos.icon).trim(),
      badge: (badge !== undefined ? badge : pos.badge).trim(),
      jdHtml: (jdHtml !== undefined ? jdHtml : pos.jdHtml),
      sortOrder: sortOrder !== undefined ? parseInt(sortOrder)||0 : pos.sortOrder,
      updatedAt: new Date()
    });
    // Cascade rename to all candidates that had the old position name
    if (newName !== oldName) {
      await sequelize.query(
        `UPDATE candidates SET positionApplying = ? WHERE positionApplying = ?`,
        { replacements: [newName, oldName] }
      );
    }
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
