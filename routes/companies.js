// routes/companies.js - Company routes
const express = require('express');
const { body, validationResult, param } = require('express-validator');
const { authenticateToken, requireCompany } = require('../middleware/auth');
const { executeQuery, sql } = require('../config/database');

const router = express.Router();

// All routes require authentication and company role
router.use(authenticateToken);
router.use(requireCompany);

// Get company profile
router.get('/profile', async (req, res) => {
  try {
    const query = `
      SELECT c.*, u.email, u.created_at as user_created_at
      FROM Companies c
      INNER JOIN Users u ON c.user_id = u.user_id
      WHERE c.user_id = @userId
    `;
    
    const result = await executeQuery(query, { userId: req.user.userId });
    
    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Company profile not found'
      });
    }
    
    res.json({
      success: true,
      data: result.recordset[0]
    });
    
  } catch (error) {
    console.error('Get company profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get company profile'
    });
  }
});

// Update company profile
router.put('/profile', [
  body('company_name').notEmpty().trim().withMessage('Company name is required'),
  body('industry').optional().trim(),
  body('company_size').optional().isIn(['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+']).withMessage('Invalid company size'),
  body('website').optional().isURL().withMessage('Invalid website URL'),
  body('phone').optional().trim(),
  body('address').optional().trim(),
  body('city').optional().trim(),
  body('country').optional().trim(),
  body('company_description').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      company_name,
      company_description,
      industry,
      company_size,
      website,
      phone,
      address,
      city,
      country
    } = req.body;

    const query = `
      UPDATE Companies 
      SET company_name = @companyName,
          company_description = @companyDescription,
          industry = @industry,
          company_size = @companySize,
          website = @website,
          phone = @phone,
          address = @address,
          city = @city,
          country = @country,
          updated_at = GETDATE()
      WHERE user_id = @userId
    `;

    await executeQuery(query, {
      userId: req.user.userId,
      companyName: company_name,
      companyDescription: company_description,
      industry,
      companySize: company_size,
      website,
      phone,
      address,
      city,
      country
    });

    res.json({
      success: true,
      message: 'Company profile updated successfully'
    });

  } catch (error) {
    console.error('Update company profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update company profile'
    });
  }
});

// Get company's jobs
router.get('/jobs', async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE j.company_id = @companyId';
    const params = { companyId: req.user.companyId };

    if (status) {
      whereClause += ' AND j.status = @status';
      params.status = status;
    }

    const query = `
      SELECT j.*, 
             COUNT(*) OVER() as total_count,
             (SELECT COUNT(*) FROM Applications WHERE job_id = j.job_id) as application_count
      FROM Jobs j
      ${whereClause}
      ORDER BY j.created_at DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    params.offset = offset;
    params.limit = parseInt(limit);

    const result = await executeQuery(query, params);

    const totalCount = result.recordset.length > 0 ? result.recordset[0].total_count : 0;

    res.json({
      success: true,
      data: {
        jobs: result.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get company jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get company jobs'
    });
  }
});

// Create new job
router.post('/jobs', [
  body('title').notEmpty().trim().withMessage('Job title is required'),
  body('description').notEmpty().trim().withMessage('Job description is required'),
  body('location').notEmpty().trim().withMessage('Location is required'),
  body('job_type').isIn(['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance']).withMessage('Invalid job type'),
  body('experience_level').isIn(['Entry-level', 'Mid-level', 'Senior-level', 'Executive']).withMessage('Invalid experience level'),
  body('salary_min').optional().isNumeric().withMessage('Salary min must be a number'),
  body('salary_max').optional().isNumeric().withMessage('Salary max must be a number'),
  body('application_deadline').optional().isISO8601().withMessage('Invalid deadline date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      title,
      description,
      requirements,
      responsibilities,
      location,
      remote_work_option,
      salary_min,
      salary_max,
      salary_currency,
      job_type,
      experience_level,
      industry,
      department,
      application_deadline,
      max_applications,
      skills
    } = req.body;

    const query = `
      INSERT INTO Jobs (
        company_id, title, description, requirements, responsibilities,
        location, remote_work_option, salary_min, salary_max, salary_currency,
        job_type, experience_level, industry, department, application_deadline, max_applications
      )
      OUTPUT INSERTED.job_id, INSERTED.title, INSERTED.posted_date
      VALUES (
        @companyId, @title, @description, @requirements, @responsibilities,
        @location, @remoteWorkOption, @salaryMin, @salaryMax, @salaryCurrency,
        @jobType, @experienceLevel, @industry, @department, @applicationDeadline, @maxApplications
      )
    `;

    const result = await executeQuery(query, {
      companyId: req.user.companyId,
      title,
      description,
      requirements,
      responsibilities,
      location,
      remoteWorkOption: remote_work_option || 'No',
      salaryMin: salary_min || null,
      salaryMax: salary_max || null,
      salaryCurrency: salary_currency || 'USD',
      jobType: job_type,
      experienceLevel: experience_level,
      industry,
      department,
      applicationDeadline: application_deadline || null,
      maxApplications: max_applications || null
    });

    const newJob = result.recordset[0];

    // Add skills if provided
    if (skills && Array.isArray(skills)) {
      for (const skill of skills) {
        const skillQuery = `
          INSERT INTO JobSkills (job_id, skill_id, required_level, is_required)
          VALUES (@jobId, @skillId, @requiredLevel, @isRequired)
        `;
        await executeQuery(skillQuery, {
          jobId: newJob.job_id,
          skillId: skill.skill_id,
          requiredLevel: skill.required_level || 'Intermediate',
          isRequired: skill.is_required !== false
        });
      }
    }

    res.status(201).json({
      success: true,
      message: 'Job created successfully',
      data: newJob
    });

  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create job'
    });
  }
});

// Update job
router.put('/jobs/:jobId', [
  param('jobId').isInt().withMessage('Invalid job ID'),
  body('title').optional().notEmpty().trim(),
  body('description').optional().notEmpty().trim(),
  body('location').optional().notEmpty().trim(),
  body('job_type').optional().isIn(['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance']),
  body('experience_level').optional().isIn(['Entry-level', 'Mid-level', 'Senior-level', 'Executive']),
  body('status').optional().isIn(['active', 'closed', 'draft', 'paused'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { jobId } = req.params;

    // Check if job belongs to company
    const checkQuery = `
      SELECT job_id FROM Jobs 
      WHERE job_id = @jobId AND company_id = @companyId
    `;
    const checkResult = await executeQuery(checkQuery, {
      jobId,
      companyId: req.user.companyId
    });

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Build dynamic update query
    const updateFields = [];
    const params = { jobId };

    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined) {
        updateFields.push(`${key} = @${key}`);
        params[key] = req.body[key];
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    updateFields.push('updated_at = GETDATE()');

    const updateQuery = `
      UPDATE Jobs 
      SET ${updateFields.join(', ')}
      WHERE job_id = @jobId
    `;

    await executeQuery(updateQuery, params);

    res.json({
      success: true,
      message: 'Job updated successfully'
    });

  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update job'
    });
  }
});

// Delete job
router.delete('/jobs/:jobId', [
  param('jobId').isInt().withMessage('Invalid job ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { jobId } = req.params;

    // Check if job belongs to company
    const checkQuery = `
      SELECT job_id FROM Jobs 
      WHERE job_id = @jobId AND company_id = @companyId
    `;
    const checkResult = await executeQuery(checkQuery, {
      jobId,
      companyId: req.user.companyId
    });

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Delete job (cascade will handle related records)
    const deleteQuery = `DELETE FROM Jobs WHERE job_id = @jobId`;
    await executeQuery(deleteQuery, { jobId });

    res.json({
      success: true,
      message: 'Job deleted successfully'
    });

  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete job'
    });
  }
});

// Get applications for a job
router.get('/jobs/:jobId/applications', [
  param('jobId').isInt().withMessage('Invalid job ID')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { jobId } = req.params;
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // Check if job belongs to company
    const checkQuery = `
      SELECT job_id FROM Jobs 
      WHERE job_id = @jobId AND company_id = @companyId
    `;
    const checkResult = await executeQuery(checkQuery, {
      jobId,
      companyId: req.user.companyId
    });

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    let whereClause = 'WHERE a.job_id = @jobId';
    const params = { jobId };

    if (status) {
      whereClause += ' AND a.status = @status';
      params.status = status;
    }

    const query = `
      SELECT a.*, 
             js.first_name, js.last_name, js.phone, js.email, 
             js.cv_url, js.profile_picture_url, js.summary, js.experience_years,
             u.email as user_email,
             COUNT(*) OVER() as total_count
      FROM Applications a
      INNER JOIN JobSeekers js ON a.jobseeker_id = js.jobseeker_id
      INNER JOIN Users u ON js.user_id = u.user_id
      ${whereClause}
      ORDER BY a.applied_date DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    params.offset = offset;
    params.limit = parseInt(limit);

    const result = await executeQuery(query, params);

    const totalCount = result.recordset.length > 0 ? result.recordset[0].total_count : 0;

    res.json({
      success: true,
      data: {
        applications: result.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get job applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job applications'
    });
  }
});

// Update application status
router.put('/applications/:applicationId', [
  param('applicationId').isInt().withMessage('Invalid application ID'),
  body('status').isIn(['pending', 'reviewed', 'shortlisted', 'interview_scheduled', 'rejected', 'hired']).withMessage('Invalid status'),
  body('notes').optional().trim(),
  body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const { applicationId } = req.params;
    const { status, notes, rating } = req.body;

    // Check if application belongs to company's job
    const checkQuery = `
      SELECT a.application_id 
      FROM Applications a
      INNER JOIN Jobs j ON a.job_id = j.job_id
      WHERE a.application_id = @applicationId AND j.company_id = @companyId
    `;
    const checkResult = await executeQuery(checkQuery, {
      applicationId,
      companyId: req.user.companyId
    });

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Application not found'
      });
    }

    const updateQuery = `
      UPDATE Applications 
      SET status = @status,
          notes = @notes,
          rating = @rating,
          reviewed_date = CASE WHEN @status != 'pending' THEN GETDATE() ELSE reviewed_date END,
          updated_at = GETDATE()
      WHERE application_id = @applicationId
    `;

    await executeQuery(updateQuery, {
      applicationId,
      status,
      notes: notes || null,
      rating: rating || null
    });

    res.json({
      success: true,
      message: 'Application status updated successfully'
    });

  } catch (error) {
    console.error('Update application status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update application status'
    });
  }
});

// Get company dashboard statistics
router.get('/dashboard/stats', async (req, res) => {
  try {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM Jobs WHERE company_id = @companyId) as total_jobs,
        (SELECT COUNT(*) FROM Jobs WHERE company_id = @companyId AND status = 'active') as active_jobs,
        (SELECT COUNT(*) FROM Applications a INNER JOIN Jobs j ON a.job_id = j.job_id WHERE j.company_id = @companyId) as total_applications,
        (SELECT COUNT(*) FROM Applications a INNER JOIN Jobs j ON a.job_id = j.job_id WHERE j.company_id = @companyId AND a.status = 'pending') as pending_applications,
        (SELECT COUNT(*) FROM Applications a INNER JOIN Jobs j ON a.job_id = j.job_id WHERE j.company_id = @companyId AND a.status = 'shortlisted') as shortlisted_applications,
        (SELECT COUNT(*) FROM Applications a INNER JOIN Jobs j ON a.job_id = j.job_id WHERE j.company_id = @companyId AND a.applied_date >= DATEADD(day, -30, GETDATE())) as applications_last_30_days
    `;

    const result = await executeQuery(query, { companyId: req.user.companyId });

    res.json({
      success: true,
      data: result.recordset[0]
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get dashboard statistics'
    });
  }
});

module.exports = router;