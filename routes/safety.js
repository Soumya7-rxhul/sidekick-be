const express = require('express');
const router = express.Router();
const axios = require('axios');
const { protect } = require('../middleware/auth');
const User = require('../models/User');

const SAFETY_URL = process.env.SAFETY_SERVICE_URL || 'http://localhost:8003';

// ── GET SAFETY CONTACTS ───────────────────────────────────
router.get('/contacts', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('safetyContacts');
    res.json({ contacts: user.safetyContacts || [] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── ADD SAFETY CONTACT ────────────────────────────────────
router.post('/contacts', protect, async (req, res) => {
  try {
    const { name, phone, email } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ message: 'Contact name is required' });
    if (!phone || !phone.trim()) return res.status(400).json({ message: 'Contact phone is required' });

    const phoneClean = phone.replace(/\s/g, '');
    if (!/^\+?[\d]{10,15}$/.test(phoneClean))
      return res.status(400).json({ message: 'Phone must be 10–15 digits' });

    const user = await User.findById(req.user._id).select('safetyContacts');
    const duplicate = user.safetyContacts.some(c => c.phone === phoneClean);
    if (duplicate) return res.status(400).json({ message: 'This phone number is already in your Safety Circle' });

    const newContact = { name: name.trim(), phone: phoneClean };
    if (email && email.trim()) newContact.email = email.trim().toLowerCase();

    user.safetyContacts.push(newContact);
    await user.save();

    res.status(201).json({ message: 'Contact added successfully', contacts: user.safetyContacts });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── REMOVE SAFETY CONTACT ─────────────────────────────────
router.delete('/contacts/:contactId', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('safetyContacts');
    const before = user.safetyContacts.length;
    user.safetyContacts = user.safetyContacts.filter(
      c => c._id.toString() !== req.params.contactId
    );
    if (user.safetyContacts.length === before)
      return res.status(404).json({ message: 'Contact not found' });

    await user.save();
    res.json({ message: 'Contact removed successfully', contacts: user.safetyContacts });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── SOS ALERT ─────────────────────────────────────────────
router.post('/sos', protect, async (req, res) => {
  try {
    // Re-fetch from DB to get the latest saved contacts (not stale middleware cache)
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
