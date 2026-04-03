const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { proposeMeetup, respondMeetup, getMeetups, getSideKickScore } = require('../controllers/meetupController');

router.post('/propose', protect, proposeMeetup);
router.put('/respond', protect, respondMeetup);
router.get('/match/:matchId', protect, getMeetups);
router.get('/score/:id', protect, getSideKickScore);
router.get('/score', protect, getSideKickScore);

module.exports = router;
