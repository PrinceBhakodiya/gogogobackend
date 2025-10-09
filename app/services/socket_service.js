const socketIo = require('socket.io');
const Redis = require('redis');
const redisClient = require('../utils/redis');
const cron = require('node-cron');

class SocketHandler {
  constructor(server) {
    this.redis = redisClient;

    this.io = socketIo(server, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });
    
    // Socket mappings
    this.userSockets = new Map();
    this.driverSockets = new Map();
    this.adminSockets = new Map();
    this.socketUsers = new Map();
    this.socketDrivers = new Map();
    this.socketAdmins = new Map();
    
    this.initializeSocketEvents();
    this.initializeScheduledRideChecker();
  }

  initializeScheduledRideChecker() {
    // Check every minute for scheduled rides (outstation)
    cron.schedule('* * * * *', async () => {
      await this.checkScheduledRides();
    });
  }

  async checkScheduledRides() {
    try {
      const Ride = require('../models/Ride');
      const now = new Date();
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

      const scheduledRides = await Ride.find({
        rideType: 'outstation',
        status: 'scheduled',
        scheduledTime: {
          $gte: now,
          $lte: oneHourFromNow
        },
        driverId: null,
        searchingStarted: { $ne: true }
      });

      for (const ride of scheduledRides) {
        const timeDiff = ride.scheduledTime - now;
        const minutesUntilRide = Math.floor(timeDiff / (1000 * 60));

        if (minutesUntilRide <= 60) {
          await this.startDriverSearch(ride);
        }
      }
    } catch (error) {
      console.error('Error checking scheduled rides:', error);
    }
  }

  // ==================== HISTORY & ANALYTICS METHODS ====================

  async getDriverResponseHistory(driverId) {
    try {
      const Driver = require('../models/Driver');
      const driver = await Driver.findById(driverId);

      if (!driver) {
        return { error: 'Driver not found' };
      }

      // Get acceptances from Redis
      const acceptanceKey = `driver:${driverId}:acceptances`;
      const acceptancesData = await this.redis.lRange(acceptanceKey, 0, -1);
      const acceptances = acceptancesData.map(data => JSON.parse(data));

      // Get declines from Redis
      const declineKey = `driver:${driverId}:declines`;
      const declinesData = await this.redis.lRange(declineKey, 0, -1);
      const declines = declinesData.map(data => JSON.parse(data));

      // Get from database for comprehensive history
      const Ride = require('../models/Ride');
      const rideResponses = await Ride.find({
        'driverResponses.driverId': driverId
      }).select('_id rideType driverResponses createdAt estimatedFare pickupLocation dropoffLocation');

      const driverResponses = rideResponses.map(ride => {
        const response = ride.driverResponses.find(
          r => r.driverId.toString() === driverId
        );
        return {
          rideId: ride._id,
          rideType: ride.rideType,
          response: response.response,
          reason: response.reason,
          respondedAt: response.respondedAt,
          fare: ride.estimatedFare,
          route: `${ride.pickupLocation.address} to ${ride.dropoffLocation.address}`
        };
      });

      return {
        driverId,
        driverName: driver.name,
        driverPhone: driver.phone,
        totalAcceptances: driver.totalAcceptances || 0,
        totalDeclines: driver.totalDeclines || 0,
        acceptanceRate: driver.totalAcceptances && driver.totalDeclines 
          ? ((driver.totalAcceptances / (driver.totalAcceptances + driver.totalDeclines)) * 100).toFixed(2) + '%'
          : 'N/A',
        recentAcceptances: acceptances.slice(0, 20),
        recentDeclines: declines.slice(0, 20),
        allResponses: driverResponses
      };

    } catch (error) {
      console.error('Error getting driver history:', error);
      return { error: 'Error fetching driver history' };
    }
  }

  async getRideResponseHistory(rideId) {
    try {
      const Ride = require('../models/Ride');
      const ride = await Ride.findById(rideId)
        .populate('userId', 'name phone')
        .populate('driverId', 'name phone vehicle rating');

      if (!ride) {
        return { error: 'Ride not found' };
      }

      // Get decline history from Redis
      const rideDeclineKey = `ride:${rideId}:declines`;
      const declinesData = await this.redis.lRange(rideDeclineKey, 0, -1);
      const redisDeclines = declinesData.map(data => JSON.parse(data));

      // Get acceptance from Redis
      const rideAcceptanceKey = `ride:${rideId}:acceptance`;
      const acceptanceData = await this.redis.get(rideAcceptanceKey);
      const redisAcceptance = acceptanceData ? JSON.parse(acceptanceData) : null;

      return {
        rideId,
        rideType: ride.rideType,
        status: ride.status,
        user: ride.userId,
        assignedDriver: ride.driverId,
        route: {
          pickup: ride.pickupLocation,
          dropoff: ride.dropoffLocation
        },
        estimatedFare: ride.estimatedFare,
        driverResponses: ride.driverResponses,
        redisDeclines,
        redisAcceptance,
        responseStats: {
          totalNotified: ride.driverResponses.length,
          accepted: ride.driverResponses.filter(r => r.response === 'accepted').length,
          declined: ride.driverResponses.filter(r => r.response === 'declined').length,
          noResponse: ride.driverResponses.filter(r => r.response === 'no_response').length
        }
      };

    } catch (error) {
      console.error('Error getting ride response history:', error);
      return { error: 'Error fetching ride response history' };
    }
  }
  initializeSocketEvents() {
    this.io.on('connection', (socket) => {
      console.log('New socket connection:', socket.id);

      // ==================== USER EVENTS ====================
      
      socket.on('user_join', async (data) => {
        const { token, userId } = data;
        
        let user = null;
        
        // Verify with token or userId
        if (token) {
          user = await this.verifyUserToken(token);
        } else if (userId) {
          const User = require('../models/User');
          user = await User.findById(userId);
        }

        if (!user) {
          socket.emit('auth_error', { message: 'Invalid credentials' });
          return;
        }

        const userIdStr = user._id.toString();
        this.userSockets.set(userIdStr, socket.id);
        this.socketUsers.set(socket.id, userIdStr);

        socket.join(`user_${userIdStr}`);
        socket.emit('user_connected', { 
          message: 'Connected successfully',
          userId: userIdStr 
        });

        console.log(`User ${userIdStr} connected with socket ${socket.id}`);
      });

      // Unified ride booking for all types
      socket.on('book_ride', async (data) => {
        const userId = this.socketUsers.get(socket.id);
        
        if (!userId) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        try {
          const result = await this.handleRideBooking(userId, data);
          socket.emit('ride_booking_confirmed', result);
        } catch (error) {
          console.error('Ride booking error:', error);
          socket.emit('ride_booking_error', { message: error.message });
        }
      });

      // Cancel ride search
      socket.on('cancel_ride_search', async (data) => {
        const userId = this.socketUsers.get(socket.id);
        
        if (!userId) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        try {
          await this.handleUserCancelSearch(userId, data.rideId);
          socket.emit('ride_search_cancelled', { 
            rideId: data.rideId,
            message: 'Ride search cancelled successfully' 
          });
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      // User cancels confirmed ride
      socket.on('user_cancel_ride', async (data) => {
        const userId = this.socketUsers.get(socket.id);
        
        if (!userId) {
          socket.emit('error', { message: 'User not authenticated' });
          return;
        }

        try {
          await this.handleUserCancelRide(userId, data.rideId, data.reason);
          socket.emit('ride_cancelled', { 
            rideId: data.rideId,
            message: 'Ride cancelled successfully' 
          });
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      // ==================== DRIVER EVENTS ====================
      
      socket.on('driver_join', async (data) => {
        const { token, driverId } = data;
        
        let driver = null;
        
        // Verify with token or driverId
        if (token) {
          driver = await this.verifyDriverToken(token);
        } else if (driverId) {
          const Driver = require('../models/Driver');
          driver = await Driver.findById(driverId);
        }

        if (!driver) {
          socket.emit('auth_error', { message: 'Invalid credentials' });
          return;
        }

        const driverIdStr = driver._id.toString();
        this.driverSockets.set(driverIdStr, socket.id);
        this.socketDrivers.set(socket.id, driverIdStr);
        
        socket.join(`driver_${driverIdStr}`);
        socket.emit('driver_connected', { 
          message: 'Connected successfully',
          driverId: driverIdStr 
        });
        
        console.log(`Driver ${driverIdStr} connected with socket ${socket.id}`);
      });

      // Driver accepts ride (works for all ride types)
      socket.on('accept_ride', async (data) => {
        const driverId = this.socketDrivers.get(socket.id);
        
        if (!driverId) {
          socket.emit('error', { message: 'Driver not authenticated' });
          return;
        }

        const { rideId } = data;
        const result = await this.handleDriverAcceptance(driverId, rideId);
        socket.emit('ride_acceptance_result', result);
      });

      // Driver declines ride
      socket.on('decline_ride', async (data) => {
        const driverId = this.socketDrivers.get(socket.id);
        
        if (!driverId) {
          socket.emit('error', { message: 'Driver not authenticated' });
          return;
        }

        const { rideId, reason } = data;
        await this.handleDriverDecline(driverId, rideId, reason);
        socket.emit('ride_declined', { message: 'Ride declined' });
      });

      // Driver cancels accepted ride
      socket.on('driver_cancel_ride', async (data) => {
        console.log('Driver cancel_ride event data:', data);
        const driverId = this.socketDrivers.get(socket.id);
        
        if (!driverId) {
          socket.emit('error', { message: 'Driver not authenticated' });
          return;
        }

        try {
          await this.handleDriverCancelRide(driverId, data.rideId, data.reason);
          socket.emit('ride_cancelled', { 
            rideId: data.rideId,
            message: 'Ride cancelled successfully' 
          });
        } catch (error) {
          socket.emit('error', { message: error.message });
        }
      });

      // ==================== ADMIN EVENTS ====================
socket.on('update_location', async (data) => {
  const driverId = this.socketDrivers.get(socket.id);
  if (!driverId) return;

  const { lat, lng, heading } = data;

  // Update driver’s live coordinates
  await this.updateDriverLocation(driverId, { lat, lng, heading });

  // Fetch ride mapping from Redis
const rideStatus = await this.redis.hGetAll(`driver:${driverId}:status`);

  console.log(rideStatus);
  if (rideStatus.current_ride && rideStatus.current_user) {
    // Emit live location to that user
    this.emitToUser(rideStatus.current_user, 'driver_location_update', {
      rideId: rideStatus.current_ride,
      location: { lat, lng, heading },
      timestamp: Date.now()
    });
  }
});
      socket.on('admin_join', async (data) => {
        const { token, adminId } = data;
        
        let admin = null;
        
        if (token) {
          admin = await this.verifyAdminToken(token);
        } else if (adminId) {
          const Admin = require('../models/Admin');
          admin = await Admin.findById(adminId);
        }

        if (!admin) {
          socket.emit('auth_error', { message: 'Invalid admin credentials' });
          return;
        }

        const adminIdStr = admin._id.toString();
        this.adminSockets.set(adminIdStr, socket.id);
        this.socketAdmins.set(socket.id, adminIdStr);

        socket.join('admin_room');
        socket.emit('admin_connected', { 
          message: 'Admin connected successfully',
          adminId: adminIdStr 
        });

        console.log(`Admin ${adminIdStr} connected`);
      });

      socket.on('admin_assign_driver', async (data) => {
        const adminId = this.socketAdmins.get(socket.id);
        
        if (!adminId) {
          socket.emit('error', { message: 'Admin not authenticated' });
          return;
        }

        const { rideId, driverId } = data;
        const result = await this.handleAdminDriverAssignment(adminId, rideId, driverId);
        socket.emit('admin_assignment_result', result);
      });

      socket.on('get_ride_status', async (data) => {
        const adminId = this.socketAdmins.get(socket.id);
        
        if (!adminId) {
          socket.emit('error', { message: 'Admin not authenticated' });
          return;
        }

        const { rideId } = data;
        const status = await this.getRideStatus(rideId);
        socket.emit('ride_status', status);
      });

      // Get driver acceptance/decline history
      socket.on('get_driver_history', async (data) => {
        const adminId = this.socketAdmins.get(socket.id);
        
        if (!adminId) {
          socket.emit('error', { message: 'Admin not authenticated' });
          return;
        }

        const { driverId } = data;
        const history = await this.getDriverResponseHistory(driverId);
        socket.emit('driver_history', history);
      });

      // Get ride response history
      socket.on('get_ride_responses', async (data) => {
        const adminId = this.socketAdmins.get(socket.id);
        
        if (!adminId) {
          socket.emit('error', { message: 'Admin not authenticated' });
          return;
        }

        const { rideId } = data;
        const responses = await this.getRideResponseHistory(rideId);
        socket.emit('ride_responses', responses);
      });
socket.on('driver_ride_status_update', async (data) => {
  try {
    const {
      status,
      rideId,
      otp,
      finalFare,
      actualDistance,
      actualDuration,
      paymentMethod
    } = data;

    // Identify who triggered the event
    const driverId = this.socketDrivers.get(socket.id);
    const userId = this.socketUsers.get(socket.id);

    if (!driverId && !userId) {
      socket.emit('error', { message: 'Unauthorized: user/driver not authenticated' });
      return;
    }

    let result;

    switch (status) {
      case 'driver_arrived':
        if (!driverId) throw new Error('Only driver can mark arrival');
        console.log('Handling driver_arrived for ride:', rideId);
        result = await this.handleDriverArrived(driverId, rideId);
        break;

      case 'verify_otp':
        result = await this.handleOTPVerification(driverId, rideId, otp);
        break;

      case 'start_ride':
        if (!driverId) throw new Error('Only driver can start ride');
        result = await this.handleStartRide(driverId, rideId);
        break;

      case 'reached_drop':
        if (!driverId) throw new Error('Only driver can mark reached drop');
        result = await this.handleReachedDrop(driverId, rideId);
        break;

      case 'complete_ride':
        if (!driverId) throw new Error('Only driver can complete ride');
        result = await this.handleCompleteRide(driverId, rideId, {
          finalFare,
          actualDistance,
          actualDuration,
          paymentMethod
        });
        break;

      default:
        throw new Error(`Invalid status: ${status}`);
    }

    // Emit back to whoever triggered it
    socket.emit(`${status}_result`, result);

    // Optionally, broadcast updates (so user/admins know status changed)
    const rideDetails = result?.rideId ? { rideId: result.rideId } : { rideId };
    this.io.to('admin_room').emit('ride_status_update', {
      ...rideDetails,
      status,
      timestamp: new Date()
    });

  } catch (error) {
    console.error('ride_status_update error:', error);
    socket.emit('error', { message: error.message || 'Server error' });
  }
});


// 6. User submits rating and review
socket.on('submit_rating', async (data) => {
  const userId = this.socketUsers.get(socket.id);
  
  if (!userId) {
    socket.emit('error', { message: 'User not authenticated' });
    return;
  }

  const { rideId, rating, feedback } = data;
  const result = await this.handleUserRating(userId, rideId, rating, feedback);
  socket.emit('rating_submitted', result);
});


      socket.on('disconnect', () => {
        this.handleDisconnection(socket);
      });
    });
  }

  // ==================== RIDE BOOKING HANDLER ====================

async handleRideBooking(userId, rideData) {
  const {
    rideType, // 'local', 'outstation', 'airport'
    pickupLocation,
    dropoffLocation,
    vehicleType,
    estimatedFare,
    bookingType, // 'now' or 'scheduled'
    scheduledTime,
    tripType, // 'one-way' or 'round-trip'
    returnDate,
    estimatedDistance,
    estimatedDuration
  } = rideData;

  const Ride = require('../models/Ride');

  // ✅ Generate a 4-digit OTP
  const otp = Math.floor(1000 + Math.random() * 9000).toString();

  const ride = new Ride({
    userId,
    rideType: rideType || 'local',
    pickupLocation,
    dropoffLocation,
    vehicleType,
    estimatedFare,
    estimatedDistance,
    estimatedDuration,
    tripType: rideType === 'outstation' ? tripType : null,
    returnDate: tripType === 'round-trip' ? returnDate : null,
    status: (rideType === 'outstation' && bookingType === 'scheduled')
      ? 'scheduled'
      : 'searching',
    scheduledTime: (rideType === 'outstation' && bookingType === 'scheduled')
      ? new Date(scheduledTime)
      : null,
    createdAt: new Date(),
    driverResponses: [],
    otp, // ✅ Store OTP in ride
    otpVerified: false, // ✅ Flag to track if OTP is verified
  });

  await ride.save();

  // ✅ You can send OTP to user here (SMS or push notification)
  // await NotificationService.sendRideOTP(userId, otp);

  // Determine when to start driver search
  if (rideType === 'outstation' && bookingType === 'scheduled') {
    // For scheduled outstation rides, cron job will handle search
    this.io.to('admin_room').emit('new_ride_booking', {
      rideId: ride._id,
      rideType,
      bookingType: 'scheduled',
      scheduledTime,
      route: `${pickupLocation.address} to ${dropoffLocation.address}`
    });

    return {
      rideId: ride._id,
      status: 'scheduled',
      otp,
      message: 'Ride scheduled successfully. Driver will be assigned 1 hour before departure.'
    };
  } else {
    // For local, airport, and immediate outstation rides
    setTimeout(() => {
      this.startDriverSearch(ride);
    }, 1000);

    this.io.to('admin_room').emit('new_ride_booking', {
      rideId: ride._id,
      rideType,
      bookingType: 'now',
      route: `${pickupLocation.address} to ${dropoffLocation.address}`
    });

    return {
      rideId: ride._id,
      status: 'searching',
      otp,
      message: 'Searching for drivers...',
    };
  }
}
  // ==================== DRIVER SEARCH LOGIC ====================


async handleDriverArrived(driverId, rideId) {
  try {
    const Ride = require('../models/Ride');
    const ride = await Ride.findOne({ _id: rideId, driverId });
    console.log(ride);

    if (!ride) {
      return { success: false, message: 'Ride not found' };
    }

    // if (ride.status !== 'driver_arrived' ) {
    //   return { success: false, message: 'Invalid ride status' };
    // }

    // Generate OTP for ride verification
    const otp = ride.otp;
    
    // Store OTP in Redis (expires in 10 minutes)
    await this.redis.setEx(`ride:${rideId}:otp`, 600, otp);

    // Update ride status
    await Ride.findByIdAndUpdate(rideId, {
      status: 'driver_arrived',
      arrivedAt: new Date()
    });

    // Notify user
    this.emitToUser(ride.userId._id.toString(), 'ride_status_update', {
      ride,
      message: 'Your driver has arrived at the pickup location',
      otp, 
      arrivedAt: new Date()
    });

    // Notify admin
    this.io.to('admin_room').emit('ride_status_update', {
      rideId,
      status: 'driver_arrived',
      arrivedAt: new Date()
    });

    console.log(`Driver ${driverId} arrived for ride ${rideId}, OTP: ${otp}`);

    return {
      success: true,
      message: 'Arrival confirmed. Waiting for user to verify OTP.',
      otp // Driver sees OTP to verify with user
    };

  } catch (error) {
    console.error('Error handling driver arrival:', error);
    return { success: false, message: 'Error processing arrival' };
  }
}
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


async handleOTPVerification(userId, rideId, otp) {
  try {
    const Ride = require('../models/Ride');
    const ride = await Ride.findOne({ _id: rideId, userId });

    if (!ride) {
      return { success: false, message: 'Ride not found' };
    }

    if (ride.status !== 'driver_arrived') {
      return { success: false, message: 'Driver has not arrived yet' };
    }

    // Verify OTP from Redis
    const storedOTP = await this.redis.get(`ride:${rideId}:otp`);
    console.log(storedOTP, otp);  
    if (!storedOTP) {
      return { success: false, message: 'OTP expired. Please request a new one.' };
    }

    if (storedOTP !== otp.toString()) {
      return { success: false, message: 'Invalid OTP' };
    }

    await this.redis.del(`ride:${rideId}:otp`);

    await Ride.findByIdAndUpdate(rideId, {
      status: 'ride_started',
      otpVerifiedAt: new Date()
    });

    // Notify driver
    this.emitToDriver(ride.driverId.toString(), 'ride_status_update', {
      ride,
      message: 'OTP verified. You can start the ride now.',
      verifiedAt: new Date()
    });

    // Notify admin
    this.io.to('admin_room').emit('ride_status_update', {
      rideId,
      status: 'otp_verified'
    });

    console.log(`OTP verified for ride ${rideId}`);

    return {
      success: true,
      message: 'OTP verified successfully. Driver will start the ride.',
      rideId
    };

  } catch (error) {
    console.error('Error verifying OTP:', error);
    return { success: false, message: 'Error verifying OTP' };
  }
}

async handleStartRide(driverId, rideId) {
  try {
    const Ride = require('../models/Ride');
    const ride = await Ride.findOne({ _id: rideId, driverId });

    if (!ride) {
      return { success: false, message: 'Ride not found' };
    }

    if (ride.status !== 'otp_verified') {
      return { success: false, message: 'OTP not verified yet' };
    }

    // Update ride status
    await Ride.findByIdAndUpdate(rideId, {
      status: 'in_progress',
      startedAt: new Date()
    });

    // Notify user
    this.emitToUser(ride.userId._id.toString(), 'ride_status_update', {
      rideId,
      message: 'Your ride has started',
      startedAt: new Date()
    });

    // Notify admin
    this.io.to('admin_room').emit('ride_status_update', {
      rideId,
      status: 'in_progress',
      startedAt: new Date()
    });

    console.log(`Ride ${rideId} started by driver ${driverId}`);

    return {
      success: true,
      message: 'Ride started successfully',
      startedAt: new Date()
    };

  } catch (error) {
    console.error('Error starting ride:', error);
    return { success: false, message: 'Error starting ride' };
  }
}

async handleReachedDrop(driverId, rideId) {
  try {
    const Ride = require('../models/Ride');
    const ride = await Ride.findOne({ _id: rideId, driverId });

    if (!ride) {
      return { success: false, message: 'Ride not found' };
    }

    if (ride.status !== 'in_progress') {
      return { success: false, message: 'Ride is not in progress' };
    }

    // Update ride status
    await Ride.findByIdAndUpdate(rideId, {
      status: 'reached_drop',
      reachedDropAt: new Date()
    });

    // Notify user
    this.emitToUser(ride.userId._id.toString(), 'ride_status_update', {
      rideId,
      message: 'You have reached your destination',
      reachedAt: new Date()
    });

    // Notify admin
    this.io.to('admin_room').emit('ride_status_update', {
      rideId,
      status: 'reached_drop'
    });

    console.log(`Driver ${driverId} reached drop location for ride ${rideId}`);

    return {
      success: true,
      message: 'Reached drop location. Complete the ride to finish.',
      reachedAt: new Date()
    };

  } catch (error) {
    console.error('Error handling reached drop:', error);
    return { success: false, message: 'Error processing drop location' };
  }
}

async handleCompleteRide(driverId, rideId, rideDetails) {
  try {
    const Ride = require('../models/Ride');
    const Driver = require('../models/Driver');

    const ride = await Ride.findOne({ _id: rideId, driverId });

    if (!ride) {
      return { success: false, message: 'Ride not found' };
    }

    if (ride.status !== 'reached_drop' && ride.status !== 'in_progress') {
      return { success: false, message: 'Cannot complete ride from current status' };
    }

    const { finalFare, actualDistance, actualDuration, paymentMethod } = rideDetails;

    // Calculate commission and earnings
    const commissionRate = ride.rideType === 'outstation' ? 0.20 : 0.25;
    const platformCommission = Math.round(finalFare * commissionRate);
    const driverEarnings = finalFare - platformCommission;

    // Update ride
    await Ride.findByIdAndUpdate(rideId, {
      status: 'completed',
      completedAt: new Date(),
      finalFare,
      actualDistance,
      actualDuration,
      paymentMethod: paymentMethod || ride.paymentMethod,
      paymentStatus: paymentMethod === 'cash' ? 'completed' : 'pending',
      platformCommission,
      driverEarnings
    });

    // Update driver stats
    const updateFields = {
      isAvailable: true,
      currentRide: null,
      $inc: { 
        completedRides: 1,
        totalEarnings: driverEarnings
      }
    };

    if (ride.rideType === 'outstation') {
      updateFields.$inc.completedOutstationRides = 1;
      updateFields.currentOutstationRide = null;
    } else if (ride.rideType === 'airport') {
      updateFields.$inc.completedAirportRides = 1;
    }

    await Driver.findByIdAndUpdate(driverId, updateFields);

    // Notify user
    this.emitToUser(ride.userId._id.toString(), 'ride_status_update', {
      rideId,
      message: 'Your ride has been completed',
      finalFare,
      actualDistance,
      actualDuration,
      paymentMethod,
      completedAt: new Date(),
      earnings: driverEarnings
    });

    // Notify admin
    this.io.to('admin_room').emit('ride_completed', {
      rideId,
      driverId,
      finalFare,
      platformCommission,
      driverEarnings,
      completedAt: new Date()
    });

    console.log(`Ride ${rideId} completed by driver ${driverId}`);

    return {
      success: true,
      message: 'Ride completed successfully',
      earnings: driverEarnings,
      finalFare,
      completedAt: new Date()
    };

  } catch (error) {
    console.error('Error completing ride:', error);
    return { success: false, message: 'Error completing ride' };
  }
}

async handleUserRating(userId, rideId, rating, feedback) {
  try {
    const Ride = require('../models/Ride');
    const Driver = require('../models/Driver');

    const ride = await Ride.findOne({ _id: rideId, userId });

    if (!ride) {
      return { success: false, message: 'Ride not found' };
    }

    if (ride.status !== 'completed') {
      return { success: false, message: 'Ride is not completed yet' };
    }

    if (ride.userRating) {
      return { success: false, message: 'You have already rated this ride' };
    }

    // Update ride with rating
    await Ride.findByIdAndUpdate(rideId, {
      userRating: rating,
      userFeedback: feedback
    });

    // Update driver rating
    const driver = await Driver.findById(ride.driverId);
    if (driver) {
      driver.updateRating(rating);
      await driver.save();
    }

    // Notify driver
    this.emitToDriver(ride.driverId.toString(), 'user_rating_received', {
      rideId,
      rating,
      feedback,
      message: 'You received a new rating from user'
    });

    // Notify admin
    this.io.to('admin_room').emit('rating_submitted', {
      rideId,
      type: 'user_rating',
      rating,
      feedback
    });

    console.log(`User ${userId} rated ride ${rideId}: ${rating} stars`);

    return {
      success: true,
      message: 'Thank you for your rating!',
      rating,
      driverNewRating: driver.rating
    };

  } catch (error) {
    console.error('Error submitting user rating:', error);
    return { success: false, message: 'Error submitting rating' };
  }
}

async handleDriverRating(driverId, rideId, rating, feedback) {
  try {
    const Ride = require('../models/Ride');
    const User = require('../models/User');

    const ride = await Ride.findOne({ _id: rideId, driverId });

    if (!ride) {
      return { success: false, message: 'Ride not found' };
    }

    if (ride.status !== 'completed') {
      return { success: false, message: 'Ride is not completed yet' };
    }

    if (ride.driverRating) {
      return { success: false, message: 'You have already rated this user' };
    }

    // Update ride with rating
    await Ride.findByIdAndUpdate(rideId, {
      driverRating: rating,
      driverFeedback: feedback
    });

    // Update user rating if User model has rating system
    const user = await User.findById(ride.userId);
    if (user && user.updateRating) {
      user.updateRating(rating);
      await user.save();
    }

    // Notify admin
    this.io.to('admin_room').emit('rating_submitted', {
      rideId,
      type: 'driver_rating',
      rating,
      feedback
    });

    console.log(`Driver ${driverId} rated user for ride ${rideId}: ${rating} stars`);

    return {
      success: true,
      message: 'Rating submitted successfully',
      rating
    };

  } catch (error) {
    console.error('Error submitting driver rating:', error);
    return { success: false, message: 'Error submitting rating' };
  }
}

// Helper method to generate OTP
generateOTP() {
  return Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit OTP
}

  async startDriverSearch(ride) {
    try {
      const Ride = require('../models/Ride');

      await Ride.findByIdAndUpdate(ride._id, {
        searchingStarted: true,
        searchStartedAt: new Date()
      });

      // Notify user that search has started
      this.emitToUser(ride.userId.toString(), 'driver_search_started', {
        rideId: ride._id,
        message: 'Searching for available drivers...'
      });

      const requestDrivers = async (rideId, driverPlan, waitMinutes = 5) => {
        const rideDetails = await this.getRideDetails(rideId);
        const drivers = await this.findDrivers(
          rideDetails.pickupLocation,
          driverPlan,
          rideDetails.vehicleType,
          rideDetails.rideType
        );
        console.log(`Found ${drivers.length} ${driverPlan} drivers for ride ${rideId}`);
        if (drivers.length > 0) {
          await this.sendRequestsToDrivers(rideId, drivers, driverPlan);

          return new Promise(resolve => {
            setTimeout(async () => {
              const updatedRide = await this.getRideDetails(rideId);
              resolve(!!updatedRide.driverId ? 'assigned' : 'declined');
            }, waitMinutes * 60 * 1000);
          });
        }

        return 'no_drivers';
      };

      // Tiered driver search: Premium first, then Standard
      const premiumResult = await requestDrivers(ride._id, 'premium', 5);

      if (premiumResult === 'assigned') {
        // Driver found and assigned successfully
        return;
      }

      if (premiumResult === 'declined') {
        // Premium drivers were found but declined, try standard
        const standardResult = await requestDrivers(ride._id, 'standard', 5);

        if (standardResult === 'assigned') {
          // Standard driver assigned
          return;
        }

        if (standardResult === 'declined' || standardResult === 'no_drivers') {
          // All drivers declined or no standard drivers found
          await this.handleNoDriversAvailable(ride._id);
        }
      } else if (premiumResult === 'no_drivers') {
        // No premium drivers found, try standard
        const standardResult = await requestDrivers(ride._id, 'standard', 5);

        if (standardResult === 'assigned') {
          // Standard driver assigned
          return;
        }

        if (standardResult === 'declined' || standardResult === 'no_drivers') {
          // No drivers available or all declined
          await this.handleNoDriversAvailable(ride._id);
        }
      }

    } catch (error) {
      console.error('Error in driver search:', error);
      
      // Notify user about error
      this.emitToUser(ride.userId.toString(), 'driver_search_error', {
        rideId: ride._id,
        message: 'An error occurred while searching for drivers. Please try again.'
      });
    }
  }

  async handleNoDriversAvailable(rideId) {
    try {
      const Ride = require('../models/Ride');
      const ride = await this.getRideDetails(rideId);

      // Update ride status
      await Ride.findByIdAndUpdate(rideId, {
        status: 'no_drivers_available'
      });

      // Notify user
      this.emitToUser(ride.userId._id.toString(), 'no_drivers_found', {
        rideId,
        message: 'Sorry, no drivers are available at the moment. Please try again later.',
        rideType: ride.rideType,
        canRetry: true
      });

      // Notify admins
      this.io.to('admin_room').emit('no_drivers_available', {
        rideId,
        userId: ride.userId._id.toString(),
        rideType: ride.rideType,
        route: `${ride.pickupLocation.address} to ${ride.dropoffLocation.address}`,
        estimatedFare: ride.estimatedFare,
        searchStartedAt: ride.searchStartedAt,
        message: 'No drivers available for this ride'
      });

      console.log(`No drivers available for ride ${rideId}`);

    } catch (error) {
      console.error('Error handling no drivers available:', error);
    }
  }


  async findDrivers(pickupLocation, driverPlan, vehicleType, rideType) {
    const Driver = require('../models/Driver');
    const { lat, lng } = pickupLocation;
    
    // Different radius based on ride type
    const maxRadius = rideType === 'outstation' ? 30 : (rideType === 'airport' ? 15 : 10);
    
    try {
      const query = {
        planType: driverPlan,
        'vehicleDetails.type': vehicleType,
        isAvailable: true,
      };

      // Add ride-specific filters
      if (rideType === 'outstation') {
        query.isOutstationEnabled = true;
      } else if (rideType === 'airport') {
        query.isAirportEnabled = true;
      }

      const drivers = await Driver.find(query);
      const availableDrivers = [];
      for (const driver of drivers) {
        const driverId = driver._id.toString();
        
        const isConnected = this.driverSockets.has(driverId);
        const locationData = await this.redis.hGetAll(`driver:${driverId}:location`);
        
        if (isConnected && locationData.lat && locationData.lng) {
          const distance = this.calculateDistance(
            lat, lng,
            parseFloat(locationData.lat),
            parseFloat(locationData.lng)
          );
          
          if (distance <= maxRadius) {
            availableDrivers.push({
              driverId,
              distance,
              driverName: driver.name,
              rating: driver.rating,
              completedRides: driver.completedRides || 0
            });
          }
        }
      }

      // Sort by rating, then distance
      return availableDrivers.sort((a, b) => {
        if (b.rating !== a.rating) {
          return b.rating - a.rating;
        }
        return a.distance - b.distance;
      });

    } catch (error) {
      console.error('Error finding drivers:', error);
      return [];
    }
  }

async sendRequestsToDrivers(rideId, drivers, driverPlan) {
  const ride = await this.getRideDetails(rideId);
  
  // Set timeout based on ride type
  const timeoutDuration = ride.rideType === 'outstation' 
    ? 120000  // 2 minutes for outstation
    : 30000;  // 30 seconds for local rides
  
  // Filter out drivers who already have pending requests
  const availableDrivers = [];
  for (const driver of drivers) {
    const hasActiveRequest = await this.redis.get(`driver:${driver.driverId}:active_request`);
    if (!hasActiveRequest) {
      availableDrivers.push(driver);
    } else {
      console.log(`Driver ${driver.driverId} already has an active request, skipping`);
    }
  }

  if (availableDrivers.length === 0) {
    console.log(`No available drivers for ride ${rideId} - all have active requests`);
    return;
  }

  const requestKey = `ride_request:${rideId}`;
  await this.redis.setEx(requestKey, 300, JSON.stringify({
    rideId,
    driverPlan,
    drivers: availableDrivers.map(d => ({
      driverId: d.driverId,
      notifiedAt: new Date()
    })),
    createdAt: Date.now(),
    timeoutAt: Date.now() + timeoutDuration,
    timeoutDuration // Store the timeout duration
  }));

  for (const driver of availableDrivers) {
    await this.sendRequestToDriver(driver, ride, timeoutDuration);
  }

  this.io.to('admin_room').emit('driver_search_update', {
    rideId,
    rideType: ride.rideType,
    driverPlan,
    driversNotified: availableDrivers.length,
    driversSkipped: drivers.length - availableDrivers.length,
    timeoutSeconds: timeoutDuration / 1000, // Show timeout in seconds
    drivers: availableDrivers.map(d => ({
      id: d.driverId,
      name: d.driverName,
      distance: d.distance,
      rating: d.rating
    }))
  });
}

async sendRequestToDriver(driver, ride, timeout) {
  try {
    const driverActiveRequestKey = `driver:${driver.driverId}:active_request`;
    const driverPendingRideKey = `driver:${driver.driverId}:pending_ride`;
    
    // Check again if driver has active request (race condition protection)
    const existingRequest = await this.redis.get(driverActiveRequestKey);
    if (existingRequest) {
      console.log(`Driver ${driver.driverId} received another request while processing, skipping`);
      return;
    }

    // Mark driver as having an active request with timeout
    const timeoutSeconds = Math.ceil(timeout / 1000);
    await this.redis.setEx(
      driverActiveRequestKey,
      timeoutSeconds,
      JSON.stringify({
        rideId: ride._id.toString(),
        sentAt: Date.now(),
        expiresAt: Date.now() + timeout,
        rideType: ride.rideType,
        timeoutSeconds
      })
    );

    // Also keep the pending ride reference
    await this.redis.setEx(
      driverPendingRideKey,
      timeoutSeconds,
      ride._id.toString()
    );

    const earningsEstimate = this.calculateDriverEarnings(ride.estimatedFare, ride.rideType);

    // Send request to driver with timeout information
    this.io.to(`driver_${driver.driverId}`).emit('ride_request', {
      rideId: ride._id,
      rideType: ride.rideType,
      pickup: ride.pickupLocation,
      dropoff: ride.dropoffLocation,
      tripType: ride.tripType,
      scheduledTime: ride.scheduledTime,
      estimatedFare: ride.estimatedFare,
      estimatedDistance: ride.estimatedDistance,
      estimatedDuration: ride.estimatedDuration,
      earningsEstimate,
      timeout, // Milliseconds
      timeoutSeconds, // Seconds for display
      userInfo: {
        name: ride.userId?.name,
        rating: ride.userId?.rating
      }
    });

    // Set timeout to track no response
    const timeoutHandle = setTimeout(async () => {
      const pendingRide = await this.redis.get(driverPendingRideKey);
      const activeRequest = await this.redis.get(driverActiveRequestKey);
      
      // If driver still has pending ride (didn't accept or decline)
      if (pendingRide === ride._id.toString() && activeRequest) {
        console.log(`Driver ${driver.driverId} timed out after ${timeoutSeconds}s for ride ${ride._id}`);
        await this.handleDriverNoResponse(driver.driverId, ride._id);
        
        // Clean up the active request
        await this.redis.del(driverActiveRequestKey);
        await this.redis.del(driverPendingRideKey);
      }
    }, timeout);

    console.log(`Ride request sent to driver ${driver.driverId} for ${ride.rideType} ride (timeout: ${timeoutSeconds}s)`);

  } catch (error) {
    console.error(`Error sending request to driver:`, error);
    // Clean up on error
    await this.redis.del(`driver:${driver.driverId}:active_request`);
    await this.redis.del(`driver:${driver.driverId}:pending_ride`);
  }
}
async handleDriverNoResponse(driverId, rideId) {
  try {
    const Ride = require('../models/Ride');
    const Driver = require('../models/Driver');

    const driver = await Driver.findById(driverId);

    // Record no response
    await Ride.findByIdAndUpdate(rideId, {
      $push: {
        driverResponses: {
          driverId,
          driverName: driver.name,
          driverPhone: driver.phone,
          response: 'no_response',
          respondedAt: new Date()
        }
      }
    });

    // Store in Redis
    const noResponseKey = `driver:${driverId}:no_responses`;
    await this.redis.lPush(noResponseKey, JSON.stringify({
      rideId,
      noResponseAt: new Date().toISOString()
    }));
    await this.redis.expire(noResponseKey, 7 * 24 * 60 * 60);

    // Update driver stats
    await Driver.findByIdAndUpdate(driverId, {
      $inc: { totalNoResponses: 1 }
    });

    // Clean up active request - IMPORTANT: This frees the driver for new requests
    await this.redis.del(`driver:${driverId}:active_request`);
    await this.redis.del(`driver:${driverId}:pending_ride`);

    // Notify driver that request expired
    this.io.to(`driver_${driverId}`).emit('ride_request_expired', {
      rideId,
      reason: 'timeout',
      message: 'Request expired - no response within time limit'
    });

    console.log(`Driver ${driver.name} (${driverId}) did not respond to ride ${rideId} - now available for new requests`);

  } catch (error) {
    console.error('Error handling driver no response:', error);
    // Ensure cleanup even on error
    await this.redis.del(`driver:${driverId}:active_request`);
    await this.redis.del(`driver:${driverId}:pending_ride`);
  }
}

// ==================== DRIVER RESPONSE HANDLERS ====================

async handleDriverAcceptance(driverId, rideId) {
  try {
    const Ride = require('../models/Ride');
    const Driver = require('../models/Driver');

    // Check if driver still has valid active request
    const activeRequest = await this.redis.get(`driver:${driverId}:active_request`);
    if (!activeRequest) {
      console.log(`Driver ${driverId} tried to accept expired ride ${rideId}`);
      
      // Notify driver that request expired
      this.io.to(`driver_${driverId}`).emit('ride_request_expired', {
        rideId,
        message: 'This ride request has expired or was already assigned'
      });
      
      return {
        success: false,
        message: 'Ride request has expired'
      };
    }

    const ride = await Ride.findById(rideId);
    if (!ride || ride.driverId) {
      // Clean up if ride already assigned
      await this.redis.del(`driver:${driverId}:active_request`);
      await this.redis.del(`driver:${driverId}:pending_ride`);
      
      return {
        success: false,
        message: 'Ride already assigned to another driver'
      };
    }

    const driver = await Driver.findById(driverId);

    // Update ride with acceptance details
    await Ride.findByIdAndUpdate(rideId, {
      driverId,
      driverName: driver.name,
      driverPhone: driver.phone,
      driverVehicle: driver.vehicle,
      status: 'driver_assigned',
      acceptedAt: new Date(),
      $push: {
        driverResponses: {
          driverId,
          driverName: driver.name,
          driverPhone: driver.phone,
          driverRating: driver.rating,
          response: 'accepted',
          respondedAt: new Date()
        }
      }
    });
    

    // Update driver
    await Driver.findByIdAndUpdate(driverId, {
      isAvailable: false,
      currentRide: rideId,
      $inc: { totalAcceptances: 1 }
    });
    console.log(`Driver ${driver.name} (${driverId}) accepted ride ${ride.userId} ${rideId}`);
    // ✅ Link driver to current ride in Redis for live tracking
await this.redis.hSet(
  `driver:${driverId}:status`,
  {
    current_ride: ride._id.toString(),
    current_user: ride.userId.toString(),
    ride_type: ride.rideType || 'local',   
    status: 'on_ride',
  }
);



    // Store acceptance in Redis for quick access (30 days)
    const acceptanceKey = `driver:${driverId}:acceptances`;
    await this.redis.lPush(acceptanceKey, JSON.stringify({
      rideId,
      rideType: ride.rideType,
      acceptedAt: new Date().toISOString(),
      fare: ride.estimatedFare
    }));
    await this.redis.expire(acceptanceKey, 30 * 24 * 60 * 60);

    // Store ride acceptance history
    const rideAcceptanceKey = `ride:${rideId}:acceptance`;
    await this.redis.set(rideAcceptanceKey, JSON.stringify({
      driverId,
      driverName: driver.name,
      driverPhone: driver.phone,
      driverRating: driver.rating,
      acceptedAt: new Date().toISOString()
    }), {
      EX: 30 * 24 * 60 * 60
    });

    // Notify user
    this.emitToUser(ride.userId.toString(), 'ride_confirmed', {
      rideId,
      rideType: ride.rideType,
      driver: {
        id: driver._id,
        name: driver.name,
        phone: driver.phone,
        vehicle: driver.vehicle,
        rating: driver.rating,
        photo: driver.photo
      },
      message: 'Your ride has been confirmed!'
    });

    // Cancel requests to other drivers
    await this.cancelOtherDriverRequests(rideId, driverId);

    // Notify admins
    this.io.to('admin_room').emit('driver_assigned', {
      rideId,
      rideType: ride.rideType,
      driverId,
      driverName: driver.name,
      driverPhone: driver.phone,
      acceptedAt: new Date(),
      route: `${ride.pickupLocation.address} to ${ride.dropoffLocation.address}`
    });

    // IMPORTANT: Clean up active request - driver is now on a ride, not available for new requests
    await this.redis.del(`driver:${driverId}:active_request`);
    await this.redis.del(`driver:${driverId}:pending_ride`);
    await this.redis.del(`ride_request:${rideId}`);

    console.log(`Driver ${driver.name} (${driverId}) accepted ride ${rideId} - active request cleared`);

    return {
      success: true,
      message: 'Ride accepted successfully',
      ride: {
        rideId,
        rideType: ride.rideType,
        pickup: ride.pickupLocation,
        dropoff: ride.dropoffLocation,
        estimatedFare: ride.estimatedFare,
        user: {
          name: ride.userId?.name,
          phone: ride.userId?.phone
        }
      }
    };

  } catch (error) {
    console.error('Error handling driver acceptance:', error);
    // Clean up on error
    await this.redis.del(`driver:${driverId}:active_request`);
    await this.redis.del(`driver:${driverId}:pending_ride`);
    
    return {
      success: false,
      message: 'Error processing acceptance'
    };
  }
}

async handleDriverDecline(driverId, rideId, reason) {
  try {
    const Ride = require('../models/Ride');
    const Driver = require('../models/Driver');

    // Check if driver still has valid active request
    const activeRequest = await this.redis.get(`driver:${driverId}:active_request`);
    if (!activeRequest) {
      console.log(`Driver ${driverId} tried to decline expired ride ${rideId}`);
      
      this.io.to(`driver_${driverId}`).emit('ride_request_expired', {
        rideId,
        message: 'This ride request has already expired'
      });
      
      return {
        success: false,
        message: 'Ride request has expired'
      };
    }

    const driver = await Driver.findById(driverId);

    // Store decline in ride
    await Ride.findByIdAndUpdate(rideId, {
      $push: {
        driverResponses: {
          driverId,
          driverName: driver.name,
          driverPhone: driver.phone,
          response: 'declined',
          reason,
          respondedAt: new Date()
        }
      }
    });

    // Store in Redis for quick access (7 days)
    const declineKey = `driver:${driverId}:declines`;
    await this.redis.lPush(declineKey, JSON.stringify({
      rideId,
      reason,
      declinedAt: new Date().toISOString()
    }));
    await this.redis.expire(declineKey, 7 * 24 * 60 * 60);

    // Store ride-specific decline history (30 days)
    const rideDeclineKey = `ride:${rideId}:declines`;
    await this.redis.lPush(rideDeclineKey, JSON.stringify({
      driverId,
      driverName: driver.name,
      reason,
      declinedAt: new Date().toISOString()
    }));
    await this.redis.expire(rideDeclineKey, 30 * 24 * 60 * 60);

    // Update driver stats
    await Driver.findByIdAndUpdate(driverId, {
      $inc: { totalDeclines: 1 }
    });

    // IMPORTANT: Clean up active request - driver is now free to receive new requests
    await this.redis.del(`driver:${driverId}:active_request`);
    await this.redis.del(`driver:${driverId}:pending_ride`);

    // Notify admins about decline
    const ride = await this.getRideDetails(rideId);
    this.io.to('admin_room').emit('driver_declined_ride', {
      rideId,
      rideType: ride.rideType,
      driverId,
      driverName: driver.name,
      reason,
      declinedAt: new Date()
    });

    console.log(`Driver ${driver.name} (${driverId}) declined ride ${rideId}: ${reason} - now available for new requests`);

    return {
      success: true,
      message: 'Ride declined successfully'
    };

  } catch (error) {
    console.error('Error handling driver decline:', error);
    // Ensure cleanup even on error
    await this.redis.del(`driver:${driverId}:active_request`);
    await this.redis.del(`driver:${driverId}:pending_ride`);
    
    return {
      success: false,
      message: 'Error processing decline'
    };
  }
}
  async cancelOtherDriverRequests(rideId, acceptedDriverId) {
    try {
      const requestKey = `ride_request:${rideId}`;
      const requestData = await this.redis.get(requestKey);
      
      if (requestData) {
        const { drivers } = JSON.parse(requestData);
        
        for (const driver of drivers) {
          if (driver.driverId !== acceptedDriverId) {
                      await this.redis.del(`driver:${driver.driverId}:active_request`);
          await this.redis.del(`driver:${driver.driverId}:pending_ride`);

            this.io.to(`driver_${driver.driverId}`).emit('ride_request_cancelled', {
              rideId,
              message: 'This ride has been assigned to another driver'
            });
            
            await this.redis.del(`driver:${driver.driverId}:pending_ride`);
          }
        }
      }
    } catch (error) {
      console.error('Error cancelling other driver requests:', error);
    }
  }

  // ==================== CANCELLATION HANDLERS ====================
async handleUserCancelSearch(userId, rideId) {
  const Ride = require('../models/Ride');
  
  const ride = await Ride.findOne({ _id: rideId, userId });
  
  if (!ride) {
    throw new Error('Ride not found');
  }

  if (ride.status !== 'searching' && ride.status !== 'scheduled') {
    throw new Error('Cannot cancel ride that is already confirmed');
  }

  // Cancel the ride
  await Ride.findByIdAndUpdate(rideId, {
    status: 'cancelled',
    cancelledBy: 'user',
    cancelledAt: new Date(),
    cancellationReason: 'User cancelled search'
  });

  // Remove all pending driver requests and free up drivers
  const requestKey = `ride_request:${rideId}`;
  const requestData = await this.redis.get(requestKey);
  
  if (requestData) {
    const { drivers } = JSON.parse(requestData);
    
    for (const driver of drivers) {
      // Notify driver about cancellation
      this.io.to(`driver_${driver.driverId}`).emit('ride_request_cancelled', {
        rideId,
        message: 'User cancelled the ride request'
      });
      
      // IMPORTANT: Clean up active request - free the driver immediately
      await this.redis.del(`driver:${driver.driverId}:active_request`);
      await this.redis.del(`driver:${driver.driverId}:pending_ride`);
      
      console.log(`Freed driver ${driver.driverId} from cancelled ride ${rideId}`);
    }
  }

  // Clean up ride request data
  await this.redis.del(requestKey);

  // Notify admins
  this.io.to('admin_room').emit('ride_search_cancelled', {
    rideId,
    cancelledBy: 'user',
    reason: 'User cancelled search',
    driversFreed: requestData ? JSON.parse(requestData).drivers.length : 0
  });

  console.log(`User ${userId} cancelled ride search ${rideId} - ${requestData ? JSON.parse(requestData).drivers.length : 0} drivers freed`);
}

async handleUserCancelRide(userId, rideId, reason) {
  const Ride = require('../models/Ride');
  const Driver = require('../models/Driver');
  
  const ride = await Ride.findOne({ _id: rideId, userId });
  
  if (!ride) {
    throw new Error('Ride not found');
  }

  if (ride.status === 'completed' || ride.status === 'cancelled') {
    throw new Error('Cannot cancel this ride');
  }

  const driverId = ride.driverId;

  await Ride.findByIdAndUpdate(rideId, {
    status: 'cancelled',
    cancelledBy: 'user',
    cancelledAt: new Date(),
    cancellationReason: reason || 'User cancelled'
  });

  // If driver was assigned, make them available again
  if (driverId) {
    await Driver.findByIdAndUpdate(driverId, {
      isAvailable: true,
      currentRide: null
    });

    // Clean up any remaining driver data for this ride
    await this.redis.del(`driver:${driverId}:active_request`);
    await this.redis.del(`driver:${driverId}:pending_ride`);

    // Notify driver
    this.emitToDriver(driverId.toString(), 'ride_cancelled_by_user', {
      rideId,
      reason: reason || 'User cancelled the ride',
      message: 'The user has cancelled this ride'
    });

    console.log(`Driver ${driverId} made available after user cancelled ride ${rideId}`);
  }

  // Clean up ride request data
  await this.redis.del(`ride_request:${rideId}`);
  await this.redis.del(`ride:${rideId}:acceptance`);

  // Notify admins
  this.io.to('admin_room').emit('ride_cancelled', {
    rideId,
    cancelledBy: 'user',
    driverId: driverId?.toString(),
    reason
  });

  console.log(`User ${userId} cancelled ride ${rideId}`);
}

async handleDriverCancelRide(driverId, rideId, reason) {
  const Ride = require('../models/Ride');
  const Driver = require('../models/Driver');
  
  const ride = await Ride.findOne({ _id: rideId, driverId });
  
  if (!ride) {
    throw new Error('Ride not found or not assigned to you');
  }

  if (ride.status === 'completed' || ride.status === 'cancelled') {
    throw new Error('Cannot cancel this ride');
  }

  const driver = await Driver.findById(driverId);

  await Ride.findByIdAndUpdate(rideId, {
    status: 'searching', // Reset to searching instead of cancelled
    driverId: null,
    driverName: null,
    driverPhone: null,
    driverVehicle: null,
    driverCancelledBy: driverId,
    driverCancellationReason: reason || 'Driver cancelled',
    driverCancelledAt: new Date(),
    $push: {
      driverResponses: {
        driverId,
        driverName: driver.name,
        driverPhone: driver.phone,
        response: 'cancelled',
        reason,
        respondedAt: new Date()
      }
    }
  });

  await Driver.findByIdAndUpdate(driverId, {
    isAvailable: true,
    currentRide: null,
    $inc: { totalCancellations: 1 }
  });

  // Clean up driver's active request and ride data
  await this.redis.del(`driver:${driverId}:active_request`);
  await this.redis.del(`driver:${driverId}:pending_ride`);
  
  // Store cancellation in Redis for tracking (7 days)
  const cancellationKey = `driver:${driverId}:cancellations`;
  await this.redis.lPush(cancellationKey, JSON.stringify({
    rideId,
    reason,
    cancelledAt: new Date().toISOString()
  }));
  await this.redis.expire(cancellationKey, 7 * 24 * 60 * 60);

  // Clean up ride acceptance data
  await this.redis.del(`ride:${rideId}:acceptance`);

  // Notify user
  this.emitToUser(ride.userId.toString(), 'ride_cancelled_by_driver', {
    rideId,
    driverName: driver.name,
    reason: reason || 'Driver cancelled the ride',
    message: 'Your driver cancelled. Searching for a new driver...'
  });

  // Restart driver search after a brief delay
  const updatedRide = await this.getRideDetails(rideId);
  setTimeout(() => {
    this.startDriverSearch(updatedRide);
  }, 2000); // 2 second delay before restarting search

  // Notify admins
  this.io.to('admin_room').emit('ride_cancelled_by_driver', {
    rideId,
    driverId,
    driverName: driver.name,
    reason,
    message: 'Driver cancelled, restarting search in 2 seconds'
  });

  console.log(`Driver ${driver.name} (${driverId}) cancelled ride ${rideId} - now available for new requests`);
}

// Optional: Cleanup utility method for when ride is completed
async handleRideCompletion(rideId, driverId) {
  try {
    const Driver = require('../models/Driver');

    // Make driver available again
    await Driver.findByIdAndUpdate(driverId, {
      isAvailable: true,
      currentRide: null
    });

    // Clean up all Redis data for this ride and driver
    await this.redis.del(`driver:${driverId}:active_request`);
    await this.redis.del(`driver:${driverId}:pending_ride`);
    await this.redis.del(`ride_request:${rideId}`);
    await this.redis.del(`ride:${rideId}:acceptance`);
    await this.redis.del(`ride:${rideId}:declines`);

    console.log(`Ride ${rideId} completed - driver ${driverId} is now available`);

  } catch (error) {
    console.error('Error handling ride completion cleanup:', error);
  }
}

// Optional: Batch cleanup for old/stale data (run as cron job)
async cleanupStaleRequests() {
  try {
    // Note: Redis TTL handles most cleanup automatically
    // This is just for logging and monitoring
    
    const pattern = 'driver:*:active_request';
    let cursor = '0';
    let staleCount = 0;

    do {
      const result = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = result[0];
      const keys = result[1];

      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl < 0) { // Key exists but has no TTL (shouldn't happen)
          await this.redis.del(key);
          staleCount++;
        }
      }
    } while (cursor !== '0');

    if (staleCount > 0) {
      console.log(`Cleaned up ${staleCount} stale driver requests`);
    }

  } catch (error) {
    console.error('Error cleaning up stale requests:', error);
  }
}
  // ==================== ADMIN METHODS ====================

  async handleAdminDriverAssignment(adminId, rideId, driverId) {
    try {
      const Ride = require('../models/Ride');
      const Driver = require('../models/Driver');

      const ride = await Ride.findById(rideId);
      if (!ride) {
        return { success: false, message: 'Ride not found' };
      }
      if (ride.driverId) {
        return { success: false, message: 'Ride already has a driver assigned' };
      }

      const driver = await Driver.findById(driverId);
      if (!driver) {
        return { success: false, message: 'Driver not found' };
      }

      await Ride.findByIdAndUpdate(rideId, {
        driverId,
        status: 'confirmed',
        acceptedAt: new Date(),
        assignedBy: adminId,
        assignmentType: 'manual',
        $push: {
          driverResponses: {
            driverId,
            response: 'admin_assigned',
            assignedBy: adminId,
            respondedAt: new Date()
          }
        }
      });

      await Driver.findByIdAndUpdate(driverId, {
        isAvailable: false,
        currentRide: rideId
      });

      // Notify driver
      this.io.to(`driver_${driverId}`).emit('admin_assigned_ride', {
        rideId,
        message: 'You have been assigned a ride by admin',
        rideDetails: {
          rideType: ride.rideType,
          pickup: ride.pickupLocation,
          dropoff: ride.dropoffLocation,
          scheduledTime: ride.scheduledTime,
          estimatedFare: ride.estimatedFare
        }
      });

      // Notify user
      this.emitToUser(ride.userId.toString(), 'ride_confirmed', {
        rideId,
        driver: {
          id: driver._id,
          name: driver.name,
          phone: driver.phone,
          vehicle: driver.vehicle,
          rating: driver.rating
        },
        message: 'Your ride has been confirmed!'
      });

      // Cancel other pending requests
      await this.cancelOtherDriverRequests(rideId, driverId);

      return {
        success: true,
        message: `Driver ${driver.name} assigned successfully`
      };

    } catch (error) {
      console.error('Error in admin driver assignment:', error);
      return {
        success: false,
        message: 'Error assigning driver'
      };
    }
  }

  async notifyAdminForManualAssignment(rideId) {
    const ride = await this.getRideDetails(rideId);
    
    const Ride = require('../models/Ride');
    await Ride.findByIdAndUpdate(rideId, {
      status: 'pending_admin_assignment'
    });

    // Notify user about the delay
    this.emitToUser(ride.userId.toString(), 'driver_search_delayed', {
      rideId,
      message: 'We are finding the best driver for you. This may take a few more minutes.'
    });

    // Get available drivers
    const availableDrivers = await this.getAllAvailableDrivers(ride.vehicleType, ride.rideType);

    this.io.to('admin_room').emit('manual_assignment_required', {
      rideId,
      userId: ride.userId,
      rideType: ride.rideType,
      route: `${ride.pickupLocation.address} to ${ride.dropoffLocation.address}`,
      scheduledTime: ride.scheduledTime,
      vehicleType: ride.vehicleType,
      estimatedFare: ride.estimatedFare,
      availableDrivers,
      driverResponses: ride.driverResponses,
      message: 'No drivers accepted this ride. Manual assignment required.'
    });
  }

  async getAllAvailableDrivers(vehicleType, rideType) {
    const Driver = require('../models/Driver');
    
    const query = {
      vehicleType
    };

    if (rideType === 'outstation') {
      query.isOutstationEnabled = true;
    } else if (rideType === 'airport') {
      query.isAirportEnabled = true;
    }

    const drivers = await Driver.find(query)
      .select('name phone rating plan completedRides isAvailable');

    return drivers.map(driver => ({
      id: driver._id,
      name: driver.name,
      phone: driver.phone,
      rating: driver.rating,
      plan: driver.plan,
      experience: driver.completedRides || 0,
      currentlyAvailable: driver.isAvailable
    }));
  }

  async getRideStatus(rideId) {
    try {
      const Ride = require('../models/Ride');
      const ride = await Ride.findById(rideId)
        .populate('userId', 'name phone email')
        .populate('driverId', 'name phone vehicle rating');

      if (!ride) {
        return { error: 'Ride not found' };
      }

      const searchStatus = await this.redis.get(`ride_request:${rideId}`);
      const searchData = searchStatus ? JSON.parse(searchStatus) : null;

      return {
        rideId,
        rideType: ride.rideType,
        status: ride.status,
        user: ride.userId,
        driver: ride.driverId,
        route: {
          pickup: ride.pickupLocation,
          dropoff: ride.dropoffLocation
        },
        scheduledTime: ride.scheduledTime,
        estimatedFare: ride.estimatedFare,
        tripType: ride.tripType,
        driverResponses: ride.driverResponses,
        searchStatus: searchData,
        assignedBy: ride.assignedBy,
        assignmentType: ride.assignmentType,
        cancelledBy: ride.cancelledBy,
        cancellationReason: ride.cancellationReason || ride.driverCancellationReason
      };

    } catch (error) {
      console.error('Error getting ride status:', error);
      return { error: 'Error fetching ride status' };
    }
  }

  // ==================== HELPER METHODS ====================

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  toRad(deg) {
    return deg * (Math.PI/180);
  }

  calculateDriverEarnings(fare, rideType) {
    // Different commission based on ride type
    const commission = {
      local: 0.75,      // 75% to driver
      airport: 0.75,    // 75% to driver
      outstation: 0.80  // 80% to driver
    };
    
    const rate = commission[rideType] || 0.75;
    return Math.round(fare * rate);
  }

  async getRideDetails(rideId) {
    const Ride = require('../models/Ride');
    const ride = await Ride.findById(rideId).populate('userId', 'name rating');
    return ride;
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

  async verifyAdminToken(token) {
    const jwt = require('jsonwebtoken');
    const Admin = require('../models/Admin');
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const admin = await Admin.findById(decoded.id);
      return admin;
    } catch (error) {
      return null;
    }
  }

  emitToUser(userId, event, data) {
    this.io.to(`user_${userId}`).emit(event, data);
  }

  emitToDriver(driverId, event, data) {
    this.io.to(`driver_${driverId}`).emit(event, data);
  }

  handleDisconnection(socket) {
    const userId = this.socketUsers.get(socket.id);
    const driverId = this.socketDrivers.get(socket.id);
    const adminId = this.socketAdmins.get(socket.id);
    
      console.log(`User ${userId} disconnected`);
    }
    
    if (driverId) {
      this.driverSockets.delete(driverId);
      this.socketDrivers.delete(socket.id);
      this.redis.hSet(`driver:${driverId}:status`, 'available', 'false');
      console.log(`Driver ${driverId} disconnected`);
    }

    if (adminId) {
      this.adminSockets.delete(adminId);
      this.socketAdmins.delete(socket.id);
      console.log(`Admin ${adminId} disconnected`);
    }
  }


// Export the function that creates the SocketHandler instance
module.exports = (server) => {
  return new SocketHandler(server);
};