'use strict';
const { Candidate, Communication, InterviewSheet, ActivityLog } = require('../models');
const { sendEmail } = require('../utils/emailService');

function fmtDate(d) {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return String(d);
  }
}

// Build a unified events array from all sources
function buildEvents(candidate, communications, activityLogs, interviewSheet) {
  const events = [];

  // ── Application received ──────────────────────────────────────────────────
  events.push({
    type: 'application_received',
    timestamp: candidate.submittedAt ? new Date(candidate.submittedAt) : new Date(0),
    title: 'Application Received',
    body: `Applied for <strong>${candidate.positionApplying || '—'}</strong>`,
    meta: {
      position: candidate.positionApplied || candidate.positionApplying || '—',
      package: [
        candidate.packageFixed   ? `Fixed: ₹${candidate.packageFixed}L`    : null,
        candidate.packageVariables ? `Variable: ₹${candidate.packageVariables}L` : null,
        candidate.packageOthers  ? `Others: ₹${candidate.packageOthers}L`  : null,
      ].filter(Boolean).join(' · ') || '—',
      noticePeriod: candidate.noticePeriod || '—',
      submittedAt: fmtDate(candidate.submittedAt)
    },
    icon: 'bi-person-fill-check',
    color: '#f0c030',
    colorClass: 'gold',
    performedBy: 'System'
  });

  // ── Activity log entries ──────────────────────────────────────────────────
  for (const log of activityLogs) {
    let icon = 'bi-activity';
    let color = '#6c757d';
    let colorClass = 'secondary';
    let body = '';

    switch (log.activityType) {
      case 'status_changed':
        icon = 'bi-arrow-repeat';
        color = '#0d6efd';
        colorClass = 'primary';
        body = `Status changed from <strong>${log.oldValue || '—'}</strong> to <strong>${log.newValue || '—'}</strong>`;
        break;
      case 'note_saved':
        icon = 'bi-sticky-fill';
        color = '#ffc107';
        colorClass = 'warning';
        body = log.details || '—';
        break;
      case 'email_sent':
        icon = 'bi-envelope-fill';
        color = '#198754';
        colorClass = 'success';
        body = log.details || '—';
        break;
      case 'whatsapp_sent':
        icon = 'bi-whatsapp';
        color = '#20c997';
        colorClass = 'teal';
        body = log.details || '—';
        break;
      case 'interview_updated':
        icon = 'bi-camera-video-fill';
        color = '#6f42c1';
        colorClass = 'purple';
        body = log.details || '—';
        break;
      case 'detail_form_submitted':
        icon = 'bi-file-earmark-check-fill';
        color = '#0dcaf0';
        colorClass = 'info';
        body = log.details || 'Detail form submitted';
        break;
      case 'test_sent':
        icon = 'bi-clipboard2-pulse-fill';
        color = '#d4af37';
        colorClass = 'gold';
        body = log.details || 'Assessment test sent';
        break;
      case 'test_submitted':
        icon = 'bi-clipboard2-check-fill';
        color = '#198754';
        colorClass = 'success';
        body = log.details || 'Assessment test submitted';
        break;
      case 'email_received':
        icon = 'bi-envelope-arrow-down-fill';
        color = '#fd7e14';
        colorClass = 'orange';
        body = log.details || 'Reply received from candidate';
        break;
      default:
        body = log.details || '';
    }

    events.push({
      type: log.activityType,
      timestamp: log.createdAt ? new Date(log.createdAt) : new Date(0),
      title: log.title || log.activityType,
      body,
      meta: { oldValue: log.oldValue, newValue: log.newValue },
      icon,
      color,
      colorClass,
      performedBy: log.performedBy || 'Admin'
    });
  }

  // ── Communications (legacy — ones before ActivityLog existed) ─────────────
  // Deduplicate: skip comms that already appear in activityLogs by approximate time+channel
  const loggedCommTimes = new Set(
    activityLogs
      .filter(l => l.activityType === 'email_sent' || l.activityType === 'whatsapp_sent')
      .map(l => Math.floor(new Date(l.createdAt).getTime() / 60000)) // minute bucket
  );

  for (const comm of communications) {
    const bucket = Math.floor(new Date(comm.sentAt).getTime() / 60000);
    if (loggedCommTimes.has(bucket)) continue; // already logged via ActivityLog

    const isEmail = comm.channel === 'Email';
    events.push({
      type: isEmail ? 'email_sent' : 'whatsapp_sent',
      timestamp: comm.sentAt ? new Date(comm.sentAt) : new Date(0),
      title: comm.subject || (isEmail ? 'Email Sent' : 'WhatsApp Sent'),
      body: comm.message ? comm.message.substring(0, 300) : '—',
      meta: { subject: comm.subject, status: comm.status },
      icon: isEmail ? 'bi-envelope-fill' : 'bi-whatsapp',
      color: isEmail ? '#198754' : '#20c997',
      colorClass: isEmail ? 'success' : 'teal',
      performedBy: comm.sentBy || 'Admin'
    });
  }

  // Sort descending (newest first)
  events.sort((a, b) => b.timestamp - a.timestamp);
  return events;
}

// ─── Quick stats ──────────────────────────────────────────────────────────────
function buildStats(events, interviewSheet) {
  const emailCount = events.filter(e => e.type === 'email_sent').length;
  const statusChanges = events.filter(e => e.type === 'status_changed').length;
  let interviewRounds = 0;
  if (interviewSheet) {
    if (interviewSheet.prelimInterviewedBy) interviewRounds++;
    if (interviewSheet.r1InterviewedBy) interviewRounds++;
    if (interviewSheet.r2InterviewedBy) interviewRounds++;
    if (interviewSheet.hrInterviewedBy) interviewRounds++;
  }
  const whatsappCount = events.filter(e => e.type === 'whatsapp_sent').length;
  const noteCount = events.filter(e => e.type === 'note_saved').length;
  return { emailCount, whatsappCount, statusChanges, interviewRounds, noteCount };
}

// ─── SHOW TIMELINE ────────────────────────────────────────────────────────────
exports.showTimeline = async (req, res) => {
  try {
    const candidateId = req.params.id;

    const candidate = await Candidate.findByPk(candidateId);
    if (!candidate) return res.status(404).send('Candidate not found');

    const [communications, activityLogs, interviewSheet] = await Promise.all([
      Communication.findAll({
        where: { candidateId },
        order: [['sentAt', 'DESC']]
      }),
      ActivityLog.findAll({
        where: { candidateId },
        order: [['createdAt', 'DESC']]
      }),
      InterviewSheet.findOne({ where: { candidateId } })
    ]);

    const events = buildEvents(candidate, communications, activityLogs, interviewSheet);
    const stats = buildStats(events, interviewSheet);

    res.render('admin/candidate-timeline', {
      title: `Activity History – ${candidate.fullName}`,
      v: Date.now(),
      adminName: req.session.adminName || 'Admin',
      candidate,
      events,
      interviewSheet,
      stats,
      fmtDate
    });
  } catch (err) {
    console.error('Timeline error:', err);
    res.status(500).send('Server error loading timeline');
  }
};

// ─── EMAIL TIMELINE ───────────────────────────────────────────────────────────
exports.emailTimeline = async (req, res) => {
  try {
    const candidateId = req.params.id;
    const toEmail = (req.body.toEmail || '').trim();
    if (!toEmail) return res.json({ success: false, message: 'No email address provided' });

    const candidate = await Candidate.findByPk(candidateId);
    if (!candidate) return res.json({ success: false, message: 'Candidate not found' });

    const [communications, activityLogs, interviewSheet] = await Promise.all([
      Communication.findAll({ where: { candidateId }, order: [['sentAt', 'DESC']] }),
      ActivityLog.findAll({ where: { candidateId }, order: [['createdAt', 'DESC']] }),
      InterviewSheet.findOne({ where: { candidateId } })
    ]);

    const events = buildEvents(candidate, communications, activityLogs, interviewSheet);
    const stats = buildStats(events, interviewSheet);

    // Build event rows HTML
    const eventRows = events.map(ev => {
      const bgColor = ev.colorClass === 'gold' ? '#c9941a'
        : ev.colorClass === 'primary'  ? '#0d6efd'
        : ev.colorClass === 'success'  ? '#198754'
        : ev.colorClass === 'warning'  ? '#ffc107'
        : ev.colorClass === 'teal'     ? '#20c997'
        : ev.colorClass === 'purple'   ? '#6f42c1'
        : ev.colorClass === 'info'     ? '#0dcaf0'
        : '#6c757d';

      return `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #f0e8d0;width:150px;color:#888;font-size:12px;white-space:nowrap;">
            ${fmtDate(ev.timestamp)}
          </td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0e8d0;width:160px;">
            <span style="background:${bgColor};color:#fff;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;">
              ${ev.title}
            </span>
          </td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0e8d0;font-size:13px;color:#333;">
            ${ev.body}
          </td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0e8d0;font-size:12px;color:#888;">
            ${ev.performedBy || '—'}
          </td>
        </tr>`;
    }).join('');

    // Interview summary block
    let interviewHtml = '';
    if (interviewSheet) {
      const rounds = [
        { label: 'Preliminary', by: interviewSheet.prelimInterviewedBy, date: interviewSheet.prelimDate, marks: null, rec: null },
        { label: 'Round 1',     by: interviewSheet.r1InterviewedBy,     date: interviewSheet.r1Date,    marks: interviewSheet.r1Marks, rec: interviewSheet.r1Recommendation },
        { label: 'Round 2',     by: interviewSheet.r2InterviewedBy,     date: interviewSheet.r2Date,    marks: interviewSheet.r2Marks, rec: interviewSheet.r2Recommendation },
        { label: 'HR Round',    by: interviewSheet.hrInterviewedBy,     date: interviewSheet.hrDate,    marks: interviewSheet.hrMarks, rec: interviewSheet.hrRecommendation }
      ].filter(r => r.by);

      const roundRows = rounds.map(r => `
        <tr>
          <td style="padding:8px 12px;border:1px solid #ddd;">${r.label}</td>
          <td style="padding:8px 12px;border:1px solid #ddd;">${r.by || '—'}</td>
          <td style="padding:8px 12px;border:1px solid #ddd;">${r.date || '—'}</td>
          <td style="padding:8px 12px;border:1px solid #ddd;">${r.marks != null ? `${r.marks}/100` : '—'}</td>
          <td style="padding:8px 12px;border:1px solid #ddd;">${r.rec || '—'}</td>
        </tr>`).join('');

      interviewHtml = `
        <div style="margin-top:32px;">
          <h3 style="color:#8b6914;border-bottom:2px solid #f0c030;padding-bottom:8px;">Interview Summary</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f9f6ec;">
                <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">Round</th>
                <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">Interviewer</th>
                <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">Date</th>
                <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">Marks</th>
                <th style="padding:8px 12px;border:1px solid #ddd;text-align:left;">Recommendation</th>
              </tr>
            </thead>
            <tbody>${roundRows || '<tr><td colspan="5" style="padding:12px;text-align:center;color:#888;">No rounds recorded</td></tr>'}</tbody>
          </table>
          <table style="width:100%;border-collapse:collapse;font-size:13px;margin-top:16px;">
            <tr>
              <td style="padding:8px 12px;border:1px solid #ddd;font-weight:600;background:#f9f6ec;">Overall Score</td>
              <td style="padding:8px 12px;border:1px solid #ddd;">${interviewSheet.overallScore != null ? interviewSheet.overallScore + '/100' : '—'}</td>
              <td style="padding:8px 12px;border:1px solid #ddd;font-weight:600;background:#f9f6ec;">Final Decision</td>
              <td style="padding:8px 12px;border:1px solid #ddd;">${interviewSheet.finalDecision || '—'}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border:1px solid #ddd;font-weight:600;background:#f9f6ec;">Salary Offered</td>
              <td style="padding:8px 12px;border:1px solid #ddd;">${interviewSheet.salaryOffered || '—'}</td>
              <td style="padding:8px 12px;border:1px solid #ddd;font-weight:600;background:#f9f6ec;">Reporting To</td>
              <td style="padding:8px 12px;border:1px solid #ddd;">${interviewSheet.reportingTo || '—'}</td>
            </tr>
            <tr>
              <td style="padding:8px 12px;border:1px solid #ddd;font-weight:600;background:#f9f6ec;">Joining Period</td>
              <td style="padding:8px 12px;border:1px solid #ddd;">${interviewSheet.joiningPeriod || '—'}</td>
              <td style="padding:8px 12px;border:1px solid #ddd;font-weight:600;background:#f9f6ec;">Exit Clause</td>
              <td style="padding:8px 12px;border:1px solid #ddd;">${interviewSheet.exitClause || '—'}</td>
            </tr>
          </table>
        </div>`;
    }

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto;border:1px solid #e0c97a;border-radius:8px;overflow:hidden;">
        <div style="background:linear-gradient(135deg,#1a1a2e,#8b6914);padding:24px;">
          <h2 style="color:#f0c030;margin:0;font-size:20px;">Candidate Activity Timeline</h2>
          <p style="color:#fff;margin:4px 0 0;font-size:13px;">Patrika HR Intelligence System</p>
        </div>
        <div style="padding:24px;background:#fff;">
          <table style="width:100%;border-collapse:collapse;margin-bottom:8px;font-size:13px;">
            <tr>
              <td style="padding:6px 12px;font-weight:600;color:#888;width:140px;">Candidate</td>
              <td style="padding:6px 12px;font-weight:700;font-size:15px;">${candidate.fullName}</td>
              <td style="padding:6px 12px;font-weight:600;color:#888;width:140px;">Position</td>
              <td style="padding:6px 12px;">${candidate.positionApplying || '—'}</td>
            </tr>
            <tr>
              <td style="padding:6px 12px;font-weight:600;color:#888;">Current Status</td>
              <td style="padding:6px 12px;">${candidate.status || '—'}</td>
              <td style="padding:6px 12px;font-weight:600;color:#888;">Total Events</td>
              <td style="padding:6px 12px;">${events.length}</td>
            </tr>
            <tr>
              <td style="padding:6px 12px;font-weight:600;color:#888;">Emails Sent</td>
              <td style="padding:6px 12px;">${stats.emailCount}</td>
              <td style="padding:6px 12px;font-weight:600;color:#888;">Status Changes</td>
              <td style="padding:6px 12px;">${stats.statusChanges}</td>
            </tr>
          </table>

          <h3 style="color:#8b6914;border-bottom:2px solid #f0c030;padding-bottom:8px;margin-top:24px;">Activity Timeline</h3>
          <table style="width:100%;border-collapse:collapse;font-size:13px;">
            <thead>
              <tr style="background:#f9f6ec;">
                <th style="padding:8px 16px;border-bottom:2px solid #f0c030;text-align:left;color:#8b6914;">Date &amp; Time</th>
                <th style="padding:8px 16px;border-bottom:2px solid #f0c030;text-align:left;color:#8b6914;">Event</th>
                <th style="padding:8px 16px;border-bottom:2px solid #f0c030;text-align:left;color:#8b6914;">Details</th>
                <th style="padding:8px 16px;border-bottom:2px solid #f0c030;text-align:left;color:#8b6914;">By</th>
              </tr>
            </thead>
            <tbody>${eventRows}</tbody>
          </table>

          ${interviewHtml}
        </div>
        <div style="background:#f5f5f5;padding:12px;text-align:center;">
          <p style="font-size:11px;color:#999;margin:0;">Generated by Patrika HR System · ${new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
        </div>
      </div>`;

    await sendEmail({
      to: toEmail,
      subject: `Activity History – ${candidate.fullName} | Patrika HR`,
      html
    });

    res.json({ success: true, message: `Timeline emailed to ${toEmail}` });
  } catch (err) {
    console.error('emailTimeline error:', err);
    res.json({ success: false, message: err.message });
  }
};
