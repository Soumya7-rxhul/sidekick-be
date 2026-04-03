require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Must load models after mongoose is available
const User = require('../models/User');

const INTERESTS_POOL = ['🎬 Movies','🏏 Cricket','⚽ Football','🍕 Food','🎵 Music','📚 Books','🎮 Gaming','🧗 Adventure','☕ Coffee','🏖️ Travel','💃 Dancing','🖼️ Art'];
const VIBES = ['🌟 The Adventurer','🍜 The Foodie','📋 The Planner','🎭 The Socialite','🧘 The Chill One','🚀 The Go-Getter'];
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const SLOTS = ['morning','afternoon','evening','night'];

const pick = (arr, n) => [...arr].sort(() => 0.5 - Math.random()).slice(0, n);

const CITY = 'Bhubaneswar';
const BASE_LAT = 20.2961;
const BASE_LNG = 85.8245;

async function seed() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/sidekick';
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');

  // Drop conflicting indexes that don't belong to this schema
  try {
    await mongoose.connection.collection('users').dropIndex('rollnumber_1');
    console.log('🗑️  Dropped conflicting rollnumber_1 index');
  } catch (e) { /* index may not exist, ignore */ }

  await User.deleteMany({ email: /@sidekick-seed\.com$/ });
  console.log('🗑️  Cleared old seed users');

  const hash = await bcrypt.hash('password123', 12);

  const users = [];
  for (let i = 1; i <= 10; i++) {
    const interests = pick(INTERESTS_POOL, Math.floor(Math.random() * 5) + 3);
    const avail = pick(DAYS, 3).map(day => ({ day, slots: pick(SLOTS, 2) }));
    users.push({
      name: `TestUser${i}`,
      email: `user${i}@sidekick-seed.com`,
      phone: `+9190000000${String(i).padStart(2, '0')}`,
      passwordHash: hash,
      isPhoneVerified: true,
      isIdVerified: true,
      isFaceVerified: true,
      age: 20 + i,
      gender: i % 2 === 0 ? 'female' : 'male',
      bio: `Hi! I'm test user ${i}. Looking for companions!`,
      interests,
      vibeTag: VIBES[i % VIBES.length],
      availability: avail,
      location: {
        city: CITY,
        lat: BASE_LAT + (Math.random() - 0.5) * 0.1,
        lng: BASE_LNG + (Math.random() - 0.5) * 0.1,
      },
      safetyScore: 90 + Math.floor(Math.random() * 11),
    });
  }

  await User.insertMany(users);
  console.log(`✅ Created 10 seed users in ${CITY}`);
  console.log('');
  console.log('🔑 Login credentials:');
  console.log('   Email: user1@sidekick-seed.com');
  console.log('   Password: password123');
  console.log('');
  console.log('   (users 1-10 all use password: password123)');
  mongoose.connection.close();
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
