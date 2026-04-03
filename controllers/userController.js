const axios = require('axios');
const User = require('../models/User');
const { Report, Review, Match } = require('../models/index');

const NLP_URL = process.env.NLP_SERVICE_URL || 'http://localhost:8002';

exports.searchUsers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2)
      return res.status(400).json({ message: 'Query must be at least 2 characters' });

    const me = req.user;
    const existingMatches = await Match.find({
      $or: [{ requester: me._id }, { receiver: me._id }],
    });
    const excludeIds = [
      me._id,
      ...me.blockedUsers,
      ...existingMatches.flatMap(m => [m.requester.toString(), m.receiver.toString()]),
    ];

    const users = await User.find({
      _id: { $nin: excludeIds },
      isPhoneVerified: true,
      isActive: true,
      $or: [
        { name:    { $regex: q.trim(), $options: 'i' } },
        { vibeTag: { $regex: q.trim(), $options: 'i' } },
        { 'location.city': { $regex: q.trim(), $options: 'i' } },
        { interests: { $elemMatch: { $regex: q.trim(), $options: 'i' } } },
      ],
    })
      .select('name age profilePhoto vibeTag interests location safetyScore isIdVerified isFaceVerified')
      .limit(20);

    res.json({ users });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const allowed = ['name', 'age', 'gender', 'bio', 'profilePhoto', 'interests', 'vibeTag', 'availability', 'location', 'safetyContacts'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    // Auto-generate vibe tag from interests
    if (updates.interests && updates.interests.length > 0 && !updates.vibeTag) {
      try {
        const { data } = await axios.post(`${NLP_URL}/vibe-tag`, { interests: updates.interests }, { timeout: 3000 });
        updates.vibeTag = data.vibeTag;
      } catch (nlpErr) {
        console.warn('⚠️ Vibe tag service unavailable:', nlpErr.message);
      }
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true }).select('-passwordHash');
    res.json({ user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('name age gender bio profilePhoto interests vibeTag safetyScore isIdVerified isFaceVerified location');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Check if they have met before
    const prevMatch = await Match.findOne({
      $or: [
        { requester: req.user._id, receiver: req.params.id },
        { requester: req.params.id, receiver: req.user._id },
      ],
      status: 'accepted'
    }).sort({ createdAt: -1 });

    // Get their review of this user
    const myReview = prevMatch ? await Review.findOne({ reviewer: req.user._id, reviewee: req.params.id }) : null;
    const theirReview = prevMatch ? await Review.findOne({ reviewer: req.params.id, reviewee: req.user._id }) : null;

    res.json({ user, metBefore: !!prevMatch, myReview, theirReview, prevMatchId: prevMatch?._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.rateUser = async (req, res) => {
  try {
    const { userId, rating, matchId, review, tags } = req.body;
    if (!userId || !rating || rating < 1 || rating > 5)
      return res.status(400).json({ message: 'userId and rating (1-5) are required' });

    const match = await Match.findOne({
      _id: matchId,
      $or: [{ requester: req.user._id }, { receiver: req.user._id }],
      status: 'accepted'
    });
    if (!match) return res.status(404).json({ message: 'Match not found' });

    // Store rating on match
    const isRequester = match.requester.toString() === req.user._id.toString();
    if (isRequester) match.requesterRating = rating;
    else match.receiverRating = rating;
    await match.save();

    // Save full review
    const existing = await Review.findOne({ reviewer: req.user._id, matchId });
    if (existing) {
      existing.rating = rating;
      existing.review = review || '';
      existing.tags = tags || [];
      await existing.save();
    } else {
      await Review.create({ reviewer: req.user._id, reviewee: userId, matchId, rating, review: review || '', tags: tags || [] });
    }

    // Adjust safety score — clamped to [0, 100] atomically
    const delta = rating >= 4 ? 2 : rating <= 2 ? -5 : 0;
    if (delta !== 0) {
      await User.findByIdAndUpdate(userId, [{
        $set: {
          safetyScore: {
            $min: [100, { $max: [0, { $add: ['$safetyScore', delta] }] }]
          }
        }
      }]);
    }

    res.json({ message: 'Review submitted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getReviews = async (req, res) => {
  try {
    const reviews = await Review.find({ reviewee: req.params.id })
      .populate('reviewer', 'name profilePhoto vibeTag')
      .sort({ createdAt: -1 })
      .limit(20);
    const avg = reviews.length ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : null;
    res.json({ reviews, averageRating: avg, total: reviews.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMyReviewForMatch = async (req, res) => {
  try {
    const review = await Review.findOne({ reviewer: req.user._id, matchId: req.params.matchId });
    res.json({ review });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.blockUser = async (req, res) => {
  try {
    const { userId } = req.body;
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { blockedUsers: userId } });
    res.json({ message: 'User blocked' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.reportUser = async (req, res) => {
  try {
    const { reportedId, reason, description } = req.body;
    await Report.create({ reporter: req.user._id, reported: reportedId, reason, description });
    // Auto-block
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { blockedUsers: reportedId } });
    // Decrease safety score of reported user — clamped to [0, 100]
    await User.findByIdAndUpdate(reportedId, [{
      $set: {
        safetyScore: {
          $min: [100, { $max: [0, { $add: ['$safetyScore', -10] }] }]
        }
      }
    }]);
    res.json({ message: 'Report submitted. User blocked.' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
