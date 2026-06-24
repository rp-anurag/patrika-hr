const { Candidate } = require('../models');
const { parseResume } = require('../utils/resumeParser');
const { sendEmail, applicationReceivedTemplate } = require('../utils/emailService');
const { qrExists, generateQR } = require('../utils/qrGenerator');

// GET /apply
exports.showForm = async (req, res) => {
  if (!qrExists()) {
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    generateQR(`${appUrl}/apply`).catch(console.error);
  }
  res.render('form', {
    title: 'Apply Now – Patrika HR',
    success: req.query.success,
    error: req.query.error
  });
};

// POST /apply
exports.submitForm = async (req, res) => {
  try {
    const {
      fullName, contactNumber, email, currentLocation,
      positionApplying, noticePeriod,
      packageFixed, packageVariables, packageOthers
    } = req.body;

    const candidateData = {
      fullName:        fullName.trim(),
      contactNumber:   contactNumber.trim(),
      email:           email.trim().toLowerCase(),
      currentLocation: currentLocation.trim(),
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

    // Parse resume asynchronously — don't block response
    if (req.file) {
      parseResume(req.file.path, req.file.mimetype)
        .then(parsed => Candidate.update({
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
        }, { where: { id: candidate.id } }))
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
