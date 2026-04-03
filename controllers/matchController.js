const axios = require('axios');
const User = require('../models/User');
const { Match } = require('../models/index');
const { sendMatchRequestEmail, sendMatchAcceptedEmail, sendMatchRejectedEmail } = require('../utils/emailNotifications');

const PYTHON_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:8000';

// ── LOCAL FALLBACK MATCHING ───────────────────────────────
function localMatch(user, candidates) {
  return candidates.map(c => {
    const userInts = new Set(user.interests || []);
    const candInts = new Set(c.interests || []);
    const intersection = [...userInts].filter(x => candInts.has(x)).length;
    const union = new Set([...userInts, ...candInts]).size;
    const interestScore = union > 0 ? Math.round((intersection / union) * 100) : 0;
    const safetyScore = Math.min(Math.max(c.safetyScore || 100, 0), 100);
    const totalScore = Math.round(0.6 * interestScore + 0.4 * safetyScore);
    return {
      candidateId: c._id.toString(),
      totalScore,
      interestScore,
      availabilityScore: 50,
      distanceScore: 50,
      safetyScore,
    };
  });
}

// ── GET MATCH SUGGESTIONS ─────────────────────────────────
exports.getMatches = async (req, res) => {
  try {
    const me = req.user;
    if (!me.interests || me.interests.length === 0) {
      return res.status(400).json({ message: 'Please complete your profile with interests first' });
    }

    const existingMatches = await Match.find({
      $or: [{ requester: me._id }, { receiver: me._id }],
    });
    const excludeIds = existingMatches.flatMap(m => [
      m.requester.toString(),
      m.receiver.toString(),
    ]);

    const cityFilter = me.location && me.location.city ? { 'location.city': me.location.city } : {};

    const candidates = await User.find({
      _id: { $ne: me._id, $nin: [...me.blockedUsers, ...excludeIds] },
      ...cityFilter,
      isActive: true,
      isPhoneVerified: true,
    }).select('name age gender interests availability location vibeTag profilePhoto safetyScore isIdVerified isFaceVerified');

    if (!candidates.length) {
      return res.json({ matches: [], source: 'no_candidates' });
    }

    const payload = {
      user: {
        id: me._id,
        interests: me.interests,
        availability: me.availability,
        lat: me.location?.lat,
        lng: me.location?.lng,
        safetyScore: me.safetyScore,
      },
      candidates: candidates.map(c => ({
        id: c._id,
        interests: c.interests,
        availability: c.availability,
        lat: c.location?.lat,
        lng: c.location?.lng,
        safetyScore: c.safetyScore,
      })),
    };

    let scoredResults;
    let source = 'python';
    try {
      const { data } = await axios.post(`${PYTHON_URL}/match`, payload, { timeout: 5000 });
      scoredResults = data.results;
    } catch (pyErr) {
      console.warn('⚠️  Python service unavailable, using local fallback:', pyErr.message);
      scoredResults = localMatch(me, candidates);
      source = 'local_fallback';
    }

    const scored = scoredResults
      .filter(r => r.totalScore >= 20)
      .map(r => {
        const user = candidates.find(c => c._id.toString() === r.candidateId);
        return { user, ...r };
      })
      .filter(r => r.user);

    res.json({ matches: scored, source });
  } catch (err) {
    console.error('getMatches error:', err.message);
    res.status(500).json({ message: 'Matching failed. Please try again.' });
  }
};

// ── SEND MATCH REQUEST ────────────────────────────────────
exports.sendRequest = async (req, res) => {
  try {
    const { receiverId, eventId } = req.body;
    if (!receiverId) {
      return res.status(400).json({ message: 'receiverId is required' });
    }
    const existing = await Match.findOne({
      $or: [
        { requester: req.user._id, receiver: receiverId },
        { requester: receiverId, receiver: req.user._id },
      ],
    });
    if (existing) {
      return res.status(400).json({ message: 'Match request already exists' });
    }
    const match = await Match.create({
      requester: req.user._id,
      receiver: receiverId,
      event: eventId || null,
      chatRoomId: `room_${req.user._id}_${receiverId}_${Date.now()}`,
    });

    // Send email to receiver
    const receiver = await User.findById(receiverId).select('email name');
    if (receiver) sendMatchRequestEmail(receiver.email, receiver.name, req.user.name);

    res.status(201).json({ match });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── RESPOND TO REQUEST ────────────────────────────────────
exports.respondRequest = async (req, res) => {
  try {
    const { matchId, action } = req.body;
    if (!matchId || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ message: 'matchId and action (accept|reject) required' });
    }
    const match = await Match.findOne({
      _id: matchId,
      receiver: req.user._id,
      status: 'pending',
    });
    if (!match) {
      return res.status(404).json({ message: 'Match request not found' });
    }
    match.status = action === 'accept' ? 'accepted' : 'rejected';
    await match.save();

    // Send email to requester if accepted or rejected
    if (action === 'accept') {
      const requester = await User.findById(match.requester).select('email name');
      if (requester) sendMatchAcceptedEmail(requester.email, requester.name, req.user.name);
    } else {
      const requester = await User.findById(match.requester).select('email name');
      if (requester) sendMatchRejectedEmail(requester.email, requester.name, req.user.name);
    }

    res.json({ match });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET MY ACTIVE MATCHES ─────────────────────────────────
exports.getMyMatches = async (req, res) => {
  try {
    const matches = await Match.find({
      $or: [{ requester: req.user._id }, { receiver: req.user._id }],
      status: 'accepted',
    })
      .populate('requester receiver', 'name profilePhoto vibeTag isIdVerified isFaceVerified')
      .populate('event', 'title date location');
    res.json({ matches });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── GET PENDING REQUESTS ──────────────────────────────────
exports.getPending = async (req, res) => {
  try {
    const pending = await Match.find({
      receiver: req.user._id,
      status: 'pending',
    }).populate('requester', 'name profilePhoto vibeTag interests age');
    res.json({ pending });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── CANCEL MATCH REQUEST ──────────────────────────────────
exports.cancelRequest = async (req, res) => {
  try {
    const { matchId } = req.body;
    const match = await Match.findOne({
      _id: matchId,
      requester: req.user._id,
      status: 'pending',
    });
    if (!match) return res.status(404).json({ message: 'Pending request not found' });
    match.status = 'cancelled';
    await match.save();
    res.json({ message: 'Match request cancelled' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
