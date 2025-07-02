// config/database.js - Database configuration and connection
const sql = require('mssql');

// Database configuration
const dbConfig = {
  user: process.env.DB_USER || '',
  password: process.env.DB_PASSWORD || '',
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'KeypointRecruitment',
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true' || false,
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true' || true,
    enableArithAbort: true,
    connectTimeout: 60000,
    requestTimeout: 60000
  },
  pool: {
    max: 10,
    min: 0,
    idleTimeoutMillis: 30000
  }
};

let poolPromise;

// Connect to database
const connectDB = async () => {
  try {
    if (!poolPromise) {
      poolPromise = new sql.ConnectionPool(dbConfig).connect();
    }
    
    const pool = await poolPromise;
    console.log('Connected to SQL Server database');
    return pool;
  } catch (error) {
    console.error('Database connection failed:', error);
    throw error;
  }
};

// Get database connection
const getDB = async () => {
  try {
    if (!poolPromise) {
      await connectDB();
    }
    return await poolPromise;
  } catch (error) {
    console.error('Failed to get database connection:', error);
    throw error;
  }
};

// Execute query with error handling
const executeQuery = async (query, params = {}) => {
  try {
    const pool = await getDB();
    const request = pool.request();
    
    // Add parameters to request
    Object.keys(params).forEach(key => {
      request.input(key, params[key]);
    });
    
    const result = await request.query(query);
    return result;
  } catch (error) {
    console.error('Query execution failed:', error);
    throw error;
  }
};

// Database helper functions
const dbHelpers = {
  // Get user by email
  getUserByEmail: async (email) => {
    const query = `
      SELECT u.*, 
             c.company_id, c.company_name,
             js.jobseeker_id, js.first_name, js.last_name
      FROM Users u
      LEFT JOIN Companies c ON u.user_id = c.user_id
      LEFT JOIN JobSeekers js ON u.user_id = js.user_id
      WHERE u.email = @email
    `;
    const result = await executeQuery(query, { email });
    return result.recordset[0];
  },

  // Get user by ID
  getUserById: async (userId) => {
    const query = `
      SELECT u.*, 
             c.company_id, c.company_name,
             js.jobseeker_id, js.first_name, js.last_name
      FROM Users u
      LEFT JOIN Companies c ON u.user_id = c.user_id
      LEFT JOIN JobSeekers js ON u.user_id = js.user_id
      WHERE u.user_id = @userId
    `;
    const result = await executeQuery(query, { userId });
    return result.recordset[0];
  },

  // Create new user
  createUser: async (userData) => {
    const query = `
      INSERT INTO Users (email, password_hash, user_type, verification_token)
      OUTPUT INSERTED.user_id, INSERTED.email, INSERTED.user_type, INSERTED.created_at
      VALUES (@email, @passwordHash, @userType, @verificationToken)
    `;
    const result = await executeQuery(query, userData);
    return result.recordset[0];
  },

  // Update user verification status
  verifyUser: async (userId) => {
    const query = `
      UPDATE Users 
      SET is_verified = 1, verification_token = NULL, updated_at = GETDATE()
      WHERE user_id = @userId
    `;
    await executeQuery(query, { userId });
  },

  // Update password reset token
  setResetToken: async (userId, resetToken, expiresAt) => {
    const query = `
      UPDATE Users 
      SET reset_token = @resetToken, reset_token_expires = @expiresAt, updated_at = GETDATE()
      WHERE user_id = @userId
    `;
    await executeQuery(query, { userId, resetToken, expiresAt });
  }
};

module.exports = {
  connectDB,
  getDB,
  executeQuery,
  dbHelpers,
  sql
};