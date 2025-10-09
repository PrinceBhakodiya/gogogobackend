const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    number: { type: String },
    front: { type: String },
    back: { type: String },
    expiry: { type: Date },
    photo: { type: String }, // for selfie / insurance photo
  },
  { _id: false }
);

const backgroundSchema = new mongoose.Schema(
  {
    drivingExperience: { type: String },
    hasCriminalRecord: { type: Boolean, default: false },
    trafficViolations: { type: String },
  },
  { _id: false }
);

const driverSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, unique: true },
    planType: { type: String,default:'standard' },

    // ✅ Onboarding flow steps
    onboardingSteps: {
      vehicle: { type: Boolean, default: false },
      personal: { type: Boolean, default: false },
      documents: { type: Boolean, default: false },
      background: { type: Boolean, default: false },
      insurance: { type: Boolean, default: false },
      selfie: { type: Boolean, default: false },
      completed: { type: Boolean, default: false },
      currentStep: { type: String, default: "vehicle" }, // 👈 track where driver is
    },

    vehicleDetails: {
      type: { type: String, enum: ["goelite", "gosuv"] },
      carNumber: String,
      brand: String,
      year: Number,
      color: String,
    },

    personalDetails: {
      name: String,
      dob: Date,
      gender: { type: String, enum: ["Male", "Female", "Other"] },
    },

    documents: {
      aadhaar: documentSchema,
      pan: documentSchema,
      dl: documentSchema,
      rc: documentSchema,
      insurance: documentSchema,
      selfie: { type: String },
    },

    backgroundInfo: backgroundSchema,

    // ✅ Verification steps
    verificationSteps: {
      documentReview: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
      identityVerification: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
      backgroundCheck: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
      vehicleVerification: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
      finalApproval: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
    },

    // ✅ High-level registration status
    registrationStatus: {
      type: String,
      enum: ["pending", "in_progress", "pending_approval", "verified", "rejected"],
      default: "pending",
    },
totalAcceptances: { type: Number, default: 0 },
    isAvailable: { type: Boolean, default: false },
currentRide: { type: mongoose.Schema.Types.ObjectId, ref: "Ride" },
    currentLocation: {
      type: { type: String, default: "Point" },
      coordinates: [Number],
      heading: { type: Number, default: 0 },
      updatedAt: Date,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Driver", driverSchema);
