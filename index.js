const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const path = require('path');
const redisClient = require('./app/utils/redis.js');
require('dotenv').config(); // Load .env variables
const app = express();
const PORT = process.env.PORT || 3000;

// Create HTTP server for Socket.IO
const server = http.createServer(app);

// Middleware
app.use(cors({
  origin: "*", // Configure properly for production
  methods: ["GET", "POST", "PUT", "DELETE"],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files for uploaded images
app.use('/uploads', express.static('uploads'));

// Create uploads directory if it doesn't exist
const fs = require('fs');
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ride_hailing_db')
  .then(() => {
    console.log('Connected to MongoDB');
  })
  .catch((error) => {
    console.error('Database connection error:', error);
  });

const initializeSocketHandler = require('./app/services/socket_service.js');
const socketHandler = initializeSocketHandler(server);
app.set('socketHandler', socketHandler);
app.set('redisClient', redisClient);

// Import routes
const userRoutes = require('./app/routes/userRoutes');

// attach socket handler
userRoutes.setSocketHandler(socketHandler);

// use router
app.use('/api/user', userRoutes);
const driverRouter = require('./app/routes/driverRoutes');
const rideRoutes = require('./app/routes/rideRoutes');

// Routes
app.get('/', (req, res) => {
  res.json({
    message: 'Ride Hailing Platform API',
    version: '1.0.0',
    status: 'running',
    services: {
      database: 'MongoDB Connected',
      cache: 'Redis Connected', 
      realtime: 'Socket.IO Active'
    },
    endpoints: {
      driver: '/api/driver',
      user: '/api/user',
      ride: '/api/ride'
    }
  });
});

// API Routes
app.use('/api/user', userRoutes);
app.use('/api/driver', driverRouter);
app.use('/api/ride', rideRoutes);

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Check MongoDB
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
    
    // Check Redis
    let redisStatus = 'disconnected';
    try {
      await redisClient.ping();
      redisStatus = 'connected';
    } catch (error) {
      redisStatus = 'error';
    }

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        mongodb: dbStatus,
        redis: redisStatus,
        socketio: 'active'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error.message
    });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: 'Something went wrong!',
    error: process.env.NODE_ENV === 'development' ? err.message : {}
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully');
  
  server.close(() => {
    console.log('HTTP server closed');
    
    // Close database connection
    mongoose.connection.close(false, () => {
      console.log('MongoDB connection closed');
      
      // Close Redis connection
      redisClient.quit(() => {
        console.log('Redis connection closed');
        process.exit(0);
      });
    });
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚗 Ride Hailing Server is running on port ${PORT}`);
  console.log(`📱 Driver API: http://localhost:${PORT}/api/driver`);
  console.log(`👥 User API: http://localhost:${PORT}/api/user`);
  console.log(`🚕 Ride API: http://localhost:${PORT}/api/ride`);
  console.log(`🔄 Socket.IO: ws://localhost:${PORT}`);
  console.log(`📊 Health Check: http://localhost:${PORT}/health`);
});

module.exports = { app, server, socketHandler, redisClient };
