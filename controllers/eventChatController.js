const axios = require('axios');
const { Event, ChatMessage, Match } = require('../models/index');
const User = require('../models/User');
const { sendEventJoinedEmail, sendEventJoinConfirmEmail } = require('../utils/emailNotifications');

const NLP_URL = process.env.NLP_SERVICE_URL || 'http://localhost:8002';

// ═══════════════════════════════════════════
// EVENT CONTROLLER
// ═══════════════════════════════════════════

exports.createEvent = async (req, res) => {
  try {
    const event = await Event.create({ ...req.body, creator: req.user._id });
    res.status(201).json({ event });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getEvents = async (req, res) => {
  try {
    const { city, category, page = 1 } = req.query;
    const filter = { isOpen: true, date: { $gte: new Date() } };
    if (city) filter['location.city'] = city;
    if (category) filter.category = category;

    const events = await Event.find(filter)
      .populate('creator', 'name profilePhoto vibeTag isIdVerified')
      .sort({ date: 1 })
      .limit(20)
      .skip((page - 1) * 20);
    res.json({ events });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.joinEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate('creator', 'email name');
    if (!event || !event.isOpen) return res.status(404).json({ message: 'Event not found or closed' });
    if (event.participants.includes(req.user._id)) {
      return res.status(400).json({ message: 'Already joined' });
    }
    event.participants.push(req.user._id);
    if (event.participants.length >= event.maxParticipants) event.isOpen = false;
    await event.save();

    // Email to joiner
    sendEventJoinConfirmEmail(req.user.email, req.user.name, event.title, event.date, event.location?.city);
    // Email to creator
    if (event.creator._id.toString() !== req.user._id.toString()) {
      sendEventJoinedEmail(event.creator.email, event.creator.name, req.user.name, event.title);
    }

    res.json({ event });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMyEvents = async (req, res) => {
  try {
    const events = await Event.find({
      $or: [{ creator: req.user._id }, { participants: req.user._id }]
    })
    .populate('creator participants', 'name profilePhoto')
    .sort({ date: 1 });
    res.json({ events });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.deleteEvent = async (req, res) => {
  try {
    const event = await Event.findOne({ _id: req.params.id, creator: req.user._id });
    if (!event) return res.status(404).json({ message: 'Event not found or not authorized' });
    await event.deleteOne();
    res.json({ message: 'Event deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ═══════════════════════════════════════════
// CHAT CONTROLLER
// ═══════════════════════════════════════════

// ── SHARED AUTH: companion room OR event room ────────────
const authorizeRoom = async (userId, roomId) => {
  // 1. Companion chat room
  const match = await Match.findOne({
    chatRoomId: roomId,
    $or: [{ requester: userId }, { receiver: userId }],
    status: 'accepted',
  });
  if (match) return { ok: true, type: 'companion', ref: match };

  // 2. Event chat room (roomId format: event_<eventId>)
  if (roomId.startsWith('event_')) {
    const eventId = roomId.replace('event_', '');
    const { Event } = require('../models/index');
    const event = await Event.findById(eventId);
    if (!event) return { ok: false };
    const isMember =
      event.creator.toString() === userId.toString() ||
      event.participants.some(p => p.toString() === userId.toString());
    if (isMember) return { ok: true, type: 'event', ref: event };
  }
  return { ok: false };
};

// ── GET EVENT CHAT ROOM ───────────────────────────────────
exports.getEventChat = async (req, res) => {
  try {
    const { Event } = require('../models/index');
    const event = await Event.findById(req.params.id)
      .populate('creator participants', 'name profilePhoto vibeTag');
    if (!event) return res.status(404).json({ message: 'Event not found' });

    const userId = req.user._id.toString();
    const isMember =
      event.creator._id.toString() === userId ||
      event.participants.some(p => p._id.toString() === userId);
    if (!isMember) return res.status(403).json({ message: 'Join the event to access chat' });

    const roomId = `event_${event._id}`;
    const messages = await ChatMessage.find({ roomId })
      .populate('sender', 'name profilePhoto')
      .sort({ createdAt: 1 })
      .limit(100);

    await ChatMessage.updateMany(
      { roomId, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    res.json({ roomId, event, messages, participants: [event.creator, ...event.participants] });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── SEND MESSAGE WITH MODERATION + SENTIMENT ─────────────
exports.sendMessage = async (req, res) => {
  try {
    const { roomId, content } = req.body;
    if (!roomId || !content) return res.status(400).json({ message: 'roomId and content are required' });

    const auth = await authorizeRoom(req.user._id, roomId);
    if (!auth.ok) return res.status(403).json({ message: 'Access denied' });

    // Run moderation + sentiment in parallel
    let moderation = { flagged: false, action: 'allow' };
    let sentiment = { sentiment: 'neutral', distress_detected: false };
    try {
      const [modRes, sentRes] = await Promise.all([
        axios.post(`${NLP_URL}/moderate`, { message: content }, { timeout: 3000 }),
        axios.post(`${NLP_URL}/sentiment`, { message: content }, { timeout: 3000 }),
      ]);
      moderation = modRes.data;
      sentiment = sentRes.data;
    } catch (nlpErr) {
      console.warn('⚠️ NLP service unavailable:', nlpErr.message);
    }

    if (moderation.action === 'block_and_alert') {
      return res.status(400).json({ message: 'Message blocked: contains harmful content.', flagged: true });
    }

    const msg = await ChatMessage.create({ roomId, sender: req.user._id, content });
    await msg.populate('sender', 'name profilePhoto');

    res.status(201).json({
      message: msg,
      moderation,
      sentiment,
      warned: moderation.action === 'warn_user'
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getChatHistory = async (req, res) => {
  try {
    const { roomId } = req.params;
    const auth = await authorizeRoom(req.user._id, roomId);
    if (!auth.ok) return res.status(403).json({ message: 'Access denied' });

    const messages = await ChatMessage.find({ roomId })
      .populate('sender', 'name profilePhoto')
      .sort({ createdAt: 1 })
      .limit(100);

    // Mark all messages as read by current user
    await ChatMessage.updateMany(
      { roomId, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── SEND VOICE MESSAGE ────────────────────────────────────
exports.sendVoiceMessage = async (req, res) => {
  try {
    const { roomId, voiceData, duration } = req.body;
    if (!roomId || !voiceData) return res.status(400).json({ message: 'roomId and voiceData are required' });

    const auth = await authorizeRoom(req.user._id, roomId);
    if (!auth.ok) return res.status(403).json({ message: 'Access denied' });

    const msg = await ChatMessage.create({
      roomId, sender: req.user._id,
      content: 'Voice message',
      type: 'voice',
      voiceData,
      duration: duration || 0,
    });
    await msg.populate('sender', 'name profilePhoto');
    res.status(201).json({ message: msg });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── ADD REACTION ──────────────────────────────────────────
exports.addReaction = async (req, res) => {
  try {
    const { messageId, emoji } = req.body;
    if (!messageId || !emoji) return res.status(400).json({ message: 'messageId and emoji required' });

    const msg = await ChatMessage.findById(messageId);
    if (!msg) return res.status(404).json({ message: 'Message not found' });

    // Remove existing reaction from this user then add new one
    msg.reactions = msg.reactions.filter(r => r.userId.toString() !== req.user._id.toString());
    msg.reactions.push({ userId: req.user._id, emoji });
    await msg.save();

    res.json({ reactions: msg.reactions });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// ── MARK READ ─────────────────────────────────────────────
exports.markRead = async (req, res) => {
  try {
    const { roomId } = req.body;
    await ChatMessage.updateMany(
      { roomId, sender: { $ne: req.user._id }, readBy: { $ne: req.user._id } },
      { $addToSet: { readBy: req.user._id } }
    );
    res.json({ message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.getMyRooms = async (req, res) => {
  try {
    const matches = await Match.find({
      $or: [{ requester: req.user._id }, { receiver: req.user._id }],
      status: 'accepted'
    }).populate('requester receiver', 'name profilePhoto vibeTag');

    const rooms = await Promise.all(matches.map(async (m) => {
      const last = await ChatMessage.findOne({ roomId: m.chatRoomId }).sort({ createdAt: -1 });
      const other = m.requester._id.toString() === req.user._id.toString() ? m.receiver : m.requester;
      return { roomId: m.chatRoomId, matchId: m._id, other, lastMessage: last };
    }));
    res.json({ rooms });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
