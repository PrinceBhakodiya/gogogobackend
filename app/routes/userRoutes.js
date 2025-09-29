// routes/userRoutes.js
const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const rideController = require('../controllers/rideController');

const { authRateLimit, userAuth } = require('../middlewares/authMiddleware');

let socketHandlerInstance;

router.setSocketHandler = (handler) => {
  socketHandlerInstance = handler;
};

// OTP Routes
router.post('/send-otp', authRateLimit(5, 15 * 60 * 1000), userController.sendOTP);
router.post('/verify-otp', authRateLimit(10, 15 * 60 * 1000), userController.verifyOTP);
// router.get('/search-location', userAuth, rideController.searchLocations);

router.get('/search-location', userAuth, rideController.searchLocations);
router.get('/place-details', userAuth, rideController.getPlaceDetails);
router.get('/calculate-fare', userAuth, rideController.calculateFare);

router.post('/:rideId/cancel', userAuth, rideController.cancelRide);
// User profile routes
router.post('/details', userAuth, userController.fillUserDetails);
router.put('/update', userAuth, userController.updateUserDetails);
router.get('/profile', userAuth, userController.getUserProfile);

module.exports = router;
