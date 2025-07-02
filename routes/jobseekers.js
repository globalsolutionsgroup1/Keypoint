// routes/jobseekers.js - Job Seeker routes
const express = require('express');
const { body, validationResult, param } = require('express-validator');
const { authenticateToken, requireJobSeeker } = require('../middleware/auth');
const { executeQuery, sql } = require('../config/database');

const router = express.Router();

// All routes require authentication and job seeker role
router.use(authenticateToken);
router.use(requireJobSeeker);

// Get job seeker profile
router.get('/profile', async (req, res) => {
  try {
    const query = `
      SELECT js.*, u.email, u.created_at as user_created_at
      FROM JobSeekers js
      INNER JOIN Users u ON js.user_id = u.user_id
      WHERE js.user_id = @userId
    `;
    
    const result = await executeQuery(query, { userId: req.user.userId });
    
    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Job seeker profile not found'
      });
    }
    
    const profile = result.recordset[0];
    
    // Get skills
    const skillsQuery = `
      SELECT s.skill_id, s.skill_name, s.category, jss.proficiency_level
      FROM JobSeekerSkills jss
      INNER JOIN Skills s ON jss.skill_id = s.skill_id
      WHERE jss.jobseeker_id = @jobseekerId
    `;
    const skillsResult = await executeQuery(skillsQuery, { jobseekerId: profile.jobseeker_id });
    
    // Get education
    const educationQuery = `
      SELECT * FROM Education 
      WHERE jobseeker_id = @jobseekerId 
      ORDER BY end_date DESC, start_date DESC
    `;
    const educationResult = await executeQuery(educationQuery, { jobseekerId: profile.jobseeker_id });
    
    // Get work experience
    const experienceQuery = `
      SELECT * FROM WorkExperience 
      WHERE jobseeker_id = @jobseekerId 
      ORDER BY end_date DESC, start_date DESC
    `;
    const experienceResult = await executeQuery(experienceQuery, { jobseekerId: profile.jobseeker_id });
    
    res.json({
      success: true,
      data: {
        ...profile,
        skills: skillsResult.recordset,
        education: educationResult.recordset,
        experience: experienceResult.recordset
      }
    });
    
  } catch (error) {
    console.error('Get job seeker profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job seeker profile'
    });
  }
});

// Update job seeker profile
router.put('/profile', [
  body('first_name').notEmpty().trim().withMessage('First name is required'),
  body('last_name').notEmpty().trim().withMessage('Last name is required'),
  body('phone').optional().trim(),
  body('date_of_birth').optional().isISO8601().withMessage('Invalid date of birth'),
  body('address').optional().trim(),
  body('city').optional().trim(),
  body('country').optional().trim(),
  body('summary').optional().trim(),
  body('experience_years').optional().isInt({ min: 0 }).withMessage('Experience years must be a positive number'),
  body('current_salary').optional().isNumeric().withMessage('Current salary must be a number'),
  body('expected_salary').optional().isNumeric().withMessage('Expected salary must be a number'),
  body('availability').optional().isIn(['immediately', '2_weeks', '1_month', '2_months', '3_months']).withMessage('Invalid availability')
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
      first_name,
      last_name,
      phone,
      date_of_birth,
      address,
      city,
      country,
      summary,
      experience_years,
      current_salary,
      expected_salary,
      availability
    } = req.body;

    const query = `
      UPDATE JobSeekers 
      SET first_name = @firstName,
          last_name = @lastName,
          phone = @phone,
          date_of_birth = @dateOfBirth,
          address = @address,
          city = @city,
          country = @country,
          summary = @summary,
          experience_years = @experienceYears,
          current_salary = @currentSalary,
          expected_salary = @expectedSalary,
          availability = @availability,
          updated_at = GETDATE()
      WHERE user_id = @userId
    `;

    await executeQuery(query, {
      userId: req.user.userId,
      firstName: first_name,
      lastName: last_name,
      phone,
      dateOfBirth: date_of_birth || null,
      address,
      city,
      country,
      summary,
      experienceYears: experience_years || 0,
      currentSalary: current_salary || null,
      expectedSalary: expected_salary || null,
      availability: availability || 'immediately'
    });

    res.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Update job seeker profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// Add/Update skills
router.post('/skills', [
  body('skills').isArray().withMessage('Skills must be an array'),
  body('skills.*.skill_id').isInt().withMessage('Invalid skill ID'),
  body('skills.*.proficiency_level').isIn(['Beginner', 'Intermediate', 'Advanced', 'Expert']).withMessage('Invalid proficiency level')
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

    const { skills } = req.body;

    // First, remove existing skills
    const deleteQuery = `DELETE FROM JobSeekerSkills WHERE jobseeker_id = @jobseekerId`;
    await executeQuery(deleteQuery, { jobseekerId: req.user.jobseekerId });

    // Add new skills
    for (const skill of skills) {
      const insertQuery = `
        INSERT INTO JobSeekerSkills (jobseeker_id, skill_id, proficiency_level)
        VALUES (@jobseekerId, @skillId, @proficiencyLevel)
      `;
      await executeQuery(insertQuery, {
        jobseekerId: req.user.jobseekerId,
        skillId: skill.skill_id,
        proficiencyLevel: skill.proficiency_level
      });
    }

    res.json({
      success: true,
      message: 'Skills updated successfully'
    });

  } catch (error) {
    console.error('Update skills error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update skills'
    });
  }
});

// Add education
router.post('/education', [
  body('institution_name').notEmpty().trim().withMessage('Institution name is required'),
  body('degree').optional().trim(),
  body('field_of_study').optional().trim(),
  body('start_date').optional().isISO8601().withMessage('Invalid start date'),
  body('end_date').optional().isISO8601().withMessage('Invalid end date'),
  body('is_current').optional().isBoolean(),
  body('grade_gpa').optional().trim(),
  body('description').optional().trim()
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
      institution_name,
      degree,
      field_of_study,
      start_date,
      end_date,
      is_current,
      grade_gpa,
      description
    } = req.body;

    const query = `
      INSERT INTO Education (
        jobseeker_id, institution_name, degree, field_of_study,
        start_date, end_date, is_current, grade_gpa, description
      )
      OUTPUT INSERTED.education_id
      VALUES (
        @jobseekerId, @institutionName, @degree, @fieldOfStudy,
        @startDate, @endDate, @isCurrent, @gradeGpa, @description
      )
    `;

    const result = await executeQuery(query, {
      jobseekerId: req.user.jobseekerId,
      institutionName: institution_name,
      degree,
      fieldOfStudy: field_of_study,
      startDate: start_date || null,
      endDate: end_date || null,
      isCurrent: is_current || false,
      gradeGpa: grade_gpa,
      description
    });

    res.status(201).json({
      success: true,
      message: 'Education added successfully',
      data: { education_id: result.recordset[0].education_id }
    });

  } catch (error) {
    console.error('Add education error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add education'
    });
  }
});

// Update education
router.put('/education/:educationId', [
  param('educationId').isInt().withMessage('Invalid education ID'),
  body('institution_name').optional().notEmpty().trim(),
  body('degree').optional().trim(),
  body('field_of_study').optional().trim(),
  body('start_date').optional().isISO8601().withMessage('Invalid start date'),
  body('end_date').optional().isISO8601().withMessage('Invalid end date'),
  body('is_current').optional().isBoolean(),
  body('grade_gpa').optional().trim(),
  body('description').optional().trim()
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

    const { educationId } = req.params;

    // Check if education belongs to job seeker
    const checkQuery = `
      SELECT education_id FROM Education 
      WHERE education_id = @educationId AND jobseeker_id = @jobseekerId
    `;
    const checkResult = await executeQuery(checkQuery, {
      educationId,
      jobseekerId: req.user.jobseekerId
    });

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Education record not found'
      });
    }

    // Build dynamic update query
    const updateFields = [];
    const params = { educationId };

    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined) {
        const dbKey = key === 'institution_name' ? 'institutionName' : 
                     key === 'field_of_study' ? 'fieldOfStudy' :
                     key === 'start_date' ? 'startDate' :
                     key === 'end_date' ? 'endDate' :
                     key === 'is_current' ? 'isCurrent' :
                     key === 'grade_gpa' ? 'gradeGpa' : key;
        updateFields.push(`${key} = @${dbKey}`);
        params[dbKey] = req.body[key];
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    const updateQuery = `
      UPDATE Education 
      SET ${updateFields.join(', ')}
      WHERE education_id = @educationId
    `;

    await executeQuery(updateQuery, params);

    res.json({
      success: true,
      message: 'Education updated successfully'
    });

  } catch (error) {
    console.error('Update education error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update education'
    });
  }
});

// Delete education
router.delete('/education/:educationId', [
  param('educationId').isInt().withMessage('Invalid education ID')
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

    const { educationId } = req.params;

    // Check if education belongs to job seeker
    const checkQuery = `
      SELECT education_id FROM Education 
      WHERE education_id = @educationId AND jobseeker_id = @jobseekerId
    `;
    const checkResult = await executeQuery(checkQuery, {
      educationId,
      jobseekerId: req.user.jobseekerId
    });

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Education record not found'
      });
    }

    const deleteQuery = `DELETE FROM Education WHERE education_id = @educationId`;
    await executeQuery(deleteQuery, { educationId });

    res.json({
      success: true,
      message: 'Education deleted successfully'
    });

  } catch (error) {
    console.error('Delete education error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete education'
    });
  }
});

// Add work experience
router.post('/experience', [
  body('company_name').notEmpty().trim().withMessage('Company name is required'),
  body('job_title').notEmpty().trim().withMessage('Job title is required'),
  body('start_date').isISO8601().withMessage('Valid start date is required'),
  body('end_date').optional().isISO8601().withMessage('Invalid end date'),
  body('is_current').optional().isBoolean(),
  body('description').optional().trim(),
  body('location').optional().trim()
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
      job_title,
      start_date,
      end_date,
      is_current,
      description,
      location
    } = req.body;

    const query = `
      INSERT INTO WorkExperience (
        jobseeker_id, company_name, job_title, start_date, 
        end_date, is_current, description, location
      )
      OUTPUT INSERTED.experience_id
      VALUES (
        @jobseekerId, @companyName, @jobTitle, @startDate,
        @endDate, @isCurrent, @description, @location
      )
    `;

    const result = await executeQuery(query, {
      jobseekerId: req.user.jobseekerId,
      companyName: company_name,
      jobTitle: job_title,
      startDate: start_date,
      endDate: end_date || null,
      isCurrent: is_current || false,
      description,
      location
    });

    res.status(201).json({
      success: true,
      message: 'Work experience added successfully',
      data: { experience_id: result.recordset[0].experience_id }
    });

  } catch (error) {
    console.error('Add work experience error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add work experience'
    });
  }
});

// Update work experience
router.put('/experience/:experienceId', [
  param('experienceId').isInt().withMessage('Invalid experience ID'),
  body('company_name').optional().notEmpty().trim(),
  body('job_title').optional().notEmpty().trim(),
  body('start_date').optional().isISO8601().withMessage('Invalid start date'),
  body('end_date').optional().isISO8601().withMessage('Invalid end date'),
  body('is_current').optional().isBoolean(),
  body('description').optional().trim(),
  body('location').optional().trim()
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

    const { experienceId } = req.params;

    // Check if experience belongs to job seeker
    const checkQuery = `
      SELECT experience_id FROM WorkExperience 
      WHERE experience_id = @experienceId AND jobseeker_id = @jobseekerId
    `;
    const checkResult = await executeQuery(checkQuery, {
      experienceId,
      jobseekerId: req.user.jobseekerId
    });

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work experience not found'
      });
    }

    // Build dynamic update query
    const updateFields = [];
    const params = { experienceId };

    Object.keys(req.body).forEach(key => {
      if (req.body[key] !== undefined) {
        const dbKey = key === 'company_name' ? 'companyName' : 
                     key === 'job_title' ? 'jobTitle' :
                     key === 'start_date' ? 'startDate' :
                     key === 'end_date' ? 'endDate' :
                     key === 'is_current' ? 'isCurrent' : key;
        updateFields.push(`${key} = @${dbKey}`);
        params[dbKey] = req.body[key];
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No fields to update'
      });
    }

    const updateQuery = `
      UPDATE WorkExperience 
      SET ${updateFields.join(', ')}
      WHERE experience_id = @experienceId
    `;

    await executeQuery(updateQuery, params);

    res.json({
      success: true,
      message: 'Work experience updated successfully'
    });

  } catch (error) {
    console.error('Update work experience error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update work experience'
    });
  }
});

// Delete work experience
router.delete('/experience/:experienceId', [
  param('experienceId').isInt().withMessage('Invalid experience ID')
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

    const { experienceId } = req.params;

    // Check if experience belongs to job seeker
    const checkQuery = `
      SELECT experience_id FROM WorkExperience 
      WHERE experience_id = @experienceId AND jobseeker_id = @jobseekerId
    `;
    const checkResult = await executeQuery(checkQuery, {
      experienceId,
      jobseekerId: req.user.jobseekerId
    });

    if (checkResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Work experience not found'
      });
    }

    const deleteQuery = `DELETE FROM WorkExperience WHERE experience_id = @experienceId`;
    await executeQuery(deleteQuery, { experienceId });

    res.json({
      success: true,
      message: 'Work experience deleted successfully'
    });

  } catch (error) {
    console.error('Delete work experience error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete work experience'
    });
  }
});

// Get job seeker's applications
router.get('/applications', async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE a.jobseeker_id = @jobseekerId';
    const params = { jobseekerId: req.user.jobseekerId };

    if (status) {
      whereClause += ' AND a.status = @status';
      params.status = status;
    }

    const query = `
      SELECT a.*, j.title as job_title, j.location, j.job_type, j.salary_min, j.salary_max,
             c.company_name, c.logo_url,
             COUNT(*) OVER() as total_count
      FROM Applications a
      INNER JOIN Jobs j ON a.job_id = j.job_id
      INNER JOIN Companies c ON j.company_id = c.company_id
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
    console.error('Get applications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get applications'
    });
  }
});

// Apply for a job
router.post('/apply/:jobId', [
  param('jobId').isInt().withMessage('Invalid job ID'),
  body('cover_letter').optional().trim()
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
    const { cover_letter } = req.body;

    // Check if job exists and is active
    const jobQuery = `
      SELECT job_id, title, max_applications, current_applications, application_deadline
      FROM Jobs 
      WHERE job_id = @jobId AND status = 'active'
    `;
    const jobResult = await executeQuery(jobQuery, { jobId });

    if (jobResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Job not found or not active'
      });
    }

    const job = jobResult.recordset[0];

    // Check application deadline
    if (job.application_deadline && new Date(job.application_deadline) < new Date()) {
      return res.status(400).json({
        success: false,
        message: 'Application deadline has passed'
      });
    }

    // Check max applications limit
    if (job.max_applications && job.current_applications >= job.max_applications) {
      return res.status(400).json({
        success: false,
        message: 'Maximum number of applications reached for this job'
      });
    }

    // Check if already applied
    const existingQuery = `
      SELECT application_id FROM Applications 
      WHERE job_id = @jobId AND jobseeker_id = @jobseekerId
    `;
    const existingResult = await executeQuery(existingQuery, {
      jobId,
      jobseekerId: req.user.jobseekerId
    });

    if (existingResult.recordset.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'You have already applied for this job'
      });
    }

    // Create application
    const applicationQuery = `
      INSERT INTO Applications (job_id, jobseeker_id, cover_letter)
      OUTPUT INSERTED.application_id, INSERTED.applied_date
      VALUES (@jobId, @jobseekerId, @coverLetter)
    `;

    const applicationResult = await executeQuery(applicationQuery, {
      jobId,
      jobseekerId: req.user.jobseekerId,
      coverLetter: cover_letter
    });

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully',
      data: applicationResult.recordset[0]
    });

  } catch (error) {
    console.error('Apply for job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit application'
    });
  }
});

// Save/unsave a job
router.post('/save-job/:jobId', [
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

    // Check if job exists
    const jobQuery = `SELECT job_id FROM Jobs WHERE job_id = @jobId`;
    const jobResult = await executeQuery(jobQuery, { jobId });

    if (jobResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    // Check if already saved
    const existingQuery = `
      SELECT jobseeker_id FROM SavedJobs 
      WHERE job_id = @jobId AND jobseeker_id = @jobseekerId
    `;
    const existingResult = await executeQuery(existingQuery, {
      jobId,
      jobseekerId: req.user.jobseekerId
    });

    if (existingResult.recordset.length > 0) {
      // Unsave job
      const deleteQuery = `
        DELETE FROM SavedJobs 
        WHERE job_id = @jobId AND jobseeker_id = @jobseekerId
      `;
      await executeQuery(deleteQuery, {
        jobId,
        jobseekerId: req.user.jobseekerId
      });

      res.json({
        success: true,
        message: 'Job removed from saved jobs',
        saved: false
      });
    } else {
      // Save job
      const insertQuery = `
        INSERT INTO SavedJobs (job_id, jobseeker_id)
        VALUES (@jobId, @jobseekerId)
      `;
      await executeQuery(insertQuery, {
        jobId,
        jobseekerId: req.user.jobseekerId
      });

      res.json({
        success: true,
        message: 'Job saved successfully',
        saved: true
      });
    }

  } catch (error) {
    console.error('Save/unsave job error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save/unsave job'
    });
  }
});

// Get saved jobs
router.get('/saved-jobs', async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    const query = `
      SELECT j.*, c.company_name, c.logo_url, sj.saved_date,
             COUNT(*) OVER() as total_count
      FROM SavedJobs sj
      INNER JOIN Jobs j ON sj.job_id = j.job_id
      INNER JOIN Companies c ON j.company_id = c.company_id
      WHERE sj.jobseeker_id = @jobseekerId
      ORDER BY sj.saved_date DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    const result = await executeQuery(query, {
      jobseekerId: req.user.jobseekerId,
      offset,
      limit: parseInt(limit)
    });

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
    console.error('Get saved jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get saved jobs'
    });
  }
});

// Get job seeker dashboard statistics
router.get('/dashboard/stats', async (req, res) => {
  try {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM Applications WHERE jobseeker_id = @jobseekerId) as total_applications,
        (SELECT COUNT(*) FROM Applications WHERE jobseeker_id = @jobseekerId AND status = 'pending') as pending_applications,
        (SELECT COUNT(*) FROM Applications WHERE jobseeker_id = @jobseekerId AND status IN ('shortlisted', 'interview_scheduled')) as shortlisted_applications,
        (SELECT COUNT(*) FROM SavedJobs WHERE jobseeker_id = @jobseekerId) as saved_jobs,
        (SELECT COUNT(*) FROM Applications WHERE jobseeker_id = @jobseekerId AND applied_date >= DATEADD(day, -30, GETDATE())) as applications_last_30_days
    `;

    const result = await executeQuery(query, { jobseekerId: req.user.jobseekerId });

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