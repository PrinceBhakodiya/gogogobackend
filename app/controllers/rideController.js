
// ==================== CREATE: app/controllers/rideController.js ====================
const Ride = require('../models/Ride');
const User = require('../models/User');
const Driver = require('../models/Driver');
const { default: axios } = require('axios');

class RideController {
  
  async getPlaceDetails(req, res) {
  try {
    const { placeId } = req.query;

    if (!placeId) {
      return res.status(400).json({
        success: false,
        message: "placeId is required"
      });
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    const url = `https://maps.googleapis.com/maps/api/place/details/json`;
    const params = {
      place_id: placeId,
      key: apiKey,
      fields: "geometry,name,formatted_address"
    };

    const { data } = await axios.get(url, { params });

    if (data.status !== "OK") {
      return res.status(400).json({
        success: false,
        message: data.error_message || "Failed to fetch place details"
      });
    }

    const details = data.result;

    res.json({
      success: true,
      data: {
        name: details.name,
        address: details.formatted_address,
        lat: details.geometry.location.lat,
        lng: details.geometry.location.lng
      }
    });
  } catch (error) {
    console.error("Get place details error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch place details"
    });
  }
}

  async searchLocations(req, res) {
    try {
      const { query, lat, lng } = req.query;

      if (!query) {
        return res.status(400).json({
          success: false,
          message: "Query is required"
        });
      }

      const apiKey = process.env.GOOGLE_MAPS_API_KEY;

      // Autocomplete with optional location bias
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json`;
      const params = {
        input: query,
        key: apiKey,
        ...(lat && lng ? { location: `${lat},${lng}`, radius: 5000 } : {})
      };

      const { data } = await axios.get(url, { params });

      if (data.status !== "OK") {
        return res.status(400).json({
          success: false,
          message: data.error_message || "Failed to fetch locations"
        });
      }

      // Map predictions to a clean structure
      const locations = data.predictions.map((place) => ({
        placeId: place.place_id,
        description: place.description,
        mainText: place.structured_formatting.main_text,
        secondaryText: place.structured_formatting.secondary_text
      }));

      res.json({
        success: true,
        data: locations
      });
    } catch (error) {
      console.error("Search locations error:", error.response?.data || error.message);
      res.status(500).json({
        success: false,
        message: "Failed to search locations"
      });
    }
  }


async calculateFare(req, res) {
  try {
    const { pickupPlaceId, dropPlaceId, pickupLat, pickupLng, dropLat, dropLng } = req.query;
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    console.log(req.query)

    let pickup = { lat: pickupLat, lng: pickupLng };
    let drop = { lat: dropLat, lng: dropLng };

    // 🔹 Resolve pickup placeId → lat/lng if needed
    if (pickupPlaceId && (!pickupLat || !pickupLng)) {
      const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/details/json", {
        params: { place_id: pickupPlaceId, key: apiKey, fields: "geometry" }
      });
      pickup = data.result.geometry.location;
    }

    // 🔹 Resolve drop placeId → lat/lng if needed
    if (dropPlaceId && (!dropLat || !dropLng)) {
      const { data } = await axios.get("https://maps.googleapis.com/maps/api/place/details/json", {
        params: { place_id: dropPlaceId, key: apiKey, fields: "geometry" }
      });
      drop = data.result.geometry.location;
    }

    if (!pickup.lat || !pickup.lng || !drop.lat || !drop.lng) {
      return res.status(400).json({ success: false, message: "Pickup and drop coordinates are required" });
    }

    // 🔹 Calculate distance using Distance Matrix
    const { data: distData } = await axios.get("https://maps.googleapis.com/maps/api/distancematrix/json", {
      params: {
        origins: `${pickup.lat},${pickup.lng}`,
        destinations: `${drop.lat},${drop.lng}`,
        key: apiKey
      }
    });

    const element = distData.rows[0].elements[0];
    if (element.status !== "OK") {
      return res.status(400).json({ success: false, message: "Failed to fetch distance" });
    }

    const distanceKm = element.distance.value / 1000;
    const duration = element.duration.text;

    // 🔹 Pricing rules (can add more categories later)
    const pricingRules = {
      goelite: { baseFare: 50, perKm: 12, description: "Affordable rides" },
      gosuv:   { baseFare: 100, perKm: 18, description: "Spacious SUV rides" }
    };

    // 🔹 Calculate price for all categories
    const fares = Object.keys(pricingRules).map((type) => {
      const rule = pricingRules[type];
      const price = Math.round(rule.baseFare + distanceKm * rule.perKm);
      return {
        type,
        description: rule.description,
        baseFare: rule.baseFare,
        perKm: rule.perKm,
        distanceKm: parseFloat(distanceKm.toFixed(2)),
        duration,
        total: price
      };
    });

    res.json({
      success: true,
      data: {
        pickup,
        drop,
        fares
      }
    });
  } catch (error) {
    console.error("Fare calculation error:", error.response?.data || error.message);
    res.status(500).json({ success: false, message: "Failed to calculate fare" });
  }
}
  // Calculate pricing based on distance
  async calculatePricing(req, res) {
    try {
      const { pickupLat, pickupLng, dropoffLat, dropoffLng, vehicleType } = req.body;
      
      // Calculate distance (basic haversine formula)
      const distance = this.calculateDistance(pickupLat, pickupLng, dropoffLat, dropoffLng);
      
      // Basic pricing logic
      const baseFare = vehicleType === 'auto' ? 50 : vehicleType === 'sedan' ? 100 : 150;
      const perKmRate = vehicleType === 'auto' ? 12 : vehicleType === 'sedan' ? 15 : 20;
      const estimatedFare = baseFare + (distance * perKmRate);
      const estimatedTime = Math.ceil(distance * 2); // 2 minutes per km estimate
      
      res.json({
        success: true,
        data: {
          distance: parseFloat(distance.toFixed(2)),
          estimatedFare: Math.ceil(estimatedFare),
          estimatedTime,
          breakdown: {
            baseFare,
            distanceFare: Math.ceil(distance * perKmRate),
            total: Math.ceil(estimatedFare)
          }
        }
      });
    } catch (error) {
      console.error('Calculate pricing error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to calculate pricing' 
      });
    }
  }

  // Get available vehicle types
  async getAvailableVehicles(req, res) {
    try {
      const vehicles = [
        {
          type: 'auto',
          name: 'Auto Rickshaw',
          capacity: 3,
          description: 'Affordable rides for short distances',
          baseFare: 50,
          perKmRate: 12,
          estimatedArrival: '2-5 min'
        },
        {
          type: 'sedan',
          name: 'Sedan',
          capacity: 4,
          description: 'Comfortable rides for daily commute',
          baseFare: 100,
          perKmRate: 15,
          estimatedArrival: '3-8 min'
        },
        {
          type: 'suv',
          name: 'SUV',
          capacity: 6,
          description: 'Spacious rides for groups',
          baseFare: 150,
          perKmRate: 20,
          estimatedArrival: '5-10 min'
        }
      ];
      
      res.json({
        success: true,
        data: vehicles
      });
    } catch (error) {
      console.error('Get available vehicles error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to get available vehicles' 
      });
    }
  }

  // Book a ride
  async bookRide(req, res) {
    try {
      const userId = req.user.id;
      const { pickupLocation, dropoffLocation, vehicleType, estimatedFare } = req.body;
      
      // Validate input
      if (!pickupLocation || !dropoffLocation || !vehicleType) {
        return res.status(400).json({
          success: false,
          message: 'Missing required fields'
        });
      }

      // Create ride record
      const ride = new Ride({
        userId,
        pickupLocation,
        dropoffLocation,
        vehicleType,
        estimatedFare,
        status: 'searching',
        createdAt: new Date()
      });

      await ride.save();

      // Get socket handler from app
      const socketHandler = req.app.get('socketHandler');
      
      // Start driver search process via socket
      if (socketHandler && typeof socketHandler.initiateRideSearch === 'function') {
        socketHandler.initiateRideSearch(ride._id, pickupLocation, vehicleType);
      }
      
      res.json({
        success: true,
        data: {
          rideId: ride._id,
          status: 'searching',
          message: 'Searching for nearby drivers...'
        }
      });
      
    } catch (error) {
      console.error('Book ride error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to book ride'
      });
    }
  }

  // Get ride status
  async getRideStatus(req, res) {
    try {
      const { rideId } = req.params;
      const userId = req.user.id;

      const ride = await Ride.findOne({ 
        _id: rideId, 
        userId 
      }).populate('driverId', 'name phone vehicle currentLocation rating');

      if (!ride) {
        return res.status(404).json({
          success: false,
          message: 'Ride not found'
        });
      }

      res.json({
        success: true,
        data: ride
      });
      
    } catch (error) {
      console.error('Get ride status error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get ride status'
      });
    }
  }

  // Cancel ride
  async cancelRide(req, res) {
    try {
      const { rideId } = req.body;
      const userId = req.user.id;

      const ride = await Ride.findOne({ _id: rideId, userId });
      
      if (!ride) {
        return res.status(404).json({
          success: false,
          message: 'Ride not found'
        });
      }

      if (!['searching', 'pending_acceptance', 'accepted'].includes(ride.status)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot cancel ride in current status'
        });
      }

      // Update ride status
      ride.status = 'cancelled';
      ride.cancelledBy = 'user';
      ride.cancelledAt = new Date();
      await ride.save();

      // Notify via socket
      const socketHandler = req.app.get('socketHandler');
      if (socketHandler && typeof socketHandler.handleRideCancellation === 'function') {
        socketHandler.handleRideCancellation(rideId, userId, 'user');
      }

      res.json({
        success: true,
        message: 'Ride cancelled successfully'
      });
      
    } catch (error) {
      console.error('Cancel ride error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to cancel ride'
      });
    }
  }

  // Verify ride OTP
  async verifyRideOTP(req, res) {
    try {
      const { rideId, otp } = req.body;
      const userId = req.user.id;

      const redisClient = req.app.get('redisClient');
      const storedOTP = await redisClient.get(`ride:${rideId}:arrival_otp`);

      if (!storedOTP || storedOTP !== otp) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired OTP'
        });
      }

      // Update ride status to in_progress
      const ride = await Ride.findOneAndUpdate(
        { _id: rideId, userId },
        { 
          status: 'in_progress',
          startedAt: new Date()
        },
        { new: true }
      );

      // Clear OTP
      await redisClient.del(`ride:${rideId}:arrival_otp`);

      // Notify via socket
      const socketHandler = req.app.get('socketHandler');
      if (socketHandler && typeof socketHandler.notifyRideStarted === 'function') {
        socketHandler.notifyRideStarted(rideId);
      }

      res.json({
        success: true,
        message: 'Ride started successfully',
        data: ride
      });
      
    } catch (error) {
      console.error('Verify OTP error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to verify OTP'
      });
    }
  }

  // Rate driver
  async rateDriver(req, res) {
    try {
      const { rideId, rating, feedback } = req.body;
      const userId = req.user.id;

      const ride = await Ride.findOne({ _id: rideId, userId, status: 'completed' });
      
      if (!ride) {
        return res.status(404).json({
          success: false,
          message: 'Ride not found or not completed'
        });
      }

      // Update ride with rating
      ride.userRating = rating;
      ride.userFeedback = feedback;
      await ride.save();

      // Update driver's overall rating
      if (ride.driverId) {
        const driver = await Driver.findById(ride.driverId);
        if (driver) {
          const totalRatings = driver.totalRatings || 0;
          const currentRating = driver.rating || 0;
          
          const newRating = ((currentRating * totalRatings) + rating) / (totalRatings + 1);
          
          await Driver.findByIdAndUpdate(ride.driverId, {
            rating: parseFloat(newRating.toFixed(2)),
            totalRatings: totalRatings + 1
          });
        }
      }

      res.json({
        success: true,
        message: 'Rating submitted successfully'
      });
      
    } catch (error) {
      console.error('Rate driver error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to submit rating'
      });
    }
  }

  // Get user ride history
  async getUserRideHistory(req, res) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 10 } = req.query;

      const rides = await Ride.find({ userId })
        .populate('driverId', 'name phone vehicle rating')
        .sort({ createdAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

      const total = await Ride.countDocuments({ userId });

      res.json({
        success: true,
        data: {
          rides,
          totalPages: Math.ceil(total / limit),
          currentPage: page,
          total
        }
      });
      
    } catch (error) {
      console.error('Get ride history error:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get ride history'
      });
    }
  }

  // Helper method to calculate distance
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const d = R * c;
    return d;
  }

  deg2rad(deg) {
    return deg * (Math.PI/180);
  }
}

module.exports = new RideController();
