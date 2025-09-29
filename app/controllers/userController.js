const userService = require('../services/user_service');
const otpService = require('../services/otp_service');

class UserController {
    // Send OTP to mobile number
    async sendOTP(req, res) {
        try {
            const { mobile } = req.body;
            
            if (!mobile) {
                return res.status(400).json({
                    success: false,
                    message: 'Mobile number is required'
                });
            }

            // Validate mobile number format (Indian mobile number)
            const mobileRegex = /^[6-9]\d{9}$/;
            if (!mobileRegex.test(mobile)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid 10-digit mobile number'
                });
            }

            const result = await otpService.sendOTP(mobile);
            
            res.status(200).json({
                success: true,
                message: 'OTP sent successfully',
                data: {
                    mobile: mobile,
                    otpSent: true
                }
            });
        } catch (error) {
            console.error('Send OTP Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send OTP',
                error: error.message
            });
        }
    }

    // Verify OTP and login/register user
    async verifyOTP(req, res) {
        try {
            const { mobile, otp } = req.body;
            
            if (!mobile || !otp) {
                return res.status(400).json({
                    success: false,
                    message: 'Mobile number and OTP are required'
                });
            }

            // Verify OTP
            const isOTPValid = await otpService.verifyOTP(mobile, otp);
            
            if (!isOTPValid) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid or expired OTP'
                });
            }

            // Check if user exists or create new user
            let user = await userService.getUserByMobile(mobile);
            let isNewUser = false;
            
            if (!user) {
                user = await userService.createUser({ mobile });
                isNewUser = true;
            }

            // Generate JWT token
            const token = userService.generateToken(user._id,'user');

            res.status(200).json({
                success: true,
                message: isNewUser ? 'User registered successfully' : 'Login successful',
                data: {
                    user: {
                        id: user._id,
                        mobile: user.mobile,
                        name: user.name,
                        email: user.email,
                        isProfileComplete: user.isProfileComplete
                    },
                    token: token,
                    isNewUser: isNewUser
                }
            });
        } catch (error) {
            console.error('Verify OTP Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to verify OTP',
                error: error.message
            });
        }
    }

    // Fill user details after registration
    async fillUserDetails(req, res) {
        try {
            const userId = req.user.id;
            const { name, email, dateOfBirth, gender, emergencyContact } = req.body;

            // Validation
            if (!name) {
                return res.status(400).json({
                    success: false,
                    message: 'Name is required'
                });
            }

            // Validate email format if provided
            if (email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Please enter a valid email address'
                    });
                }
            }

            const updateData = {
                name,
                email,
                dateOfBirth,
                gender,
                emergencyContact,
                isProfileComplete: true
            };

            const updatedUser = await userService.updateUser(userId, updateData);

            res.status(200).json({
                success: true,
                message: 'User details updated successfully',
                data: {
                    user: {
                        id: updatedUser._id,
                        mobile: updatedUser.mobile,
                        name: updatedUser.name,
                        email: updatedUser.email,
                        dateOfBirth: updatedUser.dateOfBirth,
                        gender: updatedUser.gender,
                        emergencyContact: updatedUser.emergencyContact,
                        isProfileComplete: updatedUser.isProfileComplete
                    }
                }
            });
        } catch (error) {
            console.error('Fill User Details Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update user details',
                error: error.message
            });
        }
    }

    // Update user details
    async updateUserDetails(req, res) {
        try {
            const userId = req.user.id;
            const { name, email, dateOfBirth, gender, emergencyContact } = req.body;

            // Validate email format if provided
            if (email) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(email)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Please enter a valid email address'
                    });
                }
            }

            const updateData = {};
            if (name !== undefined) updateData.name = name;
            if (email !== undefined) updateData.email = email;
            if (dateOfBirth !== undefined) updateData.dateOfBirth = dateOfBirth;
            if (gender !== undefined) updateData.gender = gender;
            if (emergencyContact !== undefined) updateData.emergencyContact = emergencyContact;

            const updatedUser = await userService.updateUser(userId, updateData);

            res.status(200).json({
                success: true,
                message: 'User details updated successfully',
                data: {
                    user: {
                        id: updatedUser._id,
                        mobile: updatedUser.mobile,
                        name: updatedUser.name,
                        email: updatedUser.email,
                        dateOfBirth: updatedUser.dateOfBirth,
                        gender: updatedUser.gender,
                        emergencyContact: updatedUser.emergencyContact,
                        isProfileComplete: updatedUser.isProfileComplete
                    }
                }
            });
        } catch (error) {
            console.error('Update User Details Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update user details',
                error: error.message
            });
        }
    }

    // Get user profile
    async getUserProfile(req, res) {
        try {
            const userId = req.user.id;
            const user = await userService.getUserById(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found'
                });
            }

            res.status(200).json({
                success: true,
                message: 'User profile retrieved successfully',
                data: {
                    user: {
                        id: user._id,
                        mobile: user.mobile,
                        name: user.name,
                        email: user.email,
                        dateOfBirth: user.dateOfBirth,
                        gender: user.gender,
                        emergencyContact: user.emergencyContact,
                        isProfileComplete: user.isProfileComplete,
                        createdAt: user.createdAt,
                        updatedAt: user.updatedAt
                    }
                }
            });
        } catch (error) {
            console.error('Get User Profile Error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to retrieve user profile',
                error: error.message
            });
        }
    }
}

module.exports = new UserController();