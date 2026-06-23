const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const candidateController = require('../controllers/candidateController');

const fileFilter = (req, file, cb) => {
  const allowed = ['application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('Only PDF, DOC, and DOCX files are allowed'), false);
};

// Disk storage — used for REAL form submission (saves file to uploads/)
const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
    filename: (req, file, cb) => {
      const date = new Date().toISOString().split('T')[0];
      const ts   = Date.now();
      const safe = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
      cb(null, `${date}_${ts}_${safe}`);
    }
  }),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Memory storage — used ONLY for the live-parse AJAX call (no disk write, no orphaned files)
const memoryUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

router.get('/', (req, res) => res.redirect('/apply'));
router.get('/apply', candidateController.showForm);
router.post('/apply', diskUpload.single('resume'), candidateController.submitForm);
router.post('/apply/parse-resume', memoryUpload.single('resume'), candidateController.parseResumeAjax);

module.exports = router;
