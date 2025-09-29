const socketIo = require('socket.io');
const Redis = require('redis');
const redisClient = require('../utils/redis');

class SocketHandler {
  constructor(server) {
    // Initialize Redis client
        this.redis = redisClient;

    this.io = socketIo(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    this.userSockets = new Map(); // userId -> socketId
    this.driverSockets = new Map(); // driverId -> socketId
    this.socketUsers = new Map(); // socketId -> userId
    this.socketDrivers = new Map(); // socketId -> driverId
    
    this.initializeSocketEvents();
  }

  initializeSocketEvents() {
    this.io.on('connection', (socket) => {
      console.log('New socket connection:', socket.id);

      // ==================== USER EVENTS ====================
      
      // User joins
    socket.on('user_join', async ({ token }) => {
  const user = await this.verifyUserToken(token);
  if (!user) {
    socket.emit('auth_error', { message: 'Invalid token' });
    return;
  }

  const userId = user._id.toString();
  this.userSockets.set(userId, socket.id);
  this.socketUsers.set(socket.id, userId);

  socket.join(`user_${userId}`);
  socket.emit('user_connected', { message: 'Connected successfully' });

  console.log(`User ${userId} connected with socket ${socket.id}`);
});


      // User books a ride
      socket.on('book_ride', async (data) => {
        console.log(data)
        const userId = this.socketUsers.get(socket.id);
        if (!userId) {
          console.log('User not authenticated');
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        try {
          const rideId = await this.handleRideBooking(userId, data, socket);
          socket.emit('ride_booking_confirmed', { rideId, status: 'searching' });
        } catch (error) {
          console.log(error)
          socket.emit('ride_booking_error', { message: error.message });
        }
      });

      // User cancels ride
      socket.on('cancel_ride', async (data) => {
        const userId = this.socketUsers.get(socket.id);
        const { rideId } = data;
        
        await this.handleRideCancellation(rideId, userId, 'user');
      });

      // ==================== DRIVER EVENTS ====================
      
      // Driver joins
      socket.on('driver_join', async (data) => {
        const { driverId, token } = data;
        
        // Verify driver token
        const driver = await this.verifyDriverToken(token);
        if (!driver) {
          socket.emit('auth_error', { message: 'Invalid token' });
          return;
        }

        // Store driver socket mapping
        console.log(driverId,socket.id)
        this.driverSockets.set(driverId, socket.id);
        this.socketDrivers.set(socket.id, driverId);
        
        socket.join(`driver_${driverId}`);
        
        // Update driver location in Redis
        // await this.updateDriverLocation(driverId, location, vehicleType);
        
//         socket.emit('driver_connected', { message: 'Connected successfully' });
// // Dummy ride object
// const ride = {
//   id: 'ride_67890abcdef12345',
//   pickupLocation: {
//     lat: 23.0225,
//     lng: 72.5714,
//     address: '562/11-A, Gurugram, Haryana'
//   },
//   dropoffLocation: {
//     lat: 23.0525,
//     lng: 72.6014,
//     address: 'Third wave Co, Ahmedabad, Gujarat'
//   },
//   estimatedFare: 213,
//   userName: 'Jayant Misra',
//   userRating: 4.8
// };

// // Dummy driver object
// const driver1 = {
//   driverId: '68ccf475bd1c3db414617b8f',
//   distance: 0.35 // km
// };

// const timeout = 30000; // 30 seconds

// // Your emit statement with dummy data
// this.io.to(`driver_${driverId}`).emit('ride_request', {
//   rideId: ride.id,
//   pickup: ride.pickupLocation,
//   dropoff: ride.dropoffLocation,
//   estimatedFare: ride.estimatedFare,
//   distance: driver.distance,
//   timeout: timeout,
//   userInfo: {
//     name: ride.userName,
//     rating: ride.userRating
//   }
// });
        console.log(`Driver ${driverId} connected with socket ${socket.id}`);
      });

      // Driver location update
      socket.on('update_location', async (data) => {
        const driverId = this.socketDrivers.get(socket.id);
        console.log(driverId)
        if (!driverId) return;

        const { lat, lng, heading } = data;
        await this.updateDriverLocation(driverId, { lat, lng, heading });
        
        // If driver is on a ride, update user about location
        const currentRide = await this.redis.hGet(`driver:${driverId}:status`, 'current_ride');
        if (currentRide) {
          const ride = await this.getRideDetails(currentRide);
          if (ride) {
            this.emitToUser(ride.userId._id, 'driver_location_update', {
              rideId: currentRide,
              location: { lat, lng, heading }
            });
          }
        }
      });


      // Driver accepts ride
      socket.on('accept_ride', async (data) => {
        const driverId = this.socketDrivers.get(socket.id);
        const { rideId } = data;
        
        const result = await this.handleDriverAcceptance(driverId, rideId);
        socket.emit('ride_acceptance_result', result);
      });

      // Driver declines ride
      socket.on('decline_ride', async (data) => {
        const driverId = this.socketDrivers.get(socket.id);
        const { rideId } = data;
        
        await this.handleDriverDecline(driverId, rideId);
      });

      // Driver arrived at pickup
      socket.on('driver_arrived', async (data) => {
        const driverId = this.socketDrivers.get(socket.id);
        const { rideId } = data;
        
        await this.handleDriverArrival(driverId, rideId);
      });

      // Driver starts ride
      socket.on('start_ride', async (data) => {
        const driverId = this.socketDrivers.get(socket.id);
        const { rideId } = data;
        
        await this.handleRideStart(driverId, rideId);
      });

      // Driver completes ride
      socket.on('complete_ride', async (data) => {
        const driverId = this.socketDrivers.get(socket.id);
        const { rideId, finalFare } = data;
        
        await this.handleRideCompletion(driverId, rideId, finalFare);
      });

      // ==================== COMMON EVENTS ====================
      
      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnection(socket);
      });
    });
  }

  // ==================== RIDE BOOKING FLOW ====================
async handleRideBooking(userId, rideData, userSocket) {
  const { pickupLocation, dropoffLocation, vehicleType, estimatedFare } = rideData;

  // Create ride in database
  const ride = await this.createRide({
    userId,
    pickupLocation: {
      lat: pickupLocation.lat,
      lng: pickupLocation.lng,
      address: pickupLocation.address,
      placeId: pickupLocation.placeId
    },
    dropoffLocation: {
      lat: dropoffLocation.lat,
      lng: dropoffLocation.lng,
      address: dropoffLocation.address,
      placeId: dropoffLocation.placeId
    },
    vehicleType,
    estimatedFare,
    status: 'searching'
  });

  console.log(ride, 'ride created');

  // Start searching for drivers
  setTimeout(() => {
    this.searchForDrivers(ride.id, pickupLocation, vehicleType);
  }, 1000);

  return ride.id;
}

async handleNoDriversFound(rideId) {
  try {
    console.log(`No drivers found for ride ${rideId}`);

    // 1. Update ride status to 'no_drivers_found' or 'cancelled'
    await this.updateRideStatus(rideId, 'no_drivers_found');

    // 2. Increment search attempts in ride document
    const ride = await this.getRideDetails(rideId);
    const attempts = (ride.searchAttempts || 0) + 1;
    await this.updateRideSearchAttempts(rideId, attempts);

    // 3. Notify the user about no drivers
    if (ride && ride.userId) {
      this.emitToUser(ride.userId._id.toString(), 'no_drivers_found', {
        rideId,
        message: 'Sorry! No drivers were available nearby at the moment. Please try again.'
      });
    }

    // 4. Optionally, log for analytics or retry mechanism
    console.log(`Ride ${rideId}: user notified about no available drivers.`);
    
  } catch (error) {
    console.error(`Error in handleNoDriversFound for ride ${rideId}:`, error);
  }
}

  async searchForDrivers(rideId, pickupLocation) {
    const { lat, lng } = pickupLocation;
    let searchRadius = 2; // Start with 2km
    const maxRadius = 15; // Maximum 15km
    console.log('ride search')

    while (searchRadius <= maxRadius) {
      const nearbyDrivers = await this.findNearbyDrivers(lat, lng, searchRadius);
      
      if (nearbyDrivers.length > 0) {
        // Found drivers - send requests to top 5
        const selectedDrivers = nearbyDrivers.slice(0, 5);
        await this.sendRideRequestsToDrivers(rideId, selectedDrivers);
        break;
      }
      
      // Expand search radius
      searchRadius += 3;
      
      if (searchRadius > maxRadius) {
        // No drivers found
        await this.handleNoDriversFound(rideId);
        break;
      }
      
      // Wait a bit before expanding search
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
async findNearbyDrivers(lat, lng, radius) {
  const locationKey = `drivers:locations`;
  const availableDrivers = [];

  try {
    // Use geoSearchWith for Redis v4+
    const nearby = await this.redis.geoSearchWith(locationKey,
      { longitude: lng, latitude: lat },
      { radius, unit: 'km' },
      ['WITHDIST']
    );

    for (const driverData of nearby) {
      const driverId = driverData.member;
      const distance = parseFloat(driverData.distance);

      // Check if driver is available and connected
      const isAvailable = await this.redis.hGet(`driver:${driverId}:status`, 'available');
      const isConnected = this.driverSockets.has(driverId);

      if (isAvailable === 'true' && isConnected) {
        availableDrivers.push({
          driverId,
          distance,
          socketId: this.driverSockets.get(driverId)
        });
      }
    }

    // Sort by closest distance
    return availableDrivers.sort((a, b) => a.distance - b.distance);
  } catch (error) {
    console.error('Error finding nearby drivers:', error);
    return [];
  }
}

  async sendRideRequestsToDrivers(rideId, drivers) {
    const ride = await this.getRideDetails(rideId);
    const timeoutDuration = 30000; // 30 seconds
    
    // Store ride request with timeout
    const rideRequestKey = `ride_request:${rideId}`;
    await this.redis.setEx(rideRequestKey, 30, JSON.stringify({
      rideId,
      drivers: drivers.map(d => d.driverId),
      createdAt: Date.now(),
      timeoutAt: Date.now() + timeoutDuration
    }));

    // Update ride status
    await this.updateRideStatus(rideId, 'searching_drivers');

    // Send requests to all drivers simultaneously
    const requestPromises = drivers.map(driver => 
      this.sendRideRequestToDriver(driver, ride, timeoutDuration)
    );
    
    await Promise.all(requestPromises);

    // Set auto-timeout
    setTimeout(() => {
      this.handleRideRequestTimeout(rideId);
    }, timeoutDuration);

    // Notify user about driver search
    this.emitToUser(ride.userId._id.toString(), 'drivers_found', {
      rideId,
      driversCount: drivers.length,
      message: `Found ${drivers.length} nearby drivers. Sending requests...`
    });
  }async handleRideRequestTimeout(rideId) {
  const ride = await this.getRideDetails(rideId);
  if (!ride || ride.status !== 'searching_drivers') return;

  await this.handleNoDriversFound(rideId);
}


  async sendRideRequestToDriver(driver, ride, timeout) {
    try {
      // Mark driver as having pending request
      await this.redis.setEx(`driver:${driver.driverId}:pending_request`, 30, ride.id);

      // Send ride request via socket
      this.io.to(`driver_${driver.driverId}`).emit('ride_request', {
        rideId: ride.id,
        pickup: ride.pickupLocation,
        dropoff: ride.dropoffLocation,
        estimatedFare: ride.estimatedFare,
        distance: driver.distance,
        timeout: timeout,
     userInfo: {
  name: ride.userId?.name,
  rating: ride.userId?.rating
}

      });

      console.log(`Ride request sent to driver ${driver.driverId} for ride ${ride.id}`);
    } catch (error) {
      console.error(`Error sending ride request to driver ${driver.driverId}:`, error);
    }
  }

  // ==================== IMPLEMENT DATABASE METHODS ====================
  
  async createRide(rideData) {
    const Ride = require('../models/Ride'); // Import your Ride model
    const ride = new Ride(rideData);
    await ride.save();
    return ride;
  }

  async getRideDetails(rideId) {
    const Ride = require('../models/Ride');
    const ride = await Ride.findById(rideId).populate('userId', 'name rating');
    return ride;
  }

  async updateRideStatus(rideId, status) {
    const Ride = require('../models/Ride');
    await Ride.findByIdAndUpdate(rideId, { status });
    console.log(`Updated ride ${rideId} status to ${status}`);
  }

  async assignDriverToRide(rideId, driverId) {
    const Ride = require('../models/Ride');
    await Ride.findByIdAndUpdate(rideId, { driverId, acceptedAt: new Date() });
    
    // Update driver status
    await this.redis.hSet(`driver:${driverId}:status`, 'available', 'false');
    await this.redis.hSet(`driver:${driverId}:status`, 'current_ride', rideId);
  }

  async getDriverInfo(driverId) {
    const Driver = require('../models/Driver'); // Import your Driver model
    const driver = await Driver.findById(driverId).select('name phone vehicle rating currentLocation');
    return driver;
  }

  async updateRideSearchAttempts(rideId, attempts) {
    const Ride = require('../models/Ride');
    await Ride.findByIdAndUpdate(rideId, { searchAttempts: attempts });
    console.log(`Updated ride ${rideId} search attempts to ${attempts}`);
  }

  async verifyUserToken(token) {
    const jwt = require('jsonwebtoken');
    const User = require('../models/User');
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      return user;
    } catch (error) {
      return null;
    }
  }

  async verifyDriverToken(token) {
    const jwt = require('jsonwebtoken');
    const Driver = require('../models/Driver');
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const driver = await Driver.findById(decoded.id);
      return driver;
    } catch (error) {
      return null;
    }
  }

  // ==================== REST OF THE METHODS ====================
  // (Include all other methods from the original socket handler)
  
  async handleDriverAcceptance(driverId, rideId) {
    try {
      // Check if ride request is still valid
      const rideRequestKey = `ride_request:${rideId}`;
      const rideRequest = await this.redis.get(rideRequestKey);
      
      if (!rideRequest) {
        return { success: false, message: 'Ride request has expired' };
      }

      const requestData = JSON.parse(rideRequest);
      
      // Verify driver was actually notified
      if (!requestData.drivers.includes(driverId)) {
        return { success: false, message: 'You were not assigned this ride' };
      }

      // Try to accept the ride (atomic operation)
      const lockKey = `ride_lock:${rideId}`;
      const lockAcquired = await this.redis.set(lockKey, driverId, {
        EX: 10,
        NX: true
      });
      
      if (!lockAcquired) {
        return { success: false, message: 'Ride already accepted by another driver' };
      }

      // Accept the ride
      await this.updateRideStatus(rideId, 'accepted');
      await this.assignDriverToRide(rideId, driverId);
      
      // Clean up ride request
      await this.redis.del(rideRequestKey);
      
      // Notify other drivers that ride was taken
      await this.notifyOtherDriversRideTaken(requestData.drivers, driverId, rideId);
      
      // Notify user about acceptance
      const ride = await this.getRideDetails(rideId);
      const driverInfo = await this.getDriverInfo(driverId);
      
      this.emitToUser(ride.userId.toString(), 'ride_accepted', {
        rideId,
        driver: driverInfo,
        message: 'Driver found! Your ride has been accepted.'
      });

      // Clean up lock
      await this.redis.del(lockKey);
      
      return { success: true, message: 'Ride accepted successfully' };
      
    } catch (error) {
      console.error('Error handling driver acceptance:', error);
      return { success: false, message: 'Error processing acceptance' };
    }
  }

  // Add other methods as needed...
  async updateDriverLocation(driverId, location) {
  const { lat, lng, heading } = location;
  const locationKey = `drivers:locations`;

  try {
    // Add/update driver in Redis geospatial index
    await this.redis.geoAdd(locationKey, {
      longitude: lng,
      latitude: lat,
      member: driverId
    });

    // Store detailed location and availability
    await this.redis.hSet(`driver:${driverId}:location`, {
      lat: lat.toString(),
      lng: lng.toString(),
      heading: (heading || 0).toString(),
      updatedAt: Date.now().toString()
    });

    // Mark driver as available if not already set
    const isAvailable = await this.redis.hGet(`driver:${driverId}:status`, 'available');
    if (!isAvailable) {
      await this.redis.hSet(`driver:${driverId}:status`, 'available', 'true');
    }

    console.log(`Driver ${driverId} location updated: ${lat},${lng}`);
  } catch (error) {
    console.error(`Error updating location for driver ${driverId}:`, error);
  }
}

  emitToUser(userId, event, data) {
    console.log(userId)
    this.io.to(`user_${userId}`).emit(event, data);
  }

  emitToDriver(driverId, event, data) {
    this.io.to(`driver_${driverId}`).emit(event, data);
  }

  handleDisconnection(socket) {
    const userId = this.socketUsers.get(socket.id);
    const driverId = this.socketDrivers.get(socket.id);
    
    if (userId) {
      this.userSockets.delete(userId);
      this.socketUsers.delete(socket.id);
      console.log(`User ${userId} disconnected`);
    }
    
    if (driverId) {
      this.driverSockets.delete(driverId);
      this.socketDrivers.delete(socket.id);
      
      // Mark driver as offline
      // this.redisClient.hSet(`driver:${driverId}:status`, 'available', 'false');
       this.redis.hSet(`driver:${driverId}:status`, 'available', 'false');
 this.redis.hDel(`driver:${driverId}:status`, 'current_ride');

      console.log(`Driver ${driverId} disconnected`);
    }
  }

  // Add more methods as needed...
}

// Export the function that creates the SocketHandler instance
module.exports = (server) => {
  return new SocketHandler(server);
};
