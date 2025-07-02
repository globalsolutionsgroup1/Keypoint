// routes/upload.js - File upload routes
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Ensure upload directories exist
const uploadDir = process.env.UPLOAD_PATH || './uploads';
const cvDir = path.join(uploadDir, 'cv');
const logoDir = path.join(uploadDir, 'logos');
const profileDir = path.join(uploadDir, 'profiles');

[uploadDir, cvDir, logoDir, profileDir].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// File filter function
const createFileFilter = (allowedTypes) => {
  return (req, file, cb) => {
    const allowedExtensions = allowedTypes.split(',');
    const fileExtension = path.extname(file.originalname).toLowerCase().substring(1);
    
    if (allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error(`Invalid file type. Allowed types: ${allowedTypes}`), false);
    }
  };
};

// CV upload configuration
const cvStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, cvDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `cv-${req.user.userId}-${uniqueSuffix}${extension}`);
  }
});

const cvUpload = multer({
  storage: cvStorage,
  limits: {
    fileSize: parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024 // 10MB
  },
  fileFilter: createFileFilter(process.env.ALLOWED_CV_TYPES || 'pdf,doc,docx')
});

// Logo upload configuration
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, logoDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `logo-${req.user.userId}-${uniqueSuffix}${extension}`);
  }
});

const logoUpload = multer({
  storage: logoStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB for images
  },
  fileFilter: createFileFilter(process.env.ALLOWED_IMAGE_TYPES || 'jpg,jpeg,png,gif')
});

// Profile picture upload configuration
const profileStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, profileDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const extension = path.extname(file.originalname);
    cb(null, `profile-${req.user.userId}-${uniqueSuffix}${extension}`);
  }
});

const profileUpload = multer({
  storage: profileStorage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB for images
  },
  fileFilter: createFileFilter(process.env.ALLOWED_IMAGE_TYPES || 'jpg,jpeg,png,gif')
});

// Upload CV
router.post('/cv', authenticateToken, cvUpload.single('cv'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No CV file provided'
      });
    }

    const { executeQuery } = require('../config/database');
    
    // Update job seeker profile with CV URL
    const cvUrl = `/uploads/cv/${req.file.filename}`;
    const query = `
      UPDATE JobSeekers 
      SET cv_url = @cvUrl, updated_at = GETDATE()
      WHERE user_id = @userId
    `;
    
    await executeQuery(query, {
      cvUrl,
      userId: req.user.userId
    });

    res.json({
      success: true,
      message: 'CV uploaded successfully',
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        url: cvUrl
      }
    });

  } catch (error) {
    console.error('CV upload error:', error);
    
    // Clean up uploaded file if database update fails
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload CV'
    });
  }
});

// Upload company logo
router.post('/logo', authenticateToken, logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No logo file provided'
      });
    }

    const { executeQuery } = require('../config/database');
    
    // Update company profile with logo URL
    const logoUrl = `/uploads/logos/${req.file.filename}`;
    const query = `
      UPDATE Companies 
      SET logo_url = @logoUrl, updated_at = GETDATE()
      WHERE user_id = @userId
    `;
    
    await executeQuery(query, {
      logoUrl,
      userId: req.user.userId
    });

    res.json({
      success: true,
      message: 'Logo uploaded successfully',
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        url: logoUrl
      }
    });

  } catch (error) {
    console.error('Logo upload error:', error);
    
    // Clean up uploaded file if database update fails
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload logo'
    });
  }
});

// Upload profile picture
router.post('/profile-picture', authenticateToken, profileUpload.single('profilePicture'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No profile picture provided'
      });
    }

    const { executeQuery } = require('../config/database');
    
    // Update job seeker profile with profile picture URL
    const profilePictureUrl = `/uploads/profiles/${req.file.filename}`;
    const query = `
      UPDATE JobSeekers 
      SET profile_picture_url = @profilePictureUrl, updated_at = GETDATE()
      WHERE user_id = @userId
    `;
    
    await executeQuery(query, {
      profilePictureUrl,
      userId: req.user.userId
    });

    res.json({
      success: true,
      message: 'Profile picture uploaded successfully',
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size,
        url: profilePictureUrl
      }
    });

  } catch (error) {
    console.error('Profile picture upload error:', error);
    
    // Clean up uploaded file if database update fails
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to upload profile picture'
    });
  }
});

// Delete file
router.delete('/:type/:filename', authenticateToken, async (req, res) => {
  try {
    const { type, filename } = req.params;
    
    // Validate file type
    const allowedTypes = ['cv', 'logos', 'profiles'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type'
      });
    }
    
    // Check if file belongs to the user
    if (!filename.includes(`-${req.user.userId}-`)) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized to delete this file'
      });
    }
    
    const filePath = path.join(uploadDir, type, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    // Delete file from filesystem
    fs.unlinkSync(filePath);
    
    // Update database to remove file reference
    const { executeQuery } = require('../config/database');
    let query, column, table;
    
    if (type === 'cv') {
      table = 'JobSeekers';
      column = 'cv_url';
    } else if (type === 'logos') {
      table = 'Companies';
      column = 'logo_url';
    } else if (type === 'profiles') {
      table = 'JobSeekers';
      column = 'profile_picture_url';
    }
    
    query = `
      UPDATE ${table} 
      SET ${column} = NULL, updated_at = GETDATE()
      WHERE user_id = @userId
    `;
    
    await executeQuery(query, { userId: req.user.userId });
    
    res.json({
      success: true,
      message: 'File deleted successfully'
    });
    
  } catch (error) {
    console.error('File deletion error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file'
    });
  }
});

// Get file info
router.get('/info/:type/:filename', authenticateToken, (req, res) => {
  try {
    const { type, filename } = req.params;
    
    // Validate file type
    const allowedTypes = ['cv', 'logos', 'profiles'];
    if (!allowedTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file type'
      });
    }
    
    const filePath = path.join(uploadDir, type, filename);
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    const stats = fs.statSync(filePath);
    
    res.json({
      success: true,
      data: {
        filename,
        size: stats.size,
        uploadDate: stats.birthtime,
        url: `/uploads/${type}/${filename}`
      }
    });
    
  } catch (error) {
    console.error('Get file info error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get file info'
    });
  }
});

// Error handling middleware for multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: 'File too large'
      });
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected file field'
      });
    }
  }
  
  res.status(400).json({
    success: false,
    message: error.message || 'File upload failed'
  });
});

module.exports = router;