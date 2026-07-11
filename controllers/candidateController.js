const { Candidate, Position } = require('../models');
const { Op } = require('sequelize');
const { parseResume } = require('../utils/resumeParser');
const { sendEmail, applicationReceivedTemplate } = require('../utils/emailService');
const { qrExists, generateQR } = require('../utils/qrGenerator');
const { computeGradeAsync } = require('../utils/grader');

// GET /apply
exports.showForm = async (req, res) => {
  if (!qrExists()) {
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    generateQR(`${appUrl}/apply`).catch(console.error);
  }
  const positions = await Position.findAll({
    where: { isActive: true },
    order: [['department','ASC'],['sortOrder','ASC'],['name','ASC']]
  });
  // Group by department for the apply form
  const positionsByDept = {};
  positions.forEach(p => {
    const dept = p.department || 'General';
    if (!positionsByDept[dept]) positionsByDept[dept] = [];
    positionsByDept[dept].push(p);
  });
  res.render('form', {
    title: 'Apply Now – Patrika HR',
    success: req.query.success,
    error: req.query.error,
    positions,
    positionsByDept
  });
};

// POST /apply
exports.submitForm = async (req, res) => {
  try {
    const {
      fullName, contactNumber, email, linkedInProfile, currentLocation,
      positionApplying, noticePeriod,
      packageFixed, packageVariables, packageOthers,
      whyJoinUs, first90DaysPlan
    } = req.body;

    // Block if this candidate (by email or phone) has already applied for any position
    const existing = await Candidate.findOne({
      where: {
        [Op.or]: [
          { email: email.trim().toLowerCase() },
          { contactNumber: contactNumber.trim() }
        ]
      },
      order: [['submittedAt', 'DESC']]
    });
    if (existing) {
      return res.redirect(`/apply?error=${encodeURIComponent(
        `You have already submitted an application (for "${existing.positionApplying}"). Only one application per candidate is allowed.`
      )}`);
    }

    const candidateData = {
      fullName:        fullName.trim(),
      contactNumber:   contactNumber.trim(),
      email:           email.trim().toLowerCase(),
      linkedInProfile: (linkedInProfile || '').trim() || null,
      currentLocation: currentLocation.trim(),
      whyJoinUs:       (whyJoinUs || '').trim() || null,
      first90DaysPlan: (first90DaysPlan || '').trim() || null,
      positionApplying,
      noticePeriod,
      packageFixed:     parseFloat(packageFixed)     || 0,
      packageVariables: parseFloat(packageVariables) || 0,
      packageOthers:    parseFloat(packageOthers)    || 0,
      submittedAt: new Date(),
      updatedAt:   new Date()
    };

    if (req.file) {
      candidateData.resumeOriginalName = req.file.originalname;
      candidateData.resumeStoredName   = req.file.filename;
      candidateData.resumePath         = req.file.path;
      candidateData.resumeMimetype     = req.file.mimetype;
      candidateData.resumeSize         = req.file.size;
    }

    const candidate = await Candidate.create(candidateData);

    // Parse resume + auto-grade asynchronously — don't block response
    if (req.file) {
      parseResume(req.file.path, req.file.mimetype)
        .then(async parsed => {
          const parsedFields = {
            parsedName:              parsed.name,
            parsedEmail:             parsed.email,
            parsedPhone:             parsed.phone,
            parsedLocation:          parsed.location,
            parsedSkills:            JSON.stringify(parsed.skills || []),
            parsedLinkedIn:          parsed.linkedin || null,
            parsedSummary:           parsed.summary || null,
            parsedTotalExperience:   parsed.totalExperience || null,
            parsedCurrentRole:       parsed.currentRole || null,
            parsedExperienceEntries: JSON.stringify(parsed.experienceEntries || []),
            parsedEducation:         JSON.stringify(parsed.education || []),
            parsedRawText:           parsed.rawText
          };
          // Compute grade against JD (AI-first, keyword fallback)
          const pos = await Position.findOne({ where: { name: positionApplying } }).catch(() => null);
          const gradedCandidate = { ...parsedFields, parsedRawText: parsed.rawText };
          const gradeResult = await computeGradeAsync(gradedCandidate, pos ? pos.jdHtml : '', positionApplying);
          await Candidate.update({
            ...parsedFields,
            grade:         gradeResult.grade,
            gradeScore:    gradeResult.score,
            gradeReason:   gradeResult.gradeReason,
            gradeSource:   gradeResult.gradeSource,
            analystReport: gradeResult.analystReport || null
          }, { where: { id: candidate.id } });
        })
        .catch(err => console.error('Parse save error:', err.message));
    }

    // Send confirmation email (non-blocking)
    if (email) {
      const tmpl = applicationReceivedTemplate(fullName, positionApplying);
      sendEmail({ to: email, ...tmpl }).catch(err =>
        console.error('Email error:', err.message)
      );
    }

    res.redirect('/apply?success=1');
  } catch (err) {
    console.error('Form submission error:', err);
    res.redirect(`/apply?error=${encodeURIComponent(err.message)}`);
  }
};

// POST /apply/parse-resume  (AJAX — live parsing on file select, uses memory storage — no disk write)
exports.parseResumeAjax = async (req, res) => {
  try {
    if (!req.file) return res.json({ success: false, message: 'No file uploaded' });
    // req.file.buffer is the in-memory bytes (memoryUpload); no file path exists here
    const parsed = await parseResume(req.file.buffer, req.file.mimetype);
    res.json({
      success: true,
      data: {
        name:     parsed.name,
        email:    parsed.email,
        phone:    parsed.phone,
        location: parsed.location,
        skills:   parsed.skills
      }
    });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
};
