const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },

  // Verification
  isPhoneVerified: { type: Boolean, default: false },
  isIdVerified: { type: Boolean, default: false },
  isFaceVerified: { type: Boolean, default: false },
  otpCode: String,
  otpExpiry: Date,
  // Auto-expire unverified signup records after 24 h (TTL index below)
  signupCreatedAt: { type: Date, default: null },

  // Profile
  age: Number,
  gender: { type: String, enum: ['male', 'female', 'non-binary', 'prefer-not-to-say'] },
  bio: { type: String, maxlength: 200 },
  profilePhoto: String,
  idPhoto: String,
  faceDescriptor: String,

  // Matching data
  interests: [{ type: String }], // ['movies', 'sports', 'food', 'music', ...]
  vibeTag: String, // 'The Adventurer', 'The Foodie', etc.
  availability: [{
    day: String, // 'monday', 'saturday', etc.
    slots: [String] // 'morning', 'afternoon', 'evening', 'night'
  }],
  location: {
    city: String,
    lat: Number,
    lng: Number
  },

  // Safety
  safetyContacts: [{
    name: String,
    phone: String,
    email: String
  }],
  safetyScore: { type: Number, default: 100, min: 0, max: 100 },
  blockedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isActive: { type: Boolean, default: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' }
}, { timestamps: true });

UserSchema.methods.matchPassword = async function(password) {
  return bcrypt.compare(password, this.passwordHash);
};

// TTL index: MongoDB auto-deletes unverified records 24 h after signupCreatedAt.
// For verified users signupCreatedAt is cleared (set to null), so they are never deleted.
UserSchema.index(
  { signupCreatedAt: 1 },
  { expireAfterSeconds: 86400, partialFilterExpression: { isPhoneVerified: false } }
);

module.exports = mongoose.model('User', UserSchema);
