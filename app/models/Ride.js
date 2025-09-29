const mongoose = require('mongoose');

const rideSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  driverId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Driver' 
  },

  pickupLocation: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    address: { type: String, required: true },
    placeId: { type: String } // ✅ Added
  },
  dropoffLocation: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    address: { type: String, required: true },
    placeId: { type: String,  } // ✅ Added
  },

  vehicleType: { 
    type: String, 
    required: true,
    enum: ['goelite','gosuv']
  },
  status: { 
    type: String, 
    enum: [
      'searching', 
      'pending_acceptance', 
      'accepted', 
      'driver_arrived', 
      'in_progress', 
      'completed', 
      'cancelled'
    ],
    default: 'searching'
  },
  estimatedFare: { type: Number, required: true },
  finalFare: { type: Number },
  distance: { type: Number },
  duration: { type: Number },

  createdAt: { type: Date, default: Date.now },
  acceptedAt: { type: Date },
  arrivedAt: { type: Date },
  startedAt: { type: Date },
  completedAt: { type: Date },
  cancelledAt: { type: Date },

  cancelledBy: { 
    type: String, 
    enum: ['user', 'driver', 'system'] 
  },
  cancellationReason: { type: String },
  searchAttempts: { type: Number, default: 0 },

  userRating: { type: Number, min: 1, max: 5 },
  driverRating: { type: Number, min: 1, max: 5 },
  userFeedback: { type: String },
  driverFeedback: { type: String },

  paymentMethod: { 
    type: String, 
    enum: ['cash', 'card', 'wallet'], 
    default: 'cash' 
  },
  paymentStatus: { 
    type: String, 
    enum: ['pending', 'completed', 'failed'], 
    default: 'pending' 
  }
}, {
  timestamps: true
});

rideSchema.index({ userId: 1, createdAt: -1 });
rideSchema.index({ driverId: 1, createdAt: -1 });
rideSchema.index({ status: 1 });
rideSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Ride', rideSchema);
