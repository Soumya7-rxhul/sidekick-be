const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getChatHistory, getMyRooms, sendMessage, sendVoiceMessage, addReaction, markRead } = require('../controllers/eventChatController');

router.get('/rooms', protect, getMyRooms);
router.post('/send', protect, sendMessage);
router.post('/voice', protect, sendVoiceMessage);
router.post('/react', protect, addReaction);
router.post('/read', protect, markRead);
router.get('/:roomId', protect, getChatHistory);

module.exports = router;
