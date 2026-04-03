// routes/auth.js
const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', ctrl.register);
router.post('/verify-otp', ctrl.verifyOtp);
router.post('/resend-otp', ctrl.resendOtp);
router.post('/resend-otp-email', ctrl.resendOtpByEmail);
router.post('/login', ctrl.login);
router.post('/forgot-password', ctrl.forgotPassword);
router.post('/reset-password', ctrl.resetPassword);
router.post('/verify-id', protect, ctrl.verifyGovId);
router.post('/verify-face', protect, ctrl.verifyFace);
router.get('/me', protect, ctrl.getMe);

module.exports = router;
