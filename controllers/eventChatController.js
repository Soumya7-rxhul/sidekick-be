const axios = require('axios');
const { Event, ChatMessage, Match } = require('../models/index');
const User = require('../models/User');
const { sendEventJoinedEmail, sendEventJoinConfirmEmail } = require('../utils/emailNotifications');

const NLP_URL = process.env.NLP_SERVICE_URL || 'http://localhost:8002';

// ═══════════════════════════════════════════
// EVENT CONTROLLER  v2
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

// ── ICEBREAKER ─────────────────────────────────────────
const ICEBREAKER_TEMPLATES = {
  music:       ['What artist are you obsessed with lately?', 'Favourite song to play on a long drive?', 'Concert you wish you could attend?'],
  movies:      ['Last movie that genuinely surprised you?', 'Comfort film you can rewatch forever?', 'Favourite director of all time?'],
  food:        ['Best dish you\'ve cooked recently?', 'Go-to spot when you\'re craving something good?', 'Street food or fine dining?'],
  sports:      ['Which sport do you actually play vs just watch?', 'Favourite match moment you witnessed live?', 'Morning workout or evening session?'],
  travel:      ['Next destination on your list?', 'Most underrated place you\'ve visited?', 'Mountains or beaches?'],
  gaming:      ['Current game you can\'t put down?', 'PC, console, or mobile?', 'Favourite game of all time?'],
  cafe:        ['Go-to coffee order?', 'Work-from-cafe or just vibes?', 'Best cafe you\'ve discovered recently?'],
  drive:       ['Ideal night drive route?', 'Playlist for a long drive?', 'Windows down or AC on?'],
  study:       ['What are you currently learning?', 'Best study spot you know?', 'Pomodoro or marathon sessions?'],
  hangout:     ['Ideal weekend plan?', 'Indoor hangout or outdoor adventure?', 'Last spontaneous thing you did?'],
  nightwalk:   ['Favourite time to go for a walk?', 'Best neighbourhood to explore at night?', 'Earphones in or just the city sounds?'],
  fitness:     ['Current workout routine?', 'Gym or outdoor training?', 'Favourite cheat meal after a workout?'],
  photography: ['Film or digital?', 'Best photo you\'ve taken recently?', 'Favourite subject to shoot?'],
  concert:     ['Last live show you attended?', 'Dream artist to see live?', 'Front row or back with a good view?'],
  festival:    ['Best festival experience you\'ve had?', 'Local hidden gem festival?', 'Food stalls or main stage?'],
  shopping:    ['Thrift store finds or brand new?', 'Online or in-store shopping?', 'Last thing you bought that made you happy?'],
  default:     ['What\'s been the highlight of your week?', 'Something you\'re looking forward to?', 'Best thing about your city?'],
};

const localIcebreaker = (userA, userB, category) => {
  const common = (userA?.interests || []).filter(i =>
    (userB?.interests || []).map(x => x.toLowerCase()).includes(i.toLowerCase())
  );
  const topic = common[0]?.toLowerCase() || category?.toLowerCase() || 'default';
  const pool = ICEBREAKER_TEMPLATES[topic] || ICEBREAKER_TEMPLATES.default;
  const prompts = [...pool].sort(() => Math.random() - 0.5).slice(0, 3);

  // Inject city context if both share same city
  if (userA?.city && userB?.city && userA.city.toLowerCase() === userB.city.toLowerCase()) {
    prompts[prompts.length - 1] = `Know any hidden gems in ${userA.city}?`;
  }
  return prompts;
};

exports.getIcebreaker = async (req, res) => {
  try {
    const { roomId } = req.params;
    const auth = await authorizeRoom(req.user._id, roomId);
    if (!auth.ok) return res.status(403).json({ message: 'Access denied' });

    // Only show if < 3 messages exist
    const msgCount = await ChatMessage.countDocuments({ roomId });
    if (msgCount >= 3) return res.json({ prompts: [] });

    let userA = null, userB = null, category = null;

    if (auth.type === 'companion') {
      const match = auth.ref;
      [userA, userB] = await Promise.all([
        User.findById(match.requester).select('name interests vibeTag location'),
        User.findById(match.receiver).select('name interests vibeTag location'),
      ]);
      category = null;
    } else {
      const event = auth.ref;
      category = event.category;
      userA = await User.findById(req.user._id).select('name interests vibeTag location');
    }

    const payload = {
      userA: { name: userA?.name, interests: userA?.interests, vibeTag: userA?.vibeTag, city: userA?.location?.city },
      userB: userB ? { name: userB?.name, interests: userB?.interests, vibeTag: userB?.vibeTag, city: userB?.location?.city } : null,
      context: { source: auth.type, category },
    };

    let prompts;
    try {
      const { data } = await axios.post(`${NLP_URL}/icebreaker`, payload, { timeout: 3000 });
      prompts = data.prompts;
    } catch {
      prompts = localIcebreaker(payload.userA, payload.userB, category);
    }

    res.json({ prompts });
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
