const { Meetup, Match, Review } = require('../models/index');
const User = require('../models/User');
const { sendMatchRequestEmail } = require('../utils/emailNotifications');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

const sendMeetupEmail = async (toEmail, toName, fromName, action, meetup) => {
  const subjects = {
    proposed: `${fromName} wants to meet you!`,
    accepted: `${fromName} accepted your meetup!`,
    rejected: `${fromName} declined your meetup`,
  };
  const bodies = {
    proposed: `<p>Hi ${toName},</p><p><b>${fromName}</b> has proposed a meetup!</p>
      <div style="background:#1A1535;border-radius:12px;padding:16px;margin:16px 0;color:#F1F0F7">
        <p><b>Date:</b> ${new Date(meetup.date).toDateString()}</p>
        <p><b>Time:</b> ${meetup.time}</p>
        <p><b>Venue:</b> ${meetup.venue}${meetup.city ? ', ' + meetup.city : ''}</p>
        ${meetup.note ? `<p><b>Note:</b> ${meetup.note}</p>` : ''}
      </div>
      <p>Open the app to accept or decline.</p>`,
    accepted: `<p>Hi ${toName},</p><p>Great news! <b>${fromName}</b> accepted your meetup proposal.</p>
      <div style="background:#1A1535;border-radius:12px;padding:16px;margin:16px 0;color:#F1F0F7">
        <p><b>Date:</b> ${new Date(meetup.date).toDateString()}</p>
        <p><b>Time:</b> ${meetup.time}</p>
        <p><b>Venue:</b> ${meetup.venue}${meetup.city ? ', ' + meetup.city : ''}</p>
      </div>`,
    rejected: `<p>Hi ${toName},</p><p><b>${fromName}</b> declined your meetup proposal. You can propose a new time!</p>`,
  };

  try {
    await transporter.sendMail({
      from: `"SideKick" <${process.env.GMAIL_USER}>`,
      to: toEmail,
      subject: subjects[action],
      html: `<div style="font-family:Inter,sans-serif;max-width:480px;background:#0F0B21;color:#F1F0F7;border-radius:16px;overflow:hidden">
        <div style="background:linear-gradient(135deg,#7C3AED,#2DD4BF);padding:20px;text-align:center">
          <h2 style="margin:0;color:white">SideKick Meetup</h2>
        </div>
        <div style="padding:24px">${bodies[action]}</div>
      </div>`,
    });
  } catch (e) { console.warn('Meetup email failed:', e.message); }
};

// ── PROPOSE MEETUP ────────────────────────────────────────
exports.proposeMeetup = async (req, res) => {
  try {
    const { matchId, receiverId, date, time, venue, city, note } = req.body;
    if (!matchId || !receiverId || !date || !time || !venue)
      return res.status(400).json({ message: 'matchId, receiverId, date, time and venue are required' });

    const match = await Match.findOne({
      _id: matchId,
      $or: [{ requester: req.user._id }, { receiver: req.user._id }],
      status: 'accepted',
    });
    if (!match) return res.status(404).json({ message: 'Match not found' });

    // Cancel any existing pending meetup for this match
    await Meetup.updateMany({ matchId, status: 'pending' }, { status: 'cancelled' });

    const meetup = await Meetup.create({
      matchId, proposer: req.user._id, receiver: receiverId,
      date, time, venue, city, note,
    });

    // Send email to receiver
    const receiver = await User.findById(receiverId).select('email name');
    if (receiver) sendMeetupEmail(receiver.email, receiver.name, req.user.name, 'proposed', meetup);

    res.status(201).json({ meetup });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── RESPOND TO MEETUP ─────────────────────────────────────
exports.respondMeetup = async (req, res) => {
  try {
    const { meetupId, action } = req.body;
    if (!meetupId || !['accept', 'reject'].includes(action))
      return res.status(400).json({ message: 'meetupId and action (accept|reject) required' });

    const meetup = await Meetup.findOne({ _id: meetupId, receiver: req.user._id, status: 'pending' });
    if (!meetup) return res.status(404).json({ message: 'Meetup not found' });

    meetup.status = action === 'accept' ? 'accepted' : 'rejected';
    await meetup.save();

    // Email proposer
    const proposer = await User.findById(meetup.proposer).select('email name');
    if (proposer) sendMeetupEmail(proposer.email, proposer.name, req.user.name, action === 'accept' ? 'accepted' : 'rejected', meetup);

    res.json({ meetup });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── GET MEETUPS FOR A MATCH ───────────────────────────────
exports.getMeetups = async (req, res) => {
  try {
    const { matchId } = req.params;
    const meetups = await Meetup.find({ matchId })
      .populate('proposer', 'name profilePhoto')
      .sort({ createdAt: -1 })
      .limit(10);
    res.json({ meetups });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── SIDEKICK SCORE ────────────────────────────────────────
exports.getSideKickScore = async (req, res) => {
  try {
    const userId = req.params.id || req.user._id;
    const user = await User.findById(userId).select('safetyScore isIdVerified isFaceVerified isPhoneVerified interests availability location createdAt');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Get reviews
    const reviews = await Review.find({ reviewee: userId });
    const avgRating = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;

    // Get match stats
    const totalMatches = await Match.countDocuments({
      $or: [{ requester: userId }, { receiver: userId }],
      status: 'accepted',
    });

    // Calculate SideKick Score (0-100)
    let score = 0;
    const breakdown = {};

    // Safety score (30 points max)
    const safetyPoints = Math.round((user.safetyScore / 100) * 30);
    score += safetyPoints;
    breakdown.safety = { points: safetyPoints, max: 30, label: 'Safety Score' };

    // Avg rating (25 points max)
    const ratingPoints = reviews.length ? Math.round((avgRating / 5) * 25) : 0;
    score += ratingPoints;
    breakdown.rating = { points: ratingPoints, max: 25, label: 'Community Rating', avgRating: avgRating.toFixed(1), totalReviews: reviews.length };

    // Verifications (25 points max)
    let verifyPoints = 0;
    if (user.isPhoneVerified) verifyPoints += 8;
    if (user.isIdVerified)    verifyPoints += 10;
    if (user.isFaceVerified)  verifyPoints += 7;
    score += verifyPoints;
    breakdown.verification = { points: verifyPoints, max: 25, label: 'Verified Identity' };

    // Profile completeness (10 points max)
    let profilePoints = 0;
    if (user.interests?.length >= 3) profilePoints += 4;
    if (user.availability?.length >= 1) profilePoints += 3;
    if (user.location?.city) profilePoints += 3;
    score += profilePoints;
    breakdown.profile = { points: profilePoints, max: 10, label: 'Profile Complete' };

    // Activity (10 points max)
    const activityPoints = Math.min(totalMatches * 2, 10);
    score += activityPoints;
    breakdown.activity = { points: activityPoints, max: 10, label: 'Match Activity', totalMatches };

    // Badge
    const badge = score >= 85 ? 'Gold' : score >= 65 ? 'Silver' : score >= 40 ? 'Bronze' : 'Starter';
    const badgeColor = { Gold: '#FBBF24', Silver: '#A8A3C7', Bronze: '#FB923C', Starter: '#6E6893' }[badge];

    res.json({ score, badge, badgeColor, breakdown });
  } catch (err) { res.status(500).json({ message: err.message }); }
};
