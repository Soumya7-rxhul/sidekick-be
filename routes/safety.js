const express = require('express');
const router = express.Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');
const User = require('../models/User');

const SAFETY_URL = process.env.SAFETY_SERVICE_URL || 'http://localhost:8003';

// ── SOS ALERT ─────────────────────────────────────────────
router.post('/sos', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('name phone email safetyContacts location');
    if (!user.safetyContacts || user.safetyContacts.length === 0) {
      return res.status(400).json({ message: 'No safety contacts found. Add contacts in your Safety Circle first.' });
    }
    const { message, location } = req.body;
    const payload = {
      userName: user.name,
      userPhone: user.phone,
      userEmail: user.email,
      location: location || user.location || {},
      safetyContacts: user.safetyContacts,
      message: message || 'I need help! Please contact me immediately.',
    };
    const { data } = await axios.post(`${SAFETY_URL}/sos`, payload, { timeout: 10000 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ICEBREAKER ────────────────────────────────────────────
router.post('/icebreaker', protect, async (req, res) => {
  try {
    const { targetUserId } = req.body;
    if (!targetUserId) return res.status(400).json({ message: 'targetUserId is required' });
    const target = await User.findById(targetUserId).select('interests');
    if (!target) return res.status(404).json({ message: 'User not found' });
    const { data } = await axios.post(`${SAFETY_URL}/icebreaker`, {
      interests_a: req.user.interests || [],
      interests_b: target.interests || [],
    }, { timeout: 5000 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── WEATHER ───────────────────────────────────────────────
router.get('/weather', protect, async (req, res) => {
  try {
    const city = req.query.city || req.user.location?.city || 'Bhubaneswar';
    const { data } = await axios.post(`${SAFETY_URL}/weather`, { city }, { timeout: 8000 });
    res.json(data);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
