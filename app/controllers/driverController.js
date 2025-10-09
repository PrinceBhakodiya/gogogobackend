const Driver = require('../models/Driver');
const jwt = require('jsonwebtoken');
const { sendOTP, verifyOTP } = require('../services/otp_service');
const Ride = require('../models/Ride');

class DriverController {
  // ==================== AUTHENTICATION METHODS ====================
 async sendOTP(req, res) {
    try {
      const { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ success: false, message: 'Phone number is required' });
      }

      // Basic validation
      const phoneRegex = /^\+?[1-9]\d{1,14}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({ success: false, message: 'Invalid phone number format' });
      }

      const cleanPhone = phone.replace(/\D/g, '');
      let driver = await Driver.findOne({ phone: cleanPhone });

      if (!driver) {
        driver = new Driver({
          phone: cleanPhone,
          registrationStatus: 'pending',
        });
        await driver.save();
      }

      // Dummy OTP setup
      const dummyOTP = '1234';

      // Optionally, you can store OTP temporarily in DB if needed
      driver.tempOTP = dummyOTP;
      driver.otpExpiresAt = Date.now() + 5 * 60 * 1000; // 5 mins
      await driver.save();

      res.json({
        success: true,
        message: 'OTP (1234) sent successfully [Dummy mode]',
        data: { phone: cleanPhone, otp: dummyOTP, expiresIn: '5 minutes' },
      });
    } catch (error) {
      console.error('Send OTP error:', error);
      res.status(500).json({ success: false, message: 'Failed to send OTP' });
    }
  }
  async verifyOtp(req, res) {
    try {
      const { phone, otp } = req.body;
      if (!phone || !otp) {
        return res.status(400).json({ success: false, message: 'Phone number and OTP are required' });
      }

      const cleanPhone = phone.replace(/\D/g, '');
      const driver = await Driver.findOne({ phone: cleanPhone });

      if (!driver) {
        return res.status(400).json({ success: false, message: 'Driver not found' });
      }

      // // Check dummy OTP
      // if (otp !== '1234') {
      //   return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
      // }

      driver.onboardingSteps.otp = true;
      await driver.save();

      const token = jwt.sign(
        { id: driver._id, phone: driver.phone, role: 'driver' },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
      );

      res.json({
        success: true,
        message: 'OTP verified successfully',
        data: {
          driver: {
            id: driver._id,
            phone: driver.phone,
            onboardingSteps: driver.onboardingSteps,
          },
          token,
        },
      });
    } catch (error) {
      console.error('Verify OTP error:', error);
      res.status(500).json({ success: false, message: 'Failed to verify OTP' });
    }
  }
  // ==================== ONBOARDING METHODS ====================

  async savePersonal(req, res) {
    try {
      const driverId = req.driver.id;
      const { name, dob, gender } = req.body;

      if (!name || !dob || !gender) {
        return res.status(400).json({ success: false, message: 'Missing personal info' });
      }

      const driver = await Driver.findByIdAndUpdate(
        driverId,
        {
          personalDetails: { name, dob: new Date(dob), gender },
          'onboardingSteps.personal': true,
        },
        { new: true }
      );

      res.json({
        success: true,
        message: 'Personal info saved successfully',
        data: { personalDetails: driver.personalDetails, onboardingSteps: driver.onboardingSteps },
      });
    } catch (error) {
      console.error('Save personal error:', error);
      res.status(500).json({ success: false, message: 'Failed to save personal info' });
    }
  }

  async saveVehicle(req, res) {
    try {
      const driverId = req.driver.id;
      const { vehicleType, vehicleNumber, vehicleBrand, vehicleYear, vehicleColor } = req.body;

      if (!vehicleType || !vehicleNumber || !vehicleBrand) {
        return res.status(400).json({ success: false, message: 'Missing vehicle info' });
      }

      const driver = await Driver.findByIdAndUpdate(
        driverId,
        {
          vehicleDetails: {
            type: vehicleType,
            carNumber: vehicleNumber,
            brand: vehicleBrand,
            year: vehicleYear,
            color: vehicleColor,
          },
          'onboardingSteps.vehicle': true,
        },
        { new: true }
      );

      res.json({
        success: true,
        message: 'Vehicle info saved successfully',
        data: { vehicleDetails: driver.vehicleDetails, onboardingSteps: driver.onboardingSteps },
      });
    } catch (error) {
      console.error('Save vehicle error:', error);
      res.status(500).json({ success: false, message: 'Failed to save vehicle info' });
    }
  }

  async uploadDoc(req, res) {
    try {
      const driverId = req.driver.id;
      const files = req.files;
      const { number, documentType } = req.body;

      if (!files || files.length === 0) {
        return res.status(400).json({ success: false, message: 'No documents uploaded' });
      }

      const docData = {
        number: number || undefined,
        front: files[0]?.path,
        back: documentType !== 'selfie' ? files[1]?.path : undefined,
      };

      const updateObj = {};
      updateObj[`documents.${documentType}`] = docData;
      updateObj[`onboardingSteps.documents`] = true;

      const driver = await Driver.findByIdAndUpdate(driverId, updateObj, { new: true });

      res.json({
        success: true,
        message: `${documentType} uploaded successfully`,
        data: { documents: driver.documents, onboardingSteps: driver.onboardingSteps },
      });
    } catch (error) {
      console.error('Upload doc error:', error);
      res.status(500).json({ success: false, message: 'Failed to upload documents' });
    }
  }

  async saveBackground(req, res) {
    try {
      const driverId = req.driver.id;
      const { criminalRecord, trafficViolations, experience } = req.body;

      if (criminalRecord === undefined || !trafficViolations || !experience) {
        return res.status(400).json({ success: false, message: 'Missing background info' });
      }

      const driver = await Driver.findByIdAndUpdate(
        driverId,
        {
          backgroundInfo: {
            hasCriminalRecord: criminalRecord,
            trafficViolations,
            drivingExperience: experience,
          },
          'onboardingSteps.background': true,
        },
        { new: true }
      );

      if (Object.values(driver.onboardingSteps).every(Boolean)) {
        driver.registrationStatus = 'pending_approval';
        await driver.save();
      }

      res.json({
        success: true,
        message: 'Background info saved successfully',
        data: {
          backgroundInfo: driver.backgroundInfo,
          onboardingSteps: driver.onboardingSteps,
          registrationStatus: driver.registrationStatus,
        },
      });
    } catch (error) {
      console.error('Save background error:', error);
      res.status(500).json({ success: false, message: 'Failed to save background info' });
    }
  }
async  getStatus(req, res) {
  try {
    const driverId = req.driver.id;
    const driver = await Driver.findById(driverId).select(
      'verificationSteps registrationStatus onboardingSteps personalDetails vehicleDetails documents backgroundInfo insurance'
    );

    if (!driver) return res.status(404).json({ success: false, message: 'Driver not found' });

    const steps = driver.onboardingSteps || {};

    // Inline nextStep logic
    const nextStep = !steps.personal
      ? 'personal'
      : !steps.vehicle
      ? 'vehicle'
      : !steps.documents
      ? 'documents'
      : !steps.background
      ? 'background'
      : !steps.insurance
      ? 'insurance'
      : 'completed';

    const completedSteps = Object.values(steps).filter(Boolean).length;
    const totalSteps = Object.keys(steps).length;

    res.json({
      success: true,
      data: {
        registrationStatus: driver.registrationStatus,
        verificationSteps: driver.verificationSteps,
        onboardingSteps: steps,
        completionPercentage: Math.round((completedSteps / totalSteps) * 100),
        nextStep,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to get status' });
  }
}


  async getProfile(req, res) {
    try {
      const driverId = req.driver.id;
      const driver = await Driver.findById(driverId).select('-otp -otpExpiry');
      res.json({ success: true, data: driver });
    } catch (error) {
      console.error('Get profile error:', error);
      res.status(500).json({ success: false, message: 'Failed to get profile' });
    }
  }

async updateToggle(req, res) {
  try {
    const driverId = req.driver.id;
    
    // Find the driver
    const driver = await Driver.findById(driverId);
    
    if (!driver) {
      return res.status(404).json({ 
        success: false, 
        message: 'Driver not found' 
      });
    }
    
    // Toggle isAvailable: if true, set to false; if false, set to true
    driver.isAvailable = !driver.isAvailable;
    
    // Save the updated driver
    await driver.save();
    
    res.json({ 
      success: true, 
      data: driver,
      message: `Driver is now ${driver.isAvailable ? 'available' : 'unavailable'}`
    });
  } catch (error) {
    console.error('Update toggle error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to update availability status' 
    });
  }
}
  // ==================== REALTIME STATUS ====================

  async updateLocation(req, res) {
    try {
      const driverId = req.driver.id;
      const { lat, lng, heading } = req.body;
      if (!lat || !lng) {
        return res.status(400).json({ success: false, message: 'Latitude & longitude are required' });
      }

      await Driver.findByIdAndUpdate(driverId, {
        currentLocation: {
          type: 'Point',
          coordinates: [lng, lat],
          heading: heading || 0,
          updatedAt: new Date(),
        },
      });

      const redisClient = req.app.get('redisClient');
      if (redisClient) {
        await redisClient.hSet(`driver:${driverId}:location`, {
          lat: lat.toString(),
          lng: lng.toString(),
          heading: (heading || 0).toString(),
          updatedAt: Date.now().toString(),
        });
      }

      res.json({ success: true, message: 'Location updated successfully' });
    } catch (error) {
      console.error('Update location error:', error);
      res.status(500).json({ success: false, message: 'Failed to update location' });
    }
  }

  async toggleAvailability(req, res) {
    try {
      const driverId = req.driver.id;
      const { isAvailable } = req.body;

      const driver = await Driver.findByIdAndUpdate(driverId, { isAvailable }, { new: true });

      const redisClient = req.app.get('redisClient');
      console.log(isAvailable);
      // console.log(redisClient.hGet)
      if (redisClient) {
        await redisClient.hSet(`driver:${driverId}:status`, 'available', isAvailable.toString());
      }

      res.json({
        success: true,
        message: `Driver ${isAvailable ? 'available' : 'offline'}`,
        data: { isAvailable: driver.isAvailable },
      });
    } catch (error) {
      console.error('Toggle availability error:', error);
      res.status(500).json({ success: false, message: 'Failed to update availability' });
    }
  }
async getEarnings(req, res) {
  try {
    const driverId = req.driver._id;
    const { period = 'weekly' } = req.query;

    // Calculate date range based on period
    let startDate, endDate;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (period === 'daily') {
      startDate = new Date(today);
      endDate = new Date(today);
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'weekly') {
      const dayOfWeek = today.getDay();
      const diff = today.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      startDate = new Date(today.setDate(diff));
      endDate = new Date();
      endDate.setHours(23, 59, 59, 999);
    } else if (period === 'monthly') {
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
    }

    // Get today's earnings
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const todayEarnings = await Ride.aggregate([
      {
        $match: {
          driverId: driverId,
          status: 'completed',
          completedAt: { $gte: todayStart, $lte: todayEnd }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$finalFare' }
        }
      }
    ]);

    // Get weekly/period data for chart
    const periodData = await Ride.aggregate([
      {
        $match: {
          driverId: driverId,
          status: 'completed',
          completedAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { 
            $dateToString: { format: '%Y-%m-%d', date: '$completedAt' }
          },
          amount: { $sum: '$finalFare' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Format weekly data for chart (7 days)
    const formattedWeeklyData = [];
    const daysOfWeek = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    
    for (let i = 0; i < 7; i++) {
      const date = new Date(startDate);
      date.setDate(startDate.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      
      const dayData = periodData.find(d => d._id === dateStr);
      
      formattedWeeklyData.push({
        day: daysOfWeek[i],
        date: date.getDate().toString(),
        amount: dayData ? dayData.amount : 0
      });
    }

    // Get daily trip earnings (last 30 days for history)
    const last30DaysStart = new Date();
    last30DaysStart.setDate(last30DaysStart.getDate() - 30);
    last30DaysStart.setHours(0, 0, 0, 0);

    const dailyTripEarnings = await Ride.aggregate([
      {
        $match: {
          driverId: driverId,
          status: 'completed',
          completedAt: { $gte: last30DaysStart, $lte: endDate }
        }
      },
      {
        $group: {
          _id: { 
            $dateToString: { format: '%Y-%m-%d', date: '$completedAt' }
          },
          amount: { $sum: '$finalFare' },
          tripCount: { $sum: 1 }
        }
      },
      { $sort: { _id: -1 } },
      { $limit: 10 } // Last 10 days with trips
    ]);

    // Format daily trips
    const formattedDailyTrips = dailyTripEarnings.map(trip => {
      const tripDate = new Date(trip._id);
      const dayName = tripDate.toLocaleDateString('en-US', { weekday: 'short' });
      const dayNum = tripDate.getDate().toString().padStart(2, '0');
      const monthNum = (tripDate.getMonth() + 1).toString().padStart(2, '0');
      
      // Check if date is older than 7 days (disabled for viewing)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const isDisabled = tripDate < sevenDaysAgo;

      return {
        date: `${dayName},${dayNum}/${monthNum}`,
        amount: trip.amount,
        trip_count: trip.tripCount,
        is_disabled: isDisabled
      };
    });

    // Get total statistics for the period
    const totalStats = await Ride.aggregate([
      {
        $match: {
          driverId: driverId,
          status: 'completed',
          completedAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: '$finalFare' },
          totalTrips: { $sum: 1 },
          avgFare: { $avg: '$finalFare' }
        }
      }
    ]);

    const stats = totalStats[0] || {
      totalEarnings: 0,
      totalTrips: 0,
      avgFare: 0
    };

    // Format today's date
    const todayFormatted = new Date().toLocaleDateString('en-US', { 
      weekday: 'short', 
      day: 'numeric',
      month: 'short'
    });

    res.json({
      success: true,
      data: {
        today_earning: todayEarnings[0]?.total || 0,
        today_date: `Today, ${todayFormatted}`,
        period: period,
        weekly_data: formattedWeeklyData,
        daily_trips: formattedDailyTrips,
        statistics: {
          total_earnings: stats.totalEarnings,
          total_trips: stats.totalTrips,
          average_fare: Math.round(stats.avgFare)
        }
      }
    });

  } catch (error) {
    console.error('Get Earnings Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings',
      error: error.message
    });
  }
}

// Additional endpoint for detailed daily earnings with trip breakdown
async getDailyEarningsDetail(req, res) {
  try {
    const driverId = req.driver._id;
    const { date } = req.query; // Format: YYYY-MM-DD

    if (!date) {
      return res.status(400).json({
        success: false,
        message: 'Date parameter is required'
      });
    }

    const selectedDate = new Date(date);
    selectedDate.setHours(0, 0, 0, 0);
    const endDate = new Date(selectedDate);
    endDate.setHours(23, 59, 59, 999);

    // Get all completed trips for that day
    const trips = await Ride.find({
      driverId: driverId,
      status: 'completed',
      completedAt: { $gte: selectedDate, $lte: endDate }
    })
    .select('pickupLocation dropoffLocation finalFare estimatedDistance completedAt rideType')
    .sort({ completedAt: -1 })
    .lean();

    // Calculate total earnings
    const totalEarnings = trips.reduce((sum, trip) => sum + trip.finalFare, 0);

    // Format trips for response
    const formattedTrips = trips.map(trip => ({
      ride_id: trip._id,
      pickup: trip.pickupLocation?.address || 'N/A',
      dropoff: trip.dropoffLocation?.address || 'N/A',
      fare: trip.finalFare,
      distance: trip.estimatedDistance,
      ride_type: trip.rideType,
      completed_at: trip.completedAt,
      completed_time: new Date(trip.completedAt).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
      })
    }));

    res.json({
      success: true,
      data: {
        date: selectedDate.toLocaleDateString('en-US', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        }),
        total_earnings: totalEarnings,
        trip_count: trips.length,
        trips: formattedTrips
      }
    });

  } catch (error) {
    console.error('Get Daily Earnings Detail Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch daily earnings detail',
      error: error.message
    });
  }
}

// Endpoint for earnings summary (for dashboard)
async getEarningsSummary(req, res) {
  try {
    const driverId = req.driver._id;

    // Today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    // This week
    const weekStart = new Date();
    const dayOfWeek = weekStart.getDay();
    const diff = weekStart.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
    weekStart.setDate(diff);
    weekStart.setHours(0, 0, 0, 0);

    // This month
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [todayData, weekData, monthData] = await Promise.all([
      // Today's earnings
      Ride.aggregate([
        {
          $match: {
            driverId: driverId,
            status: 'completed',
            completedAt: { $gte: todayStart, $lte: todayEnd }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$finalFare' },
            trips: { $sum: 1 }
          }
        }
      ]),

      // Week's earnings
      Ride.aggregate([
        {
          $match: {
            driverId: driverId,
            status: 'completed',
            completedAt: { $gte: weekStart }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$finalFare' },
            trips: { $sum: 1 }
          }
        }
      ]),

      // Month's earnings
      Ride.aggregate([
        {
          $match: {
            driverId: driverId,
            status: 'completed',
            completedAt: { $gte: monthStart }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$finalFare' },
            trips: { $sum: 1 }
          }
        }
      ])
    ]);

    res.json({
      success: true,
      data: {
        today: {
          earnings: todayData[0]?.total || 0,
          trips: todayData[0]?.trips || 0
        },
        this_week: {
          earnings: weekData[0]?.total || 0,
          trips: weekData[0]?.trips || 0
        },
        this_month: {
          earnings: monthData[0]?.total || 0,
          trips: monthData[0]?.trips || 0
        }
      }
    });

  } catch (error) {
    console.error('Get Earnings Summary Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch earnings summary',
      error: error.message
    });
  }
}

async getTripHistory(req, res) {
  try {
    const driverId = req.driver._id;
    const {
      filter = 'all',       // local | outstation | airport | all
      duration = 'all',     // today | week | month | all
      page = 1,
      limit = 20,
      startDate,
      endDate
    } = req.query;

    const skip = (page - 1) * limit;

    // Base query
    const query = {
      driverId: driverId,
      status: { $in: ['completed', 'cancelled'] }
    };

    // 1️⃣ Filter by ride type
    if (filter !== 'all') {
      query.rideType = filter;
    }

    // 2️⃣ Dynamic date filter
    let fromDate, toDate;
    const now = new Date();

    if (startDate && endDate) {
      // Custom range
      fromDate = new Date(startDate);
      toDate = new Date(endDate);
    } else if (duration === 'today') {
      fromDate = new Date();
      fromDate.setHours(0, 0, 0, 0);
      toDate = new Date();
      toDate.setHours(23, 59, 59, 999);
    } else if (duration === 'week') {
      fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - 7);
      toDate = now;
    } else if (duration === 'month') {
      fromDate = new Date();
      fromDate.setMonth(fromDate.getMonth() - 1);
      toDate = now;
    }

    if (fromDate && toDate) {
      query.completedAt = { $gte: fromDate, $lte: toDate };
    }

    // 3️⃣ Fetch trips
    const trips = await Ride.find(query)
      .populate('userId', 'name mobile profilePicture')
      .sort({ completedAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    // 4️⃣ Summary stats
    const summary = await Ride.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          total_trips: { $sum: 1 },
          completed_trips: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
          },
          cancelled_trips: {
            $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
          },
          total_earnings: {
            $sum: {
              $cond: [{ $eq: ['$status', 'completed'] }, '$finalFare', 0]
            }
          }
        }
      }
    ]);

    // 5️⃣ Format trips for response
    const formattedTrips = trips.map(trip => {
      const durationMin = trip.startedAt && trip.completedAt
        ? Math.round((new Date(trip.completedAt) - new Date(trip.startedAt)) / 60000)
        : 0;

      return {
        trip_id: trip._id,
        amount: trip.finalFare || trip.estimatedFare,
        date: trip.completedAt || trip.createdAt,
        start_time: trip.startedAt,
        end_time: trip.completedAt,
        duration: durationMin,
        pickup_location: trip.pickupLocation?.address || '',
        dropoff_location: trip.dropoffLocation?.address || '',
        user: {
          _id: trip.userId?._id,
          name: trip.userId?.name || 'Unknown',
          phone: trip.userId?.mobile,
          avatar: trip.userId?.profilePicture
        },
        status: trip.status,
        payment_method: trip.paymentMethod,
        rating: trip.driverRating,
        distance: trip.distance,
        ride_type: trip.rideType
      };
    });

    // 6️⃣ Pagination
    const totalCount = await Ride.countDocuments(query);

    // ✅ Response
    res.json({
      success: true,
      data: {
        summary: {
          total_trips: summary[0]?.total_trips || 0,
          completed_trips: summary[0]?.completed_trips || 0,
          cancelled_trips: summary[0]?.cancelled_trips || 0,
          total_earnings: summary[0]?.total_earnings || 0
        },
        trips: formattedTrips,
        pagination: {
          current_page: parseInt(page),
          total_pages: Math.ceil(totalCount / limit),
          total_records: totalCount
        }
      }
    });

  } catch (error) {
    console.error('Get Trip History Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trip history',
      error: error.message
    });
  }
}

async getCurrentRide(req, res) {
  try {
    const driverId = req.driver._id;

    // Find active ride for this driver
    const activeRide = await Ride.findOne({
      driverId: driverId,
      status: { 
        $nin: ['completed', 'cancelled', 'no_drivers_available', 'searching'] 
      }
    })
    .populate('userId', 'name mobile profilePicture')
    .sort({ createdAt: -1 })
    .lean();

    if (!activeRide) {
      return res.json({
        success: true,
        data: {
          has_active_ride: false,
          ride: null
        }
      });
    }

    res.json({
      success: true,
      data: {
        has_active_ride: true,
        ride: activeRide
      }
    });

  } catch (error) {
    console.error('Get Current Ride Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch current ride',
      error: error.message
    });
  }
}

async getTripDetails  (req, res)  {
  try {
    const driverId = req.driver._id;
    const { tripId } = req.params;

    const trip = await Ride.findOne({
      _id: tripId,
      driverId: driverId
    }).populate('userId', 'name phone profilePicture email');

    if (!trip) {
      return res.status(404).json({
        success: false,
        message: 'Trip not found'
      });
    }

    const duration = trip.startedAt && trip.completedAt
      ? Math.round((new Date(trip.completedAt) - new Date(trip.startedAt)) / 60000)
      : 0;

    res.json({
      success: true,
      data: {
        trip_id: trip._id,
        status: trip.status,
        vehicle_type: trip.vehicleType,
        
        // Location details
        pickup: {
          address: trip.pickupLocation.address,
          lat: trip.pickupLocation.lat,
          lng: trip.pickupLocation.lng
        },
        dropoff: {
          address: trip.dropoffLocation.address,
          lat: trip.dropoffLocation.lat,
          lng: trip.dropoffLocation.lng
        },
        
        // Trip details
        distance: trip.distance,
        duration: duration,
        estimated_fare: trip.estimatedFare,
        final_fare: trip.finalFare,
        
        // Passenger details
        passenger: {
          name: trip.userId?.name,
          phone: trip.userId?.phone,
          email: trip.userId?.email,
          avatar: trip.userId?.profilePicture
        },
        
        // Timestamps
        created_at: trip.createdAt,
        accepted_at: trip.acceptedAt,
        started_at: trip.startedAt,
        completed_at: trip.completedAt,
        cancelled_at: trip.cancelledAt,
        
        // Rating & feedback
        rating: trip.driverRating,
        feedback: trip.driverFeedback,
        
        // Payment
        payment_method: trip.paymentMethod,
        payment_status: trip.paymentStatus,
        
        // Cancellation
        cancelled_by: trip.cancelledBy,
        cancellation_reason: trip.cancellationReason
      }
    });

  } catch (error) {
    console.error('Get Trip Details Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch trip details',
      error: error.message
    });
  }
};
}


/**
 * Get daily trip earnings with details
 * GET /api/driver/earnings/daily?page=1&limit=10
 */


// ==================== HISTORY CONTROLLER ====================

/**
 * Get trip history with filters
 * GET /api/driver/history?filter=local&page=1&limit=20
 */


/**
 * Get single trip details
 * GET /api/driver/history/:tripId
 */

module.exports = new DriverController();
