const express = require('express');
const router = express.Router();
const multer = require('multer');
const adminController         = require('../controllers/adminController');
const detailFormController    = require('../controllers/detailFormController');
const requisitionController   = require('../controllers/requisitionController');
const talentAnalystController = require('../controllers/talentAnalystController');
const interviewController     = require('../controllers/interviewController');
const timelineController      = require('../controllers/timelineController');
const downloadController      = require('../controllers/downloadController');
const { requireAdmin, requireSuperAdmin, requireCandidateAccess, redirectIfLoggedIn } = require('../middleware/auth');
const userController  = require('../controllers/userController');
const testController  = require('../controllers/testController');

const path = require('path');

const fileFilter = (req, file, cb) => {
  const allowed = ['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  cb(null, allowed.includes(file.mimetype));
};

const memoryUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter
});

const diskUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, path.join(__dirname, '../uploads')),
    filename: (req, file, cb) => {
      const date = new Date().toISOString().split('T')[0];
      const safe = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
      cb(null, `${date}_${Date.now()}_${safe}`);
    }
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter
});

// Auth
router.get('/login', redirectIfLoggedIn, adminController.showLogin);
router.post('/login', redirectIfLoggedIn, adminController.processLogin);
router.get('/logout', adminController.logout);

// Dashboard
router.get('/dashboard', requireAdmin, adminController.dashboard);
router.get('/candidates', requireAdmin, adminController.candidatesList);
router.get('/', requireAdmin, (req, res) => res.redirect('/admin/dashboard'));

// Candidate CRUD
router.get('/candidate/:id', requireAdmin, requireCandidateAccess, adminController.candidateDetail);
router.post('/candidate/:id/update', requireAdmin, requireCandidateAccess, adminController.updateCandidate);
router.post('/candidate/:id/communicate',   requireAdmin, requireCandidateAccess, adminController.sendCommunication);
router.post('/candidate/:id/ntl-invite',    requireAdmin, requireCandidateAccess, adminController.sendNTLInvite);
router.get('/candidate/:id/download', requireAdmin, requireCandidateAccess, adminController.downloadResume);
router.get('/candidate/:id/preview',  requireAdmin, requireCandidateAccess, adminController.previewResume);
router.delete('/candidate/:id', requireAdmin, requireCandidateAccess, adminController.deleteCandidate);

// Offline Resume Parser
router.get('/resume-parser',        requireAdmin, adminController.showResumeParser);
router.post('/resume-parser/parse', requireAdmin, memoryUpload.single('resume'), adminController.parseOfflineResume);
router.post('/resume-parser/save',  requireAdmin, diskUpload.single('resume'), adminController.saveOfflineCandidate);

// Stats API
router.get('/api/stats', requireAdmin, adminController.getStats);

// Excel Export
router.get('/candidates/export', requireAdmin, adminController.exportCandidates);

// Document Bundle Download (bulk must be before /:id param routes)
router.post('/candidates/bulk-download', requireAdmin, downloadController.downloadBulk);
router.get('/candidate/:id/download-bundle', requireAdmin, requireCandidateAccess, downloadController.downloadSingle);

// Resumes grouped into folders by position
router.get('/resumes/by-position', requireAdmin, downloadController.downloadResumesByPosition);

// Bulk message (common message to all shortlisted / selected candidates)
router.post('/candidates/bulk-message', requireAdmin, adminController.bulkMessage);

// Grading
router.post('/candidates/grade-all', requireAdmin, adminController.gradeAll);
router.post('/candidate/:id/grade',  requireAdmin, requireCandidateAccess, adminController.gradeOne);

// Personal Detail Form
router.post('/candidate/:id/send-detail-form', requireAdmin, requireCandidateAccess, detailFormController.sendDetailForm);
router.get('/candidate/:id/detail-form',       requireAdmin, requireCandidateAccess, detailFormController.viewDetailForm);

// Interview Sheet
router.get('/candidate/:id/interview',  requireAdmin, requireCandidateAccess, interviewController.showSheet);
router.post('/candidate/:id/interview', requireAdmin, requireCandidateAccess, interviewController.saveSheet);
router.get('/candidate/:id/interview/print', requireAdmin, requireCandidateAccess, interviewController.printSheet);

// Activity Timeline
router.get('/candidate/:id/timeline',        requireAdmin, requireCandidateAccess, timelineController.showTimeline);
router.post('/candidate/:id/timeline/email', requireAdmin, requireCandidateAccess, timelineController.emailTimeline);

// Positions Management (super-admin only)
router.get('/positions',              requireSuperAdmin, adminController.listPositions);
router.post('/positions',             requireSuperAdmin, adminController.createPosition);
router.put('/positions/:id',          requireSuperAdmin, adminController.updatePosition);
router.post('/positions/:id/toggle',  requireSuperAdmin, adminController.togglePosition);
router.delete('/positions/:id',       requireSuperAdmin, adminController.deletePosition);

// Department Management (super-admin only)
router.post('/departments',        requireSuperAdmin, adminController.createDepartment);
router.delete('/departments/:id',  requireSuperAdmin, adminController.deleteDepartment);

// User Management (super-admin only)
router.get('/users',          requireSuperAdmin, userController.listUsers);
router.post('/users',         requireSuperAdmin, userController.createUser);
router.put('/users/:id',      requireSuperAdmin, userController.updateUser);
router.delete('/users/:id',   requireSuperAdmin, userController.deleteUser);

// Talent Analyst
router.get('/talent-analyst',         requireAdmin, talentAnalystController.showPage);
router.post('/talent-analyst/analyse', requireAdmin, talentAnalystController.analyse);

// Smart Fit Analyzer
const smartFitController = require('../controllers/smartFitController');
router.get('/smart-fit',                    requireAdmin, smartFitController.showPage);
router.post('/smart-fit/config',           requireAdmin, smartFitController.saveConfig);
router.post('/smart-fit/analyse',          requireAdmin, smartFitController.analyse);
router.get('/smart-fit/scores',            requireAdmin, smartFitController.getScores);
router.post('/smart-fit/grade-position',   requireAdmin, smartFitController.gradeFromSmartFit);

// Manpower Requisitions
router.post('/requisitions/send-form',   requireAdmin, requisitionController.sendFormToEmail);
router.get('/requisitions',              requireAdmin, requisitionController.listRequisitions);
router.get('/requisitions/:id',          requireAdmin, requisitionController.requisitionDetail);
router.post('/requisitions/:id/status',  requireAdmin, requisitionController.updateStatus);

// Assessment Tests
router.post('/candidate/:id/send-test', requireAdmin, requireCandidateAccess, testController.sendTest);
router.get('/candidate/:id/tests',      requireAdmin, requireCandidateAccess, testController.listTests);
router.get('/test-result/:testId',      requireAdmin, testController.viewResult);

module.exports = router;
