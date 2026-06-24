const express = require('express');
const router = express.Router();
const multer = require('multer');
const adminController = require('../controllers/adminController');
const { requireAdmin, redirectIfLoggedIn } = require('../middleware/auth');

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    cb(null, allowed.includes(file.mimetype));
  }
});

// Auth
router.get('/login', redirectIfLoggedIn, adminController.showLogin);
router.post('/login', redirectIfLoggedIn, adminController.processLogin);
router.get('/logout', adminController.logout);

// Dashboard
router.get('/dashboard', requireAdmin, adminController.dashboard);
router.get('/', requireAdmin, (req, res) => res.redirect('/admin/dashboard'));

// Candidate CRUD
router.get('/candidate/:id', requireAdmin, adminController.candidateDetail);
router.post('/candidate/:id/update', requireAdmin, adminController.updateCandidate);
router.post('/candidate/:id/communicate', requireAdmin, adminController.sendCommunication);
router.get('/candidate/:id/download', requireAdmin, adminController.downloadResume);
router.get('/candidate/:id/preview',  requireAdmin, adminController.previewResume);
router.delete('/candidate/:id', requireAdmin, adminController.deleteCandidate);

// Offline Resume Parser
router.get('/resume-parser',        requireAdmin, adminController.showResumeParser);
router.post('/resume-parser/parse', requireAdmin, memoryUpload.single('resume'), adminController.parseOfflineResume);
router.post('/resume-parser/save',  requireAdmin, adminController.saveOfflineCandidate);

// Stats API
router.get('/api/stats', requireAdmin, adminController.getStats);

module.exports = router;
