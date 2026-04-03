const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const ctrl = require('../controllers/matchController');

router.get('/suggestions', protect, ctrl.getMatches);
router.get('/active', protect, ctrl.getMyMatches);
router.get('/pending', protect, ctrl.getPending);
router.post('/request', protect, ctrl.sendRequest);
router.put('/respond', protect, ctrl.respondRequest);
router.put('/cancel', protect, ctrl.cancelRequest);

module.exports = router;
