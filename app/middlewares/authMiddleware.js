const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Driver = require('../models/Driver');
// const Admin = require('../models/Admin');
require('dotenv').config(); // Load .env variables

// Helper function to extract token
const extractToken = (authHeader) => {
    if (!authHeader) return null;
    
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.substring(7);
    }
    return authHeader;
};

// Helper function to verify JWT token
const verifyToken = (token) => {
    return jwt.verify(token, process.env.JWT_SECRET );
};

// User Authentication Middleware
const userAuth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.',
                userType: 'user'
            });
        }

        const token = extractToken(authHeader);
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. Invalid token format.',
                userType: 'user'
            });
        }

        const decoded = verifyToken(token);
        
        // Verify this is a user token
        if (decoded.userType !== 'user') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. User token required.',
                userType: 'user'
            });
        }

        const user = await User.findById(decoded.id);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. User not found.',
                userType: 'user'
            });
        }

        if (!user.isActive) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. User account is inactive.',
                userType: 'user'
            });
        }

        if (user.isBlocked) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. User account is blocked.',
                userType: 'user'
            });
        }

        // Update last login
        user.lastLogin = new Date();
        await user.save();

        req.user = {
            id: user._id,
            mobile: user.mobile,
            name: user.name,
            email: user.email,
            userType: 'user',
            isProfileComplete: user.isProfileComplete
        };

        next();
    } catch (error) {
        console.error('User Auth Middleware Error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Access denied. Invalid user token.',
                userType: 'user'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Access denied. User token expired.',
                userType: 'user'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Internal server error during user authentication.',
            userType: 'user'
        });
    }
};

// Driver Authentication Middleware
const driverAuth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. No token provided.',
                userType: 'driver'
            });
        }

        const token = extractToken(authHeader);
        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. Invalid token format.',
                userType: 'driver'
            });
        }

        const decoded = verifyToken(token);
        
        // // Verify this is a driver token
        // if (decoded.userType !== 'driver') {
        //     return res.status(403).json({
        //         success: false,
        //         message: 'Access denied. Driver token required.',
        //         userType: 'driver'
        //     });
        // }

        const driver = await Driver.findById(decoded.id);
        if (!driver) {
            return res.status(401).json({
                success: false,
                message: 'Access denied. Driver not found.',
                userType: 'driver'
            });
        }

        // if (!driver.isActive) {
        //     return res.status(401).json({
        //         success: false,
        //         message: 'Access denied. Driver account is inactive.',
        //         userType: 'driver'
        //     });
        // }

        // if (driver.isBlocked) {
        //     return res.status(401).json({
        //         success: false,
        //         message: 'Access denied. Driver account is blocked.',
        //         userType: 'driver'
        //     });
        // }

        // // Check driver verification status
        // if (driver.verificationStatus === 'rejected') {
        //     return res.status(403).json({
        //         success: false,
        //         message: 'Access denied. Driver verification rejected.',
        //         userType: 'driver'
        //     });
        // }

        // Update last login
        driver.lastLogin = new Date();
        await driver.save();

        req.driver = driver;
        next();
    } catch (error) {
        console.error('Driver Auth Middleware Error:', error);
        
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Access denied. Invalid driver token.',
                userType: 'driver'
            });
        }
        
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Access denied. Driver token expired.',
                userType: 'driver'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Internal server error during driver authentication.',
            userType: 'driver'
        });
    }
};

// // Admin Authentication Middleware
// const adminAuth = async (req, res, next) => {
//     try {
//         const authHeader = req.header('Authorization');
        
//         if (!authHeader) {
//             return res.status(401).json({
//                 success: false,
//                 message: 'Access denied. Admin token required.',
//                 userType: 'admin'
//             });
//         }

//         const token = extractToken(authHeader);
//         if (!token) {
//             return res.status(401).json({
//                 success: false,
//                 message: 'Access denied. Invalid token format.',
//                 userType: 'admin'
//             });
//         }

//         const decoded = verifyToken(token);
        
//         // Verify this is an admin token
//         if (decoded.userType !== 'admin') {
//             return res.status(403).json({
//                 success: false,
//                 message: 'Access denied. Admin token required.',
//                 userType: 'admin'
//             });
//         }

//         const admin = await Admin.findById(decoded.id);
//         if (!admin) {
//             return res.status(401).json({
//                 success: false,
//                 message: 'Access denied. Admin not found.',
//                 userType: 'admin'
//             });
//         }

//         if (!admin.isActive) {
//             return res.status(401).json({
//                 success: false,
//                 message: 'Access denied. Admin account is inactive.',
//                 userType: 'admin'
//             });
//         }

//         if (admin.isBlocked) {
//             return res.status(401).json({
//                 success: false,
//                 message: 'Access denied. Admin account is blocked.',
//                 userType: 'admin'
//             });
//         }

//         // Check admin permissions
//         if (!admin.permissions || admin.permissions.length === 0) {
//             return res.status(403).json({
//                 success: false,
//                 message: 'Access denied. No admin permissions assigned.',
//                 userType: 'admin'
//             });
//         }

//         // Update last login
//         admin.lastLogin = new Date();
//         await admin.save();

//         req.admin = {
//             id: admin._id,
//             mobile: admin.mobile,
//             name: admin.name,
//             email: admin.email,
//             userType: 'admin',
//             role: admin.role,
//             permissions: admin.permissions,
//             isSuperAdmin: admin.isSuperAdmin
//         };

//         next();
//     } catch (error) {
//         console.error('Admin Auth Middleware Error:', error);
        
//         if (error.name === 'JsonWebTokenError') {
//             return res.status(401).json({
//                 success: false,
//                 message: 'Access denied. Invalid admin token.',
//                 userType: 'admin'
//             });
//         }
        
//         if (error.name === 'TokenExpiredError') {
//             return res.status(401).json({
//                 success: false,
//                 message: 'Access denied. Admin token expired.',
//                 userType: 'admin'
//             });
//         }

//         return res.status(500).json({
//             success: false,
//             message: 'Internal server error during admin authentication.',
//             userType: 'admin'
//         });
//     }
// };

// Optional authentication for any user type
const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.header('Authorization');
        
        if (!authHeader) {
            req.user = null;
            req.driver = null;
            req.admin = null;
            return next();
        }

        const token = extractToken(authHeader);
        if (!token) {
            req.user = null;
            req.driver = null;
            req.admin = null;
            return next();
        }

        const decoded = verifyToken(token);
        
        // Check user type and set appropriate req object
        if (decoded.userType === 'user') {
            const user = await User.findById(decoded.id);
            if (user && user.isActive && !user.isBlocked) {
                req.user = {
                    id: user._id,
                    mobile: user.mobile,
                    name: user.name,
                    email: user.email,
                    userType: 'user',
                    isProfileComplete: user.isProfileComplete
                };
            }
        } else if (decoded.userType === 'driver') {
            const driver = await Driver.findById(decoded.id);
            if (driver && driver.isActive && !driver.isBlocked) {
                req.driver = {
                    id: driver._id,
                    mobile: driver.mobile,
                    name: driver.name,
                    email: driver.email,
                    userType: 'driver',
                    isProfileComplete: driver.isProfileComplete,
                    verificationStatus: driver.verificationStatus
                };
            }
        } else if (decoded.userType === 'admin') {
            const admin = await Admin.findById(decoded.id);
            if (admin && admin.isActive && !admin.isBlocked) {
                req.admin = {
                    id: admin._id,
                    mobile: admin.mobile,
                    name: admin.name,
                    email: admin.email,
                    userType: 'admin',
                    role: admin.role,
                    permissions: admin.permissions
                };
            }
        }

        next();
    } catch (error) {
        req.user = null;
        req.driver = null;
        req.admin = null;
        next();
    }
};

// Middleware to check if profile is complete (works for both user and driver)
const requireCompleteProfile = (req, res, next) => {
    const currentUser = req.user || req.driver;
    
    if (!currentUser) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required.'
        });
    }

    if (!currentUser.isProfileComplete) {
        return res.status(400).json({
            success: false,
            message: 'Please complete your profile first.',
            redirectTo: '/profile/complete',
            userType: currentUser.userType
        });
    }

    next();
};

// Middleware to check driver verification status
const requireVerifiedDriver = (req, res, next) => {
    if (!req.driver) {
        return res.status(401).json({
            success: false,
            message: 'Driver authentication required.'
        });
    }

    if (req.driver.verificationStatus !== 'approved') {
        return res.status(403).json({
            success: false,
            message: `Driver verification ${req.driver.verificationStatus}. Please wait for approval.`,
            verificationStatus: req.driver.verificationStatus
        });
    }

    next();
};

// Super Admin middleware
const superAdminAuth = async (req, res, next) => {
    // First run admin auth
    await new Promise((resolve, reject) => {
        adminAuth(req, res, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });

    if (!req.admin.isSuperAdmin) {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Super admin privileges required.'
        });
    }

    next();
};

// Rate limiting middleware for authentication endpoints
const authRateLimit = (maxAttempts = 10, windowMs = 15 * 60 * 1000) => {
    const attempts = new Map();

    return (req, res, next) => {
        const key = req.ip + (req.body.mobile || '');
        const now = Date.now();
        
        const userAttempts = attempts.get(key) || { count: 0, resetTime: now + windowMs };
        
        if (now > userAttempts.resetTime) {
            userAttempts.count = 0;
            userAttempts.resetTime = now + windowMs;
        }
        
        if (userAttempts.count >= maxAttempts) {
            return res.status(429).json({
                success: false,
                message: `Too many authentication attempts. Please try again after ${Math.ceil(windowMs / 60000)} minutes.`,
                retryAfter: userAttempts.resetTime
            });
        }
        
        userAttempts.count++;
        attempts.set(key, userAttempts);
        
        // Clear old entries periodically
        if (Math.random() < 0.1) {
            for (const [k, v] of attempts.entries()) {
                if (now > v.resetTime) {
                    attempts.delete(k);
                }
            }
        }
        
        next();
    };
};

module.exports = {
    userAuth,
    driverAuth,
    // adminAuth,
    optionalAuth,
    requireCompleteProfile,
    requireVerifiedDriver,
    superAdminAuth,
    authRateLimit
};