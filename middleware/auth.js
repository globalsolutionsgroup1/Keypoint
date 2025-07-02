// middleware/auth.js - Authentication middleware
const jwt = require('jsonwebtoken');
const { dbHelpers } = require('../config/database');

// Verify JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }
    
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'keypoint_secret_key');
    
    // Get user from database
    const user = await dbHelpers.getUserById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }
    
    if (!user.is_verified) {
      return res.status(401).json({
        success: false,
        message: 'Please verify your email address'
      });
    }
    
    // Add user to request object
    req.user = {
      userId: user.user_id,
      email: user.email,
      userType: user.user_type,
      companyId: user.company_id,
      jobseekerId: user.jobseeker_id
    };
    
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    
    console.error('Authentication error:', error);
    return res.status(500).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

// Check if user is a company
const requireCompany = (req, res, next) => {
  if (req.user.userType !== 'company') {
    return res.status(403).json({
      success: false,
      message: 'Company account required'
    });
  }
  next();
};

// Check if user is a job seeker
const requireJobSeeker = (req, res, next) => {
  if (req.user.userType !== 'jobseeker') {
    return res.status(403).json({
      success: false,
      message: 'Job seeker account required'
    });
  }
  next();
};

// Optional authentication (for public endpoints that can show different content for authenticated users)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];
    
    if (token) {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || 'keypoint_secret_key');
      const user = await dbHelpers.getUserById(decoded.userId);
      
      if (user && user.is_verified) {
        req.user = {
          userId: user.user_id,
          email: user.email,
          userType: user.user_type,
          companyId: user.company_id,
          jobseekerId: user.jobseeker_id
        };
      }
    }
    
    next();
  } catch (error) {
    // Continue without authentication for optional auth
    next();
  }
};

// Generate JWT token
const generateToken = (userId, userType) => {
  return jwt.sign(
    { 
      userId, 
      userType,
      iat: Math.floor(Date.now() / 1000)
    },
    process.env.JWT_SECRET || 'keypoint_secret_key',
    { 
      expiresIn: process.env.JWT_EXPIRES_IN || '7d'
    }
  );
};

// Generate refresh token
const generateRefreshToken = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET || 'keypoint_refresh_secret',
    { expiresIn: '30d' }
  );
};

// Verify refresh token
const verifyRefreshToken = (token) => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET || 'keypoint_refresh_secret');
};

module.exports = {
  authenticateToken,
  requireCompany,
  requireJobSeeker,
  optionalAuth,
  generateToken,
  generateRefreshToken,
  verifyRefreshToken
};