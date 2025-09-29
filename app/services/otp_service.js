const axios = require('axios');

// Store OTPs in memory (use Redis in production)
const otpStorage = new Map();
// Generate 4-digit OTP
function generateOTP() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

// Send OTP function
async function sendOTP(mobile) {
    try {
        // Clean phone number - remove all non-digits
        const cleanMobile = mobile.replace(/\D/g, '');
        
        // Generate OTP and set expiry
        const otp = generateOTP();
        const expiryTime = Date.now() + (5 * 60 * 1000); // 5 minutes
        
        // Store OTP (assuming you have some in-memory storage like Map)
        otpStorage.set(cleanMobile, {
            otp: otp,
            expiryTime: expiryTime,
            attempts: 0
        });

        // Development mode - just log OTP
        if (process.env.NODE_ENV === 'development') {
            console.log(`OTP for ${cleanMobile}: ${otp}`);
            return {
                success: true,
                message: 'OTP sent successfully',
                mobile: cleanMobile
            };
        }

        // Production - send via MSG91
        const response = await axios.post('https://control.msg91.com/api/v5/otp', {
            authkey: process.env.MSG91_API_KEY,
            template_id: process.env.MSG91_TEMPLATE_ID,
            mobile: `91${cleanMobile}`,
            extra_param: {
                OTP: otp
            }
        });

        if (response.data.type === 'success') {
            return {
                success: true,
                message: 'OTP sent successfully',
                mobile: cleanMobile
            };
        } else {
            throw new Error('MSG91 API error');
        }

    } catch (error) {
        console.error('Send OTP Error:', error.message);
        throw new Error('Failed to send OTP');
    }
}


// Verify OTP function
async function verifyOTP(mobile, otp) {
    try {
        const cleanMobile = mobile.replace(/\D/g, '');
        const storedData = otpStorage.get(cleanMobile);

        // Check if OTP exists
        if (!storedData) {
            return false;
        }

        // Check if OTP expired
        if (Date.now() > storedData.expiryTime) {
            otpStorage.delete(cleanMobile);
            throw new Error('OTP expired');
        }

        // Check max attempts
        if (storedData.attempts >= 3) {
            otpStorage.delete(cleanMobile);
            throw new Error('Too many attempts');
        }

        // Increment attempts
        storedData.attempts += 1;
        otpStorage.set(cleanMobile, storedData);

        // Verify OTP
        if (storedData.otp === otp) {
            otpStorage.delete(cleanMobile); // Clear after successful verification
            return true;
        } else {
            return false;
        }

    } catch (error) {
        if (error.message === 'OTP expired' || error.message === 'Too many attempts') {
            throw error;
        }
        return false;
    }
}

// Export functions
module.exports = {
    sendOTP,
    verifyOTP
};