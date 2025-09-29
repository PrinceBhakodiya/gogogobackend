const Driver = require('../models/Driver');
const jwt = require('jsonwebtoken');
const { sendOTP, verifyOTP } = require('../services/otp_service');

class DriverController {
  // ==================== AUTHENTICATION METHODS ====================

  async sendOTP(req, res) {
    try {
      const { phone } = req.body;
      if (!phone) {
        return res.status(400).json({ success: false, message: 'Phone number is required' });
      }

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

      const result = await sendOTP(cleanPhone);
      if (!result.success) throw new Error('Failed to send OTP');

      res.json({
        success: true,
        message: 'OTP sent successfully',
        data: { phone: cleanPhone, expiresIn: '5 minutes' },
      });
    } catch (error) {
      console.error('Send OTP error:', error);
      res.status(500).json({ success: false, message: error.message || 'Failed to send OTP' });
    }
  }

  async verifyOtp(req, res) {
    try {
      const { phone, otp } = req.body;
      if (!phone || !otp) {
        return res.status(400).json({ success: false, message: 'Phone number and OTP are required' });
      }

      const cleanPhone = phone.replace(/\D/g, '');
      const isValidOTP = await verifyOTP(cleanPhone, otp);

      if (!isValidOTP) {
        return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
      }

      let driver = await Driver.findOne({ phone: cleanPhone });
      let isNew = false;

      if (!driver) {
        driver = new Driver({ phone: cleanPhone });
        isNew = true;
      }

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
            isNew,
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
        await redisClient.hset(`driver:${driverId}:location`, {
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
      if (redisClient) {
        await redisClient.hset(`driver:${driverId}:status`, 'available', isAvailable.toString());
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
}

module.exports = new DriverController();
