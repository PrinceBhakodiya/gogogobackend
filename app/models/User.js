const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    mobile: {
        type: String,
        required: true,
        unique: true,
        match: [/^[6-9]\d{9}$/, 'Please enter a valid 10-digit mobile number']
    },
    name: {
        type: String,
        trim: true,
        minlength: [2, 'Name must be at least 2 characters long'],
        maxlength: [50, 'Name cannot exceed 50 characters']
    },
    email: {
        type: String,
        lowercase: true,
        trim: true,
        match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email address'],
        sparse: true // Allows multiple documents with null email
    },
    dateOfBirth: {
        type: Date,
        validate: {
            validator: function(date) {
                if (!date) return true; // Allow null/undefined
                const today = new Date();
                const birthDate = new Date(date);
                const age = today.getFullYear() - birthDate.getFullYear();
                const monthDiff = today.getMonth() - birthDate.getMonth();
                
                if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
                    age--;
                }
                
                return age >= 16 && age <= 120; // Must be between 16 and 120 years old
            },
            message: 'User must be between 16 and 120 years old'
        }
    },
    gender: {
        type: String,
        enum: ['male', 'female', 'other'],
        lowercase: true
    },
    emergencyContact: {
        name: {
            type: String,
            trim: true,
            maxlength: [50, 'Emergency contact name cannot exceed 50 characters']
        },
        mobile: {
            type: String,
            match: [/^[6-9]\d{9}$/, 'Please enter a valid 10-digit emergency contact number']
        },
        relation: {
            type: String,
            enum: ['parent', 'spouse', 'sibling', 'friend', 'colleague', 'other'],
            lowercase: true
        }
    },
    profilePicture: {
        type: String, // URL to profile picture
    },
    address: {
        street: String,
        city: String,
        state: String,
        pincode: {
            type: String,
            match: [/^\d{6}$/, 'Please enter a valid 6-digit pincode']
        },
        coordinates: {
            latitude: {
                type: Number,
                min: [-90, 'Latitude must be between -90 and 90'],
                max: [90, 'Latitude must be between -90 and 90']
            },
            longitude: {
                type: Number,
                min: [-180, 'Longitude must be between -180 and 180'],
                max: [180, 'Longitude must be between -180 and 180']
            }
        }
    },
    preferences: {
        language: {
            type: String,
            default: 'english',
            enum: ['english', 'hindi', 'bengali', 'tamil', 'telugu', 'marathi', 'gujarati', 'kannada', 'malayalam', 'punjabi']
        },
        notifications: {
            push: { type: Boolean, default: true },
            sms: { type: Boolean, default: true },
            email: { type: Boolean, default: false }
        }
    },
    isProfileComplete: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isBlocked: {
        type: Boolean,
        default: false
    },
   
    totalRides: {
        type: Number,
        default: 0,
        min: [0, 'Total rides cannot be negative']
    },
    
    deviceInfo: {
        fcmToken: String, // For push notifications
        deviceId: String,
        platform: {
            type: String,
            enum: ['android', 'ios', 'web']
        },
        appVersion: String
    },
    lastLogin: {
        type: Date,
        default: Date.now
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    toJSON: { 
        transform: function(doc, ret) {
            ret.id = ret._id;
            delete ret._id;
            delete ret.__v;
            return ret;
        }
    }
});

// Indexes for better query performance
userSchema.index({ mobile: 1 });
userSchema.index({ email: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ createdAt: -1 });

// Pre-save middleware to update the updatedAt field
userSchema.pre('save', function(next) {
    if (this.isModified() && !this.isNew) {
        this.updatedAt = new Date();
    }
    next();
});

// Check if profile is complete
userSchema.methods.checkProfileComplete = function() {
    return !!(this.name && this.email);
};

// Calculate age
userSchema.methods.getAge = function() {
    if (!this.dateOfBirth) return null;
    
    const today = new Date();
    const birthDate = new Date(this.dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    
    return age;
};

// Update wallet balance
userSchema.methods.updateWallet = function(type, amount, description, transactionId) {
    const transaction = {
        type,
        amount,
        description,
        transactionId,
        createdAt: new Date()
    };
    
    if (type === 'credit') {
        this.wallet.balance += amount;
    } else if (type === 'debit' && this.wallet.balance >= amount) {
        this.wallet.balance -= amount;
    } else {
        throw new Error('Insufficient wallet balance');
    }
    
    this.wallet.transactions.push(transaction);
    return this.save();
};

module.exports = mongoose.model('User', userSchema);