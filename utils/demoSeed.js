require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { Match, Event, ChatMessage } = require('../models/index');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/sidekick';

const DEMO_USERS = [
  { name: 'Rahul Panda',    email: 'rahul@sidekick-demo.com',   phone: '+919100000001', age: 22, gender: 'male',   city: 'Bhubaneswar', lat: 20.2961, lng: 85.8245, interests: ['Movies', 'Cricket', 'Food', 'Gaming'],        vibeTag: 'The Gamer',        bio: 'Cricket lover & foodie from Bhubaneswar. Always up for a movie night!' },
  { name: 'Priya Mohanty',  email: 'priya@sidekick-demo.com',   phone: '+919100000002', age: 21, gender: 'female', city: 'Bhubaneswar', lat: 20.3000, lng: 85.8300, interests: ['Music', 'Dancing', 'Coffee', 'Travel'],       vibeTag: 'The Musician',     bio: 'Classical dancer & music enthusiast. Love exploring new cafes!' },
  { name: 'Arjun Das',      email: 'arjun@sidekick-demo.com',   phone: '+919100000003', age: 23, gender: 'male',   city: 'Bhubaneswar', lat: 20.2900, lng: 85.8200, interests: ['Adventure', 'Travel', 'Books', 'Coffee'],     vibeTag: 'The Adventurer',   bio: 'Trekking enthusiast. Have visited 15 states. Next stop: Meghalaya!' },
  { name: 'Sneha Rath',     email: 'sneha@sidekick-demo.com',   phone: '+919100000004', age: 20, gender: 'female', city: 'Bhubaneswar', lat: 20.3050, lng: 85.8150, interests: ['Art', 'Books', 'Coffee', 'Movies'],          vibeTag: 'The Artist',       bio: 'Fine arts student. Sketching & painting is my therapy.' },
  { name: 'Vikram Nayak',   email: 'vikram@sidekick-demo.com',  phone: '+919100000005', age: 24, gender: 'male',   city: 'Bhubaneswar', lat: 20.2850, lng: 85.8350, interests: ['Football', 'Gaming', 'Music', 'Food'],        vibeTag: 'The Social Butterfly', bio: 'Football player & gamer. Looking for someone to watch Champions League with!' },
  { name: 'Ananya Mishra',  email: 'ananya@sidekick-demo.com',  phone: '+919100000006', age: 22, gender: 'female', city: 'Berhampur',   lat: 19.3149, lng: 84.7941, interests: ['Travel', 'Food', 'Dancing', 'Movies'],       vibeTag: 'The Foodie',       bio: 'Foodie from Berhampur. Love trying new cuisines and road trips!' },
  { name: 'Rohan Sahoo',    email: 'rohan@sidekick-demo.com',   phone: '+919100000007', age: 25, gender: 'male',   city: 'Cuttack',     lat: 20.4625, lng: 85.8830, interests: ['Books', 'Coffee', 'Art', 'Music'],           vibeTag: 'The Bookworm',     bio: 'Avid reader. Currently reading Atomic Habits. Coffee is life.' },
  { name: 'Divya Swain',    email: 'divya@sidekick-demo.com',   phone: '+919100000008', age: 21, gender: 'female', city: 'Bhubaneswar', lat: 20.2970, lng: 85.8260, interests: ['Fitness', 'Yoga', 'Food', 'Travel'],          vibeTag: 'The Fitness Freak', bio: 'Yoga instructor & fitness freak. Morning runs are my meditation.' },
  { name: 'Karan Behera',   email: 'karan@sidekick-demo.com',   phone: '+919100000009', age: 23, gender: 'male',   city: 'Bhubaneswar', lat: 20.3010, lng: 85.8190, interests: ['Gaming', 'Movies', 'Cricket', 'Food'],        vibeTag: 'The Gamer',        bio: 'Pro gamer & cricket fanatic. IPL season is my favourite time!' },
  { name: 'Pooja Patnaik',  email: 'pooja@sidekick-demo.com',   phone: '+919100000010', age: 22, gender: 'female', city: 'Bhubaneswar', lat: 20.2940, lng: 85.8310, interests: ['Music', 'Art', 'Coffee', 'Books'],            vibeTag: 'The Artist',       bio: 'Singer & painter. Looking for creative souls to collaborate with!' },
];

const EVENTS = [
  {
    title: 'Bhubaneswar Food Walk 🍜',
    description: 'Explore the best street food spots in Old Town Bhubaneswar. From Dahi Bara to Chhena Poda — a foodie\'s paradise!',
    category: 'food',
    date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    timeSlot: 'evening',
    location: { city: 'Bhubaneswar', venue: 'Old Town Market', lat: 20.2961, lng: 85.8245 },
    maxParticipants: 6,
    tags: ['food', 'street food', 'odisha', 'bhubaneswar'],
  },
  {
    title: 'Ekamra Haat Art Exhibition 🎨',
    description: 'Visit the famous Ekamra Haat craft fair together. Explore Odisha\'s rich handicrafts, Pattachitra paintings and tribal art.',
    category: 'hangout',
    date: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    timeSlot: 'afternoon',
    location: { city: 'Bhubaneswar', venue: 'Ekamra Haat', lat: 20.2700, lng: 85.8400 },
    maxParticipants: 4,
    tags: ['art', 'culture', 'odisha', 'handicrafts'],
  },
  {
    title: 'Dhauli Peace Pagoda Trek 🧗',
    description: 'Morning trek to Dhauli Shanti Stupa followed by breakfast. Great views of the Daya River!',
    category: 'sports',
    date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    timeSlot: 'morning',
    location: { city: 'Bhubaneswar', venue: 'Dhauli Hills', lat: 20.1800, lng: 85.8100 },
    maxParticipants: 5,
    tags: ['trek', 'adventure', 'morning', 'nature'],
  },
  {
    title: 'IPL Watch Party 🏏',
    description: 'Watch IPL match together at a sports cafe. Snacks and cricket — perfect combo! CSK vs MI.',
    category: 'sports',
    date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    timeSlot: 'evening',
    location: { city: 'Bhubaneswar', venue: 'Sports Cafe, Saheed Nagar', lat: 20.3000, lng: 85.8350 },
    maxParticipants: 8,
    tags: ['cricket', 'ipl', 'sports', 'fun'],
  },
  {
    title: 'Indie Music Jam Session 🎵',
    description: 'Casual music jam at a rooftop cafe. Bring your instruments or just come to vibe. All genres welcome!',
    category: 'music',
    date: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
    timeSlot: 'evening',
    location: { city: 'Bhubaneswar', venue: 'Rooftop Cafe, Jaydev Vihar', lat: 20.3100, lng: 85.8200 },
    maxParticipants: 10,
    tags: ['music', 'jam', 'indie', 'rooftop'],
  },
  {
    title: 'Chilika Lake Day Trip 🚌',
    description: 'Day trip to Chilika Lake — Asia\'s largest brackish water lagoon. Dolphin spotting, boat rides and fresh seafood!',
    category: 'hangout',
    date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    timeSlot: 'morning',
    location: { city: 'Bhubaneswar', venue: 'Chilika Lake, Satapada', lat: 19.7200, lng: 85.3200 },
    maxParticipants: 6,
    tags: ['travel', 'nature', 'chilika', 'dolphins'],
  },
];

async function seed() {
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected to MongoDB');

  // Find Soumya's account
  const soumya = await User.findOne({ email: 'soumyabisoi10@gmail.com' });
  if (!soumya) {
    console.log('❌ Could not find soumyabisoi10@gmail.com — please register first!');
    process.exit(1);
  }
  console.log(`✅ Found your account: ${soumya.name}`);

  // Update Soumya's profile with rich data
  await User.findByIdAndUpdate(soumya._id, {
    interests: ['Movies', 'Cricket', 'Food', 'Music', 'Travel', 'Gaming'],
    vibeTag: 'The Adventurer',
    bio: 'Hey! I\'m Soumya from Bhubaneswar. Love cricket, movies and exploring new places. Looking for cool companions!',
    age: 22,
    gender: 'male',
    location: { city: 'Bhubaneswar', lat: 20.2961, lng: 85.8245 },
    safetyScore: 98,
    isIdVerified: true,
    isFaceVerified: true,
  });
  console.log('✅ Updated your profile');

  // Clear old demo data
  await User.deleteMany({ email: /@sidekick-demo\.com$/ });
  await Event.deleteMany({ tags: { $in: ['odisha', 'bhubaneswar', 'ipl', 'chilika'] } });
  await Match.deleteMany({ requester: soumya._id });
  await Match.deleteMany({ receiver: soumya._id });
  console.log('🗑️  Cleared old demo data');

  // Create demo users
  const hash = await bcrypt.hash('password123', 12);
  const createdUsers = [];
  for (const u of DEMO_USERS) {
    const user = await User.create({
      ...u,
      passwordHash: hash,
      isPhoneVerified: true,
      isIdVerified: true,
      isFaceVerified: true,
      safetyScore: 90 + Math.floor(Math.random() * 10),
      availability: [
        { day: 'saturday', slots: ['afternoon', 'evening'] },
        { day: 'sunday', slots: ['morning', 'evening'] },
      ],
      location: { city: u.city, lat: u.lat, lng: u.lng },
    });
    createdUsers.push(user);
  }
  console.log(`✅ Created ${createdUsers.length} demo users`);

  // Create events (created by demo users)
  const createdEvents = [];
  for (let i = 0; i < EVENTS.length; i++) {
    const creator = createdUsers[i % createdUsers.length];
    const event = await Event.create({
      ...EVENTS[i],
      creator: creator._id,
      participants: [creator._id, createdUsers[(i + 1) % createdUsers.length]._id],
    });
    createdEvents.push(event);
  }
  console.log(`✅ Created ${createdEvents.length} events`);

  // Create match requests TO Soumya (pending — he needs to accept/reject)
  const pendingRequesters = createdUsers.slice(0, 3);
  for (const u of pendingRequesters) {
    await Match.create({
      requester: u._id,
      receiver: soumya._id,
      status: 'pending',
      chatRoomId: `room_${u._id}_${soumya._id}_${Date.now()}`,
      matchScore: 70 + Math.floor(Math.random() * 25),
    });
  }
  console.log(`✅ Created 3 pending match requests for you`);

  // Create accepted matches (active connections with chat)
  const activePartners = createdUsers.slice(3, 6);
  for (const u of activePartners) {
    const roomId = `room_${soumya._id}_${u._id}_demo`;
    await Match.create({
      requester: soumya._id,
      receiver: u._id,
      status: 'accepted',
      chatRoomId: roomId,
      matchScore: 75 + Math.floor(Math.random() * 20),
    });

    // Add chat messages
    const msgs = [
      { sender: u._id,       content: `Hey ${soumya.name}! Saw your profile, we have so much in common! 😊` },
      { sender: soumya._id,  content: `Hey ${u.name}! Yeah totally! Would love to hang out sometime 🙌` },
      { sender: u._id,       content: `Are you joining the food walk event this weekend?` },
      { sender: soumya._id,  content: `Definitely! Bhubaneswar street food is the best 🍜` },
      { sender: u._id,       content: `Great! See you there 🎉` },
    ];
    for (const m of msgs) {
      await ChatMessage.create({ roomId, sender: m.sender, content: m.content });
    }
  }
  console.log(`✅ Created 3 active matches with chat history`);

  // Add Soumya as participant in 2 events
  await Event.findByIdAndUpdate(createdEvents[0]._id, { $addToSet: { participants: soumya._id } });
  await Event.findByIdAndUpdate(createdEvents[3]._id, { $addToSet: { participants: soumya._id } });
  console.log(`✅ Added you to 2 events`);

  console.log('\n🎉 Demo data seeded successfully!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📧 Your login: soumyabisoi10@gmail.com');
  console.log('🏙️  Your city: Bhubaneswar');
  console.log('🤝 3 pending match requests waiting for you');
  console.log('✅ 3 active connections with chat history');
  console.log('📅 6 upcoming events in Bhubaneswar');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  mongoose.connection.close();
}

seed().catch(err => { console.error('Seed failed:', err); process.exit(1); });
