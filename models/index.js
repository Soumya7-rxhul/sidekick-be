const mongoose = require('mongoose');

// ─── MATCH ───────────────────────────────────────────────
const MatchSchema = new mongoose.Schema({
  requester: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  event: { type: mongoose.Schema.Types.ObjectId, ref: 'Event' },
  status: { type: String, enum: ['pending', 'accepted', 'rejected', 'cancelled'], default: 'pending' },
  matchScore: Number,
  interestScore: Number,
  distanceScore: Number,
  availabilityScore: Number,
  safetyScore: Number,
  chatRoomId: String,
  requesterRating: { type: Number, min: 1, max: 5 },
  receiverRating: { type: Number, min: 1, max: 5 },
}, { timestamps: true });

// ─── EVENT ───────────────────────────────────────────────
const EventSchema = new mongoose.Schema({
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  description: String,
  category: String,
  date: { type: Date, required: true },
  timeSlot: String,
  location: { city: String, venue: String, lat: Number, lng: Number },
  maxParticipants: { type: Number, default: 2 },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isOpen: { type: Boolean, default: true },
  tags: [String],
}, { timestamps: true });

// ─── CHAT MESSAGE ─────────────────────────────────────────
const ChatMessageSchema = new mongoose.Schema({
  roomId:    { type: String, required: true, index: true },
  sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  content:   { type: String, default: '' },
  type:      { type: String, enum: ['text', 'voice', 'system'], default: 'text' },
  voiceData: { type: String },   // base64 audio
  duration:  { type: Number },   // voice duration in seconds
  readBy:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  reactions: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    emoji:  { type: String },
  }],
}, { timestamps: true });

// ─── REPORT ───────────────────────────────────────────────
const ReportSchema = new mongoose.Schema({
  reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reported: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: {
    type: String,
    enum: ['harassment', 'fake_profile', 'inappropriate_behavior', 'spam', 'no_show', 'other'],
    required: true
  },
  description: String,
  status: { type: String, enum: ['pending', 'reviewed', 'resolved'], default: 'pending' },
  adminNote: String,
}, { timestamps: true });

// ─── REVIEW ───────────────────────────────────────────────
const ReviewSchema = new mongoose.Schema({
  reviewer:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reviewee:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  matchId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true },
  rating:     { type: Number, min: 1, max: 5, required: true },
  review:     { type: String, maxlength: 300 },
  tags:       [{ type: String }],
}, { timestamps: true });

// ─── MEETUP ──────────────────────────────────────────────
const MeetupSchema = new mongoose.Schema({
  matchId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Match', required: true },
  proposer:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  receiver:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date:      { type: Date, required: true },
  time:      { type: String, required: true },
  venue:     { type: String, required: true },
  city:      { type: String },
  note:      { type: String, maxlength: 200 },
  status:    { type: String, enum: ['pending', 'accepted', 'rejected', 'cancelled'], default: 'pending' },
}, { timestamps: true });

module.exports = {
  Match: mongoose.model('Match', MatchSchema),
  Event: mongoose.model('Event', EventSchema),
  ChatMessage: mongoose.model('ChatMessage', ChatMessageSchema),
  Report: mongoose.model('Report', ReportSchema),
  Review: mongoose.model('Review', ReviewSchema),
  Meetup: mongoose.model('Meetup', MeetupSchema),
};
