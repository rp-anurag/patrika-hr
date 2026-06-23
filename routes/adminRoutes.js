const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { requireAdmin, redirectIfLoggedIn } = require('../middleware/auth');

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

// Stats API
router.get('/api/stats', requireAdmin, adminController.getStats);

module.exports = router;
