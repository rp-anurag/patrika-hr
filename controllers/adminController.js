const { Candidate, Communication, Admin } = require('../models');
const { sequelize } = require('../config/db');
const { sendEmail } = require('../utils/emailService');
const { sendWhatsApp } = require('../utils/whatsappService');
const { Op } = require('sequelize');
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

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

exports.dashboard = async (req, res) => {
  try {
    const { search, status, position, sort = 'submittedAt', order = 'desc', page = 1 } = req.query;
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

    // Validate sort column to prevent SQL injection
    const SAFE_SORT_COLS = ['fullName','email','submittedAt','status','positionApplying'];
    const safeSort  = SAFE_SORT_COLS.includes(sort) ? sort : 'submittedAt';
    const safeOrder = order === 'asc' ? 'ASC' : 'DESC';

    const [{ rows: candidates, count: total }, statusRows] = await Promise.all([
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
      )
    ]);

    const statusCounts = {};
    statusRows.forEach(r => { statusCounts[r.status] = parseInt(r.count); });

    res.render('admin/dashboard', {
      title: 'Admin Dashboard – Patrika HR',
      candidates,
      total,
      page:       parseInt(page),
      totalPages: Math.ceil(total / limit),
      query:      req.query,
      statusCounts,
      adminName:  req.session.adminName
    });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server error: ' + err.message);
  }
};

// ─── CANDIDATE DETAIL ─────────────────────────────────────────────────────────

exports.candidateDetail = async (req, res) => {
  try {
    const candidate = await Candidate.findByPk(req.params.id, {
      include: [{
        model: Communication,
        as:    'communications',
        order: [['sentAt', 'DESC']]
      }]
    });
    if (!candidate) return res.status(404).send('Candidate not found');

    res.render('admin/candidate-detail', {
      title:     `${candidate.fullName} – Patrika HR`,
      candidate,
      adminName: req.session.adminName,
      flash:     req.query.flash,
      flashType: req.query.flashType || 'success'
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
    await Candidate.update(
      { status, adminNotes, updatedAt: new Date() },
      { where: { id: req.params.id } }
    );
    res.redirect(`/admin/candidate/${req.params.id}?flash=Updated+successfully`);
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
