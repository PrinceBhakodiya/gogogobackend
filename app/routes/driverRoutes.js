
const express = require("express");
const multer = require("../middlewares/multer.js");
const { authMiddleware, authRateLimit, driverAuth } = require('../middlewares/authMiddleware');
const {getProfile,
  sendOTP,           // Add this function
  verifyOtp,
  saveVehicle,
  savePersonal,
  uploadDoc,
  saveBackground,
  getStatus,
  toggleAvailability,
  updateLocation,
  getEarnings,getTripDetails,
  getTripHistory,
  getDailyEarningsDetail,
  getCurrentRide
} = require("../controllers/driverController.js");

const driverRouter = express.Router();

// ==================== AUTHENTICATION ROUTES ====================
// OTP Routes (with rate limiting to prevent spam)
driverRouter.post("/auth/send-otp",  sendOTP);
driverRouter.post("/auth/verify-otp",  verifyOtp);

// ==================== ONBOARDING ROUTES (Protected) ====================
// All onboarding routes require authentication
driverRouter.post("/onboarding/vehicle", driverAuth, saveVehicle);
driverRouter.post("/onboarding/personal", driverAuth, savePersonal);
// driverRouter.post("/onboarding/aadhaar", driverAuth, multer.array("files", 2), uploadDoc);

driverRouter.post("/onboarding/upload-doc", driverAuth, multer.array("files", 2), uploadDoc);
driverRouter.post("/onboarding/background", driverAuth, saveBackground);
driverRouter.get("/onboarding/status", driverAuth, getStatus);

// ==================== DRIVER PROFILE ROUTES ====================
// Add these for driver profile management
driverRouter.get("/profile", driverAuth, getProfile);
// driverRouter.put("/profile/update", driverAuth, updateProfi);

// driverRouter.put("/profile/update", authMiddleware, updateProfile);
// ==================== DRIVER PROFILE ROUTES ====================
driverRouter.get("/profile", driverAuth, getProfile);
// driverRouter.post("/toggle-availability", driverAuth, toggleAvailability);

driverRouter.post("/location/update", driverAuth, updateLocation);
driverRouter.post("/toggle-availability", driverAuth, toggleAvailability);

// ==================== EARNINGS & HISTORY ROUTES ====================
// Earnings routes
driverRouter.get("/earnings", driverAuth, getEarnings);
driverRouter.get("/earnings/daily", driverAuth, getDailyEarningsDetail);

// Trip history routes
driverRouter.get("/getCurrentRide", driverAuth, getCurrentRide);

driverRouter.get("/history", driverAuth, getTripHistory);
driverRouter.get("/history/:tripId", driverAuth, getTripDetails);

// // ==================== DRIVER LOCATION & STATUS ROUTES ====================
// // These will be used for real-time driver tracking
// driverRouter.post("/location/update", authMiddleware, updateLocation);
// driverRouter.post("/status/toggle", authMiddleware, toggleAvailability);
// driverRouter.get("/status/current", authMiddleware, getCurrentStatus);

// ==================== TEST ROUTE ====================
driverRouter.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "Driver routes are working!",
    timestamp: new Date().toISOString(),
    availableRoutes: [
      "POST /auth/send-otp",
      "POST /auth/verify-otp", 
      "POST /onboarding/vehicle",
      "POST /onboarding/personal",
      "POST /onboarding/upload-doc",
      "POST /onboarding/background",
      "GET /onboarding/status"
    ]
  });
});

module.exports = driverRouter;
