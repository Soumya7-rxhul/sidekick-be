const { Event } = require('../models/index');
const User = require('../models/User');
const { sendEventReminderEmail } = require('./emailNotifications');

const sendReminders = async () => {
  try {
    const now = new Date();

    // Find events happening in 24 hours (±30 min window)
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in24hStart = new Date(in24h.getTime() - 30 * 60 * 1000);
    const in24hEnd   = new Date(in24h.getTime() + 30 * 60 * 1000);

    // Find events happening in 1 hour (±15 min window)
    const in1h = new Date(now.getTime() + 60 * 60 * 1000);
    const in1hStart = new Date(in1h.getTime() - 15 * 60 * 1000);
    const in1hEnd   = new Date(in1h.getTime() + 15 * 60 * 1000);

    const events24h = await Event.find({ date: { $gte: in24hStart, $lte: in24hEnd } });
    const events1h  = await Event.find({ date: { $gte: in1hStart,  $lte: in1hEnd  } });

    for (const event of [...events24h, ...events1h]) {
      const hoursLeft = (new Date(event.date) - now) / (1000 * 60 * 60);
      const allUserIds = [event.creator, ...event.participants];

      for (const userId of allUserIds) {
        try {
          const user = await User.findById(userId).select('email name');
          if (user) {
            await sendEventReminderEmail(
              user.email, user.name,
              event.title, event.date,
              event.location?.city, event.location?.venue,
              hoursLeft
            );
            console.log(`Reminder sent to ${user.email} for "${event.title}"`);
          }
        } catch (e) { console.warn('Reminder failed for user:', e.message); }
      }
    }
  } catch (err) {
    console.error('Reminder scheduler error:', err.message);
  }
};

// Run every hour
const startReminderScheduler = () => {
  console.log('Event reminder scheduler started');
  sendReminders(); // run once on startup
  setInterval(sendReminders, 60 * 60 * 1000); // every hour
};

module.exports = { startReminderScheduler };
