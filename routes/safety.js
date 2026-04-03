const express = require('express');
const router = express.Router();
const axios = require('axios');
const nodemailer = require('nodemailer');
const { protect } = require('../middleware/auth');
const User = require('../models/User');

const SAFETY_URL = process.env.SAFETY_SERVICE_URL || 'http://localhost:8003';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

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

// ── SOS ALERT (direct nodemailer — no Python dependency) ──
router.post('/sos', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('name phone email safetyContacts location');

    if (!user.safetyContacts || user.safetyContacts.length === 0)
      return res.status(400).json({ message: 'No safety contacts found. Add contacts in your Safety Circle first.' });

    const { message, location } = req.body;
    const city = location?.city || user.location?.city || 'Unknown location';
    const lat  = location?.lat  || user.location?.lat  || '';
    const lng  = location?.lng  || user.location?.lng  || '';
    const mapsLink = (lat && lng)
      ? `https://maps.google.com/?q=${lat},${lng}`
      : `https://maps.google.com/?q=${encodeURIComponent(city)}`;
    const alertMsg  = message || 'I need help! Please contact me immediately.';
    const timestamp = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

    const buildHtml = (contactName) => `
      <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;background:#0F0B21;color:#F1F0F7;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#F43F5E,#FB923C);padding:24px;text-align:center">
          <h1 style="margin:0;font-size:24px;font-weight:800;color:white">🚨 SOS ALERT</h1>
          <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:14px">Emergency alert from SideKick</p>
        </div>
        <div style="padding:28px">
          <p style="color:#A8A3C7;font-size:15px">Hi <b style="color:#F1F0F7">${contactName}</b>,</p>
          <p style="color:#F87171;font-size:16px;font-weight:700">⚠️ ${user.name} has triggered an SOS alert and may need your help!</p>
          <div style="background:#1A1535;border:1px solid rgba(244,63,94,0.3);border-radius:12px;padding:16px;margin:16px 0">
            <p style="margin:4px 0;color:#A8A3C7">👤 <b style="color:#F1F0F7">Name:</b> ${user.name}</p>
            <p style="margin:4px 0;color:#A8A3C7">📱 <b style="color:#F1F0F7">Phone:</b> ${user.phone}</p>
            <p style="margin:4px 0;color:#A8A3C7">📍 <b style="color:#F1F0F7">Location:</b> ${city}</p>
            <p style="margin:4px 0;color:#A8A3C7">🕐 <b style="color:#F1F0F7">Time:</b> ${timestamp}</p>
            <p style="margin:4px 0;color:#A8A3C7">💬 <b style="color:#F1F0F7">Message:</b> ${alertMsg}</p>
          </div>
          <a href="${mapsLink}" style="display:inline-block;margin-top:8px;padding:12px 28px;background:linear-gradient(135deg,#F43F5E,#FB923C);color:white;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px">📍 View Location on Map</a>
          <p style="color:#6E6893;font-size:12px;margin-top:20px">Please contact ${user.name} immediately or call emergency services if needed.</p>
        </div>
      </div>
    `;

    let alertsSent = 0;
    const failed = [];

    for (const contact of user.safetyContacts) {
      // Use contact's own email if set, otherwise fall back to the logged-in user's email
      const toEmail = (contact.email || '').trim() || user.email;
      if (!toEmail) { failed.push(contact.name); continue; }

      try {
        await transporter.sendMail({
          from: `"SideKick Safety" <${process.env.GMAIL_USER}>`,
          to: toEmail,
          subject: `🚨 SOS ALERT from ${user.name} — SideKick Emergency`,
          html: buildHtml(contact.name),
        });
        alertsSent++;
      } catch (mailErr) {
        console.error(`SOS email failed for ${contact.name}:`, mailErr.message);
        failed.push(contact.name);
      }
    }

    res.json({
      success: alertsSent > 0,
      alertsSent,
      failed,
      message: alertsSent > 0
        ? `SOS alert sent to ${alertsSent} contact(s).`
        : 'Failed to send alerts. Check GMAIL_USER and GMAIL_PASS in Vercel environment variables.',
      timestamp,
    });
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
