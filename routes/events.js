const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { createEvent, getEvents, joinEvent, getMyEvents, deleteEvent } = require('../controllers/eventChatController');

router.get('/', protect, getEvents);
router.post('/', protect, createEvent);
router.get('/mine', protect, getMyEvents);
router.post('/:id/join', protect, joinEvent);
router.put('/:id', protect, async (req, res) => {
  try {
    const { Event } = require('../models/index');
    const event = await Event.findOne({ _id: req.params.id, creator: req.user._id });
    if (!event) return res.status(404).json({ message: 'Event not found or not authorized' });
    const allowed = ['title', 'description', 'category', 'date', 'timeSlot', 'location', 'maxParticipants', 'tags'];
    allowed.forEach(k => { if (req.body[k] !== undefined) event[k] = req.body[k]; });
    await event.save();
    res.json({ event });
  } catch (err) { res.status(500).json({ message: err.message }); }
});
router.delete('/:id', protect, deleteEvent);

module.exports = router;
