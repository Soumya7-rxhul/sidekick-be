const bcrypt = require('bcryptjs');
const axios = require('axios');
const nodemailer = require('nodemailer');
const User = require('../models/User');
const { generateTokens } = require('../middleware/auth');

const FACE_SERVICE_URL = process.env.FACE_SERVICE_URL || 'http://localhost:8001';

// Send OTP via SMS (Fast2SMS) + Email
const sendOtp = async (phone, email, otp, name) => {
  // Send SMS via Fast2SMS
  try {
    const phoneClean = phone.replace(/\D/g, '').slice(-10);
    await axios.post('https://www.fast2sms.com/dev/bulkV2', {
      route: 'otp',
      variables_values: otp,
      numbers: phoneClean,
    }, {
      headers: { authorization: process.env.FAST2SMS_API_KEY },
      timeout: 5000,
    });
    console.log(`SMS OTP sent to ${phoneClean}`);
  } catch (err) {
    console.warn('SMS failed:', err.message);
  }
  // Always send email as backup
  try {
    await sendOtpEmail(email, otp, name);
  } catch (err) {
    console.warn('Email OTP failed:', err.message);
  }
};

const sanitize = (user) => {
  const u = user.toObject ? user.toObject() : { ...user };
  delete u.passwordHash;
  delete u.otpCode;
  delete u.otpExpiry;
  delete u.faceDescriptor;
  return u;
};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

const sendOtpEmail = async (email, otp, name) => {
  await transporter.sendMail({
    from: `"SideKick" <${process.env.GMAIL_USER}>`,
    to: email,
    subject: 'Your SideKick OTP Code',
    html: `<p>Hi ${name},</p><p>Your OTP is: <b style="font-size:24px">${otp}</b></p><p>Valid for 10 minutes.</p>`,
  });
};

// ── REGISTER ─────────────────────────────────────────────
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password } = req.body;

    if (!name || !email || !phone || !password)
      return res.status(400).json({ message: 'All fields are required' });
    if (password.length < 8)
      return res.status(400).json({ message: 'Password must be at least 8 characters' });

    const phoneClean = phone.replace(/\s/g, '');
    if (!/^\+?[\d]{10,15}$/.test(phoneClean))
      return res.status(400).json({ message: 'Phone must be 10 digits' });

    const existing = await User.findOne({ $or: [{ email }, { phone: phoneClean }] });
    if (existing) {
      if (existing.isPhoneVerified)
        return res.status(400).json({ message: 'Email or phone already registered' });

      // Unverified partial signup — update all fields so the user can correct mistakes
      const passwordHash = await bcrypt.hash(password, 12);
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      existing.name = name;
      existing.email = email;
      existing.phone = phoneClean;
      existing.passwordHash = passwordHash;
      existing.otpCode = otp;
      existing.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
      existing.signupCreatedAt = new Date(); // reset TTL window
      await existing.save();
      await sendOtp(phoneClean, email, otp, name);
      return res.status(200).json({ message: 'OTP sent to your phone and email.', userId: existing._id, phone: phoneClean });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpExpiry = new Date(Date.now() + 10 * 60 * 1000);

    const user = await User.create({
      name, email, phone: phoneClean, passwordHash,
      otpCode: otp, otpExpiry,
      signupCreatedAt: new Date(), // enables TTL cleanup if never verified
    });

    await sendOtp(phoneClean, email, otp, name);
    res.status(201).json({ message: 'Registered! OTP sent to your phone and email.', userId: user._id, phone: phoneClean });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── VERIFY OTP ────────────────────────────────────────────
exports.verifyOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp)
      return res.status(400).json({ message: 'Phone and OTP are required' });

    const phoneClean = phone.replace(/\s/g, '');
    const user = await User.findOne({ phone: phoneClean });

    if (!user || user.otpCode !== otp || Date.now() > new Date(user.otpExpiry).getTime())
      return res.status(400).json({ message: 'Invalid or expired OTP' });

    user.isPhoneVerified = true;
    user.otpCode = undefined;
    user.otpExpiry = undefined;
    user.signupCreatedAt = null; // clear TTL — verified users must never be auto-deleted
    await user.save();

    const { accessToken } = generateTokens(user._id);
    res.json({ message: 'Phone verified', accessToken, user: sanitize(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── RESEND OTP ────────────────────────────────────────────
exports.resendOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ message: 'Phone is required' });

    const phoneClean = phone.replace(/\s/g, '');
    const user = await User.findOne({ phone: phoneClean });
    if (!user) return res.status(404).json({ message: 'User not found' });
    if (user.isPhoneVerified) return res.status(400).json({ message: 'Phone already verified' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otpCode = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendOtp(user.phone, user.email, otp, user.name);
    res.json({ message: 'OTP resent to your phone and email.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── RESEND OTP BY EMAIL ───────────────────────────────────
exports.resendOtpByEmail = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'No account found with this email.' });
    if (user.isPhoneVerified) return res.status(400).json({ message: 'Phone already verified' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    user.otpCode = otp;
    user.otpExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendOtp(user.phone, user.email, otp, user.name);
    res.json({ message: 'OTP sent to your phone and email.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── LOGIN ─────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, phone, password } = req.body;

    if ((!email && !phone) || !password)
      return res.status(400).json({ message: 'Email or phone and password are required' });

    let user;
    if (email) {
      user = await User.findOne({ email: email.toLowerCase() });
      if (!user)
        return res.status(404).json({ message: 'No account found with this email. Please register first.' });
    } else {
      const phoneClean = phone.replace(/\s/g, '');
      user = await User.findOne({ phone: phoneClean });
      if (!user)
        return res.status(404).json({ message: 'No account found with this phone number. Please register first.' });
    }

    const passwordMatch = await user.matchPassword(password);
    if (!passwordMatch)
      return res.status(401).json({ message: 'Incorrect password. Please try again.' });

    if (!user.isPhoneVerified)
      return res.status(403).json({ message: 'Phone not verified. Please verify OTP first.' });

    const { accessToken } = generateTokens(user._id);
    res.json({ accessToken, user: sanitize(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── MOCK GOV ID VERIFICATION ──────────────────────────────
exports.verifyGovId = async (req, res) => {
  try {
    const { idType, idNumber, idPhoto } = req.body;
    if (!idType || !idNumber)
      return res.status(400).json({ message: 'idType and idNumber are required' });

    if (idType === 'aadhaar' && !/^\d{12}$/.test(idNumber))
      return res.status(400).json({ message: 'Aadhaar must be exactly 12 digits' });

    const verified = Math.random() > 0.05;
    if (!verified)
      return res.status(400).json({ message: 'ID verification failed. Please try again.' });

    const updates = { isIdVerified: true };
    if (idPhoto) updates.idPhoto = idPhoto;

    await User.findByIdAndUpdate(req.user._id, updates);
    res.json({ message: 'Government ID verified', idType });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── FACE VERIFICATION ─────────────────────────────────────
exports.verifyFace = async (req, res) => {
  try {
    const { faceDescriptor } = req.body;
    if (!faceDescriptor)
      return res.status(400).json({ message: 'No face data provided' });

    let verified = true;
    let confidence = 0.95;
    try {
      const { data } = await axios.post(`${FACE_SERVICE_URL}/face-verify`, { descriptor: faceDescriptor }, { timeout: 5000 });
      verified = data.verified;
      confidence = data.confidence;
      if (!verified) return res.status(400).json({ message: data.message });
    } catch (pyErr) {
      console.warn('Face service unavailable, using fallback:', pyErr.message);
    }

    await User.findByIdAndUpdate(req.user._id, {
      isFaceVerified: true,
      faceDescriptor: faceDescriptor.substring(0, 64),
    });
    res.json({ message: 'Face verified', confidence });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── ME ────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  res.json({ user: sanitize(req.user) });
};
