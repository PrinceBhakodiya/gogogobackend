const User = require('../models/User');
const jwt = require('jsonwebtoken');
require('dotenv').config();
class UserService {
    // Create new user
    async createUser(userData) {
        try {
            const user = new User(userData);
            await user.save();
            return user;
        } catch (error) {
            throw new Error('Failed to create user: ' + error.message);
        }
    }

    // Get user by mobile number
    async getUserByMobile(mobile) {
        try {
            return await User.findOne({ mobile });
        } catch (error) {
            throw new Error('Failed to get user by mobile: ' + error.message);
        }
    }

    // Get user by ID
    async getUserById(userId) {
        try {
            return await User.findById(userId);
        } catch (error) {
            throw new Error('Failed to get user by ID: ' + error.message);
        }
    }

    // Update user
    async updateUser(userId, updateData) {
        try {
            const user = await User.findByIdAndUpdate(
                userId, 
                { ...updateData, updatedAt: new Date() },
                { new: true, runValidators: true }
            );
            if (!user) {
                throw new Error('User not found');
            }
            return user;
        } catch (error) {
            throw new Error('Failed to update user: ' + error.message);
        }
    }

  // Generate JWT token
 generateToken  (id, userType)  {
    const payload = {
        id,         // match middleware usage
        userType    // user | driver | admin
    };

    return jwt.sign(
        payload,
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );
};
    // Get user profile with additional details
    async getUserProfile(userId) {
        try {
            const user = await User.findById(userId).select('-__v');
            if (!user) {
                throw new Error('User not found');
            }
            return user;
        } catch (error) {
            throw new Error('Failed to get user profile: ' + error.message);
        }
    }

    // Check if email already exists
    async isEmailExists(email, excludeUserId = null) {
        try {
            const query = { email: email.toLowerCase() };
            if (excludeUserId) {
                query._id = { $ne: excludeUserId };
            }
            const user = await User.findOne(query);
            return !!user;
        } catch (error) {
            throw new Error('Failed to check email existence: ' + error.message);
        }
    }

    // Validate user data
    validateUserData(userData) {
        const errors = [];

        if (userData.name && userData.name.trim().length < 2) {
            errors.push('Name must be at least 2 characters long');
        }

        if (userData.email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(userData.email)) {
                errors.push('Invalid email format');
            }
        }

        if (userData.mobile) {
            const mobileRegex = /^[6-9]\d{9}$/;
            if (!mobileRegex.test(userData.mobile)) {
                errors.push('Invalid mobile number format');
            }
        }

        if (userData.gender && !['male', 'female', 'other'].includes(userData.gender.toLowerCase())) {
            errors.push('Gender must be male, female, or other');
        }

        return errors;
    }
}

module.exports = new UserService();