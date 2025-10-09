const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  // User and Driver References
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  driverId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Driver' 
  },
  
  // Driver Details (stored for quick access)
  driverName: { type: String },
  driverPhone: { type: String },
  driverVehicle: {
    model: { type: String },
    number: { type: String },
    color: { type: String }
  },

  // Ride Type Configuration
  rideType: {
    type: String,
    enum: ['local', 'outstation', 'airport'],
    required: true
  },
  bookingType: {
    type: String,
    enum: ['now', 'scheduled'],
    default: 'now'
  },

  // Location Details
  pickupLocation: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    address: { type: String, required: true },
    placeId: { type: String }
  },
  dropoffLocation: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    address: { type: String, required: true },
    placeId: { type: String }
  },

  // Vehicle Configuration
  vehicleType: { 
    type: String, 
    required: true,
    enum: ['goelite', 'gosuv']
  },

  // Ride Status
status: { 
  type: String, 
  enum: [
    // Booking Phase
    'searching',                    // User booked, searching for driver
    'scheduled',                    // Outstation ride scheduled for later
    'no_drivers_available',         // No drivers found
    'pending_admin_assignment',     // Waiting for admin to assign manually
    
    // Assignment Phase
    'driver_assigned',              // Driver accepted the ride
    'driver_confirmed',             // Driver confirmed, heading to pickup
    
    // Pickup Phase
    'driver_arrived',               // Driver reached pickup locatio    
    // Journey Phase
    'ride_started',                 // Ride in progress
    
    // Completion Phase
    'ride_completed',               // Ride finished successfully
    
    // Cancellation
    'cancelled'                     // Ride cancelled (by user/driver/system)
  ],
  default: 'searching'
},

  // Fare and Distance
  estimatedFare: { type: Number, required: true },
  finalFare: { type: Number },
  estimatedDistance: { type: Number }, // in kilometers
  estimatedDuration: { type: Number }, // in minutes
  actualDistance: { type: Number },
  actualDuration: { type: Number },

  // Outstation Specific Fields
  tripType: {
    type: String,
    enum: ['one-way', 'round-trip'],
  },
  scheduledTime: { type: Date },
  returnDate: { type: Date },

  // Search Management
  searchingStarted: { type: Boolean, default: false },
  searchStartedAt: { type: Date },
  searchAttempts: { type: Number, default: 0 },

  // Driver Response Tracking
  driverResponses: [{
    driverId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Driver' 
    },
    driverName: { type: String },
    driverPhone: { type: String },
    driverRating: { type: Number },
    response: { 
      type: String, 
      enum: ['accepted', 'declined', 'no_response', 'admin_assigned'],
      required: true 
    },
    reason: { type: String }, // Decline reason
    respondedAt: { type: Date, default: Date.now },
    assignedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Admin' 
    } // For admin assignments
  }],

  // Admin Assignment Fields
  assignedBy: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Admin' 
  },
  assignmentType: {
    type: String,
    enum: ['automatic', 'manual']
  },

  // Timestamps
  createdAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date },
  arrivedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  cancelledAt: { type: Date },

  // Cancellation Details
  cancelledBy: { 
    type: String, 
    enum: ['user', 'driver', 'system', 'admin'] 
  },
  cancellationReason: { type: String },
  driverCancellationReason: { type: String },
  driverCancelledAt: { type: Date },
otpVerifiedAt: { type: Date },
otp: { type: String },
  // Ratings and Feedback
  userRating: { type: Number, min: 1, max: 5 },
  driverRating: { type: Number, min: 1, max: 5 },
  userFeedback: { type: String },
  driverFeedback: { type: String },

  // Payment
  paymentMethod: { 
    type: String, 
    enum: ['cash', 'card', 'wallet', 'upi'], 
    default: 'cash' 
  },
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'completed', 'failed', 'refunded'], 
    default: 'pending' 
  },
  transactionId: { type: String },

  // Commission and Earnings
  platformCommission: { type: Number },
  driverEarnings: { type: Number },

  // Additional Metadata
  notes: { type: String }, // Special instructions
  promoCode: { type: String },
  discount: { type: Number, default: 0 },

  // Tracking
  route: [{
    lat: { type: Number },
    lng: { type: Number },
    timestamp: { type: Date }
  }]

}, {
  timestamps: true // Adds updatedAt automatically
});

// Indexes for Performance
rideSchema.index({ userId: 1, createdAt: -1 });
rideSchema.index({ driverId: 1, createdAt: -1 });
rideSchema.index({ status: 1 });
rideSchema.index({ createdAt: -1 });
rideSchema.index({ rideType: 1, status: 1 });
rideSchema.index({ scheduledTime: 1, status: 1 }); // For scheduled rides
rideSchema.index({ 'driverResponses.driverId': 1 }); // For driver history queries

// Virtual for total fare after discount
rideSchema.virtual('totalFare').get(function() {
  return this.finalFare || this.estimatedFare - (this.discount || 0);
});

// Method to check if ride is cancellable
rideSchema.methods.isCancellable = function() {
  return ['searching', 'scheduled', 'pending_acceptance', 'confirmed', 'accepted'].includes(this.status);
};

// Method to check if ride is active
rideSchema.methods.isActive = function() {
  return ['accepted', 'driver_arrived', 'in_progress'].includes(this.status);
};

// Method to check if ride needs driver assignment
rideSchema.methods.needsDriverAssignment = function() {
  return ['searching', 'scheduled', 'no_drivers_available', 'pending_admin_assignment'].includes(this.status) && !this.driverId;
};

// Static method to find rides needing scheduled assignment
rideSchema.statics.findScheduledRidesNeedingAssignment = function() {
  const now = new Date();
  const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);
  
  return this.find({
    rideType: 'outstation',
    status: 'scheduled',
    scheduledTime: {
      $gte: now,
      $lte: oneHourFromNow
    },
    driverId: null,
    searchingStarted: { $ne: true }
  });
};

// Pre-save middleware to calculate platform commission and driver earnings
rideSchema.pre('save', function(next) {
  if (this.finalFare && !this.driverEarnings) {
    const commissionRate = this.rideType === 'outstation' ? 0.20 : 0.25; // 20% for outstation, 25% for others
    this.platformCommission = Math.round(this.finalFare * commissionRate);
    this.driverEarnings = this.finalFare - this.platformCommission;
  }
  next();
});

module.exports = mongoose.model('Ride', rideSchema);