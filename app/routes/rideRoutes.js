const express = require('express');
const router = express.Router();
const rideController = require('../controllers/rideController');
const { authMiddleware, userAuth } = require('../middlewares/authMiddleware');

// ==================== USER RIDE ROUTES ====================
// Search and pricing
router.get('/search-locations', userAuth, rideController.searchLocations);
router.post('/calculate-pricing', userAuth, rideController.calculatePricing);
router.get('/available-vehicles', userAuth, rideController.getAvailableVehicles);

// Booking management
router.post('/book', userAuth, rideController.bookRide);
router.get('/status/:rideId', userAuth, rideController.getRideStatus);
router.post('/cancel', userAuth, rideController.cancelRide);

// Ride progression
router.post('/verify-otp', userAuth, rideController.verifyRideOTP);
router.post('/rate-driver', userAuth, rideController.rateDriver);

// User ride history
router.get('/history', userAuth, rideController.getUserRideHistory);

// Test route to verify it's working
router.get('/test', (req, res) => {
  res.json({ 
    success: true, 
    message: 'Ride routes are working!',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
