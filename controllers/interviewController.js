'use strict';

const { Candidate, InterviewSheet } = require('../models');

// ── helpers ──────────────────────────────────────────────────────────────────

function computeOverallScore(data) {
  const marks = [];
  if (data.r1Marks != null && data.r1Marks !== '') marks.push(parseInt(data.r1Marks, 10));
  if (data.r2Marks != null && data.r2Marks !== '') marks.push(parseInt(data.r2Marks, 10));
  if (data.hrMarks != null && data.hrMarks !== '') marks.push(parseInt(data.hrMarks, 10));
  if (!marks.length) return null;
  return Math.round(marks.reduce((a, b) => a + b, 0) / marks.length);
}

function sanitizeInt(val) {
  if (val === '' || val == null) return null;
  const n = parseInt(val, 10);
  return isNaN(n) ? null : Math.min(100, Math.max(0, n));
}

function str(val) {
  return (val === '' || val == null) ? null : String(val).trim();
}

// ── controllers ──────────────────────────────────────────────────────────────

exports.showSheet = async (req, res) => {
  try {
    const candidate = await Candidate.findByPk(req.params.id, {
      include: [
        { association: 'communications' },
        { association: 'interviewSheet' }
      ]
    });
    if (!candidate) return res.status(404).send('Candidate not found');

    const sheet = candidate.interviewSheet || null;
    const saved = req.query.saved === '1';

    res.render('admin/interview-sheet', {
      title: `Interview Sheet – ${candidate.fullName}`,
      v: Date.now(),
      adminName: req.session.adminName || 'Admin',
      candidate,
      sheet,
      saved,
      print: false
    });
  } catch (err) {
    console.error('showSheet error:', err);
    res.status(500).send('Server error: ' + err.message);
  }
};

exports.saveSheet = async (req, res) => {
  try {
    const candidateId = parseInt(req.params.id, 10);

    const data = {
      candidateId,
      interviewMode:   str(req.body.interviewMode)   || 'Physical',
      scheduledDate:   str(req.body.scheduledDate),

      prelimInterviewedBy: str(req.body.prelimInterviewedBy),
      prelimDate:          str(req.body.prelimDate),
      prelimFamilyNotes:   str(req.body.prelimFamilyNotes),

      r1InterviewedBy:     str(req.body.r1InterviewedBy),
      r1Date:              str(req.body.r1Date),
      r1Recommendation:    str(req.body.r1Recommendation),
      r1ConsiderFor:       str(req.body.r1ConsiderFor),
      r1RecommendedSalary: str(req.body.r1RecommendedSalary),
      r1Designation:       str(req.body.r1Designation),
      r1Marks:             sanitizeInt(req.body.r1Marks),
      r1Feedback:          str(req.body.r1Feedback),

      r2InterviewedBy:     str(req.body.r2InterviewedBy),
      r2Date:              str(req.body.r2Date),
      r2Recommendation:    str(req.body.r2Recommendation),
      r2ConsiderFor:       str(req.body.r2ConsiderFor),
      r2RecommendedSalary: str(req.body.r2RecommendedSalary),
      r2Designation:       str(req.body.r2Designation),
      r2Marks:             sanitizeInt(req.body.r2Marks),
      r2Feedback:          str(req.body.r2Feedback),

      hrInterviewedBy:     str(req.body.hrInterviewedBy),
      hrDate:              str(req.body.hrDate),
      hrRecommendation:    str(req.body.hrRecommendation),
      hrConsiderFor:       str(req.body.hrConsiderFor),
      hrRecommendedSalary: str(req.body.hrRecommendedSalary),
      hrDesignation:       str(req.body.hrDesignation),
      hrMarks:             sanitizeInt(req.body.hrMarks),
      hrFeedback:          str(req.body.hrFeedback),

      salaryOffered:       str(req.body.salaryOffered),
      reportingTo:         str(req.body.reportingTo),
      otherConditions:     str(req.body.otherConditions),
      buddyName:           str(req.body.buddyName),
      natureOfAppointment: str(req.body.natureOfAppointment) || 'Probationary',
      probationPeriod:     str(req.body.probationPeriod),
      exitClause:          str(req.body.exitClause) || 'Applicable',
      joiningPeriod:       str(req.body.joiningPeriod),
      finalRemarks:        str(req.body.finalRemarks),

      finalDecision: str(req.body.finalDecision) || 'Pending',
      updatedAt: new Date()
    };

    data.overallScore = computeOverallScore(data);

    const existing = await InterviewSheet.findOne({ where: { candidateId } });
    if (existing) {
      await existing.update(data);
    } else {
      data.createdAt = new Date();
      await InterviewSheet.create(data);
    }

    res.redirect(`/admin/candidate/${candidateId}/interview?saved=1`);
  } catch (err) {
    console.error('saveSheet error:', err);
    res.status(500).send('Error saving interview sheet: ' + err.message);
  }
};

exports.printSheet = async (req, res) => {
  try {
    const candidate = await Candidate.findByPk(req.params.id, {
      include: [{ association: 'interviewSheet' }]
    });
    if (!candidate) return res.status(404).send('Candidate not found');

    res.render('admin/interview-sheet', {
      title: `Interview Sheet – ${candidate.fullName}`,
      v: Date.now(),
      adminName: req.session.adminName || 'Admin',
      candidate,
      sheet: candidate.interviewSheet || null,
      saved: false,
      print: true
    });
  } catch (err) {
    console.error('printSheet error:', err);
    res.status(500).send('Server error: ' + err.message);
  }
};
