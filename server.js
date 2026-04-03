require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const matchRoutes = require('./routes/matches');
const eventRoutes = require('./routes/events');
const chatRoutes = require('./routes/chats');
const reportRoutes = require('./routes/reports');
const safetyRoutes = require('./routes/safety');
const meetupRoutes = require('./routes/meetups');
const { startReminderScheduler } = require('./utils/reminderScheduler');

const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

// Cached DB connection for serverless
let dbConnected = false;
const ensureDB = async (req, res, next) => {
  if (!dbConnected) {
    try {
      await connectDB();
      dbConnected = true;
    } catch (err) {
      return res.status(500).json({ message: 'Database connection failed. Check MONGO_URI env var on Vercel.' });
    }
  }
  next();
};

app.get('/', (req, res) => res.json({ status: 'ok', service: 'sidekick-backend', message: 'SideKick API is running 🤝' }));
app.get('/health', (req, res) => res.json({ status: 'ok', mongo_uri_set: !!process.env.MONGO_URI, jwt_secret_set: !!process.env.JWT_SECRET }));

// Start reminder scheduler
if (require.main === module) startReminderScheduler();

app.use('/api/auth', ensureDB, authRoutes);
app.use('/api/users', ensureDB, userRoutes);
app.use('/api/matches', ensureDB, matchRoutes);
app.use('/api/events', ensureDB, eventRoutes);
app.use('/api/chats', ensureDB, chatRoutes);
app.use('/api/reports', ensureDB, reportRoutes);
app.use('/api/safety', ensureDB, safetyRoutes);
app.use('/api/meetups', ensureDB, meetupRoutes);

app.use((req, res) => res.status(404).json({ message: `Route ${req.method} ${req.path} not found` }));
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

// Local dev only
if (require.main === module) {
  const http = require('http');
  const { Server } = require('socket.io');
  const { initSocket } = require('./utils/socket');
  const server = http.createServer(app);
  const io = new Server(server, { cors: { origin: '*' } });
  initSocket(io);
  const PORT = process.env.PORT || 5000;
  connectDB().then(() => server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`)));
}

module.exports = app;
