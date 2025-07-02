// routes/jobs.js - Job management routes (public and authenticated)
const express = require('express');
const { body, validationResult, param, query } = require('express-validator');
const { optionalAuth, authenticateToken } = require('../middleware/auth');
const { executeQuery, dbHelpers, sql } = require('../config/database');

const router = express.Router();

// Get all jobs (public endpoint with optional authentication)
router.get('/', optionalAuth, [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('search').optional().trim(),
  query('location').optional().trim(),
  query('job_type').optional().isIn(['Full-time', 'Part-time', 'Contract', 'Internship', 'Freelance']),
  query('experience_level').optional().isIn(['Entry-level', 'Mid-level', 'Senior-level', 'Executive']),
  query('remote_work_option').optional().isIn(['Yes', 'No', 'Hybrid']),
  query('salary_min').optional().isNumeric(),
  query('salary_max').optional().isNumeric(),
  query('industry').optional().trim(),
  query('sort_by').optional().isIn(['posted_date', 'salary_min', 'title', 'company_name']),
  query('sort_order').optional().isIn(['asc', 'desc'])
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
      page = 1,
      limit = 20,
      search,
      location,
      job_type,
      experience_level,
      remote_work_option,
      salary_min,
      salary_max,
      industry,
      sort_by = 'posted_date',
      sort_order = 'desc'
    } = req.query;

    const offset = (page - 1) * limit;

    // Build dynamic WHERE clause
    let whereClause = 'WHERE j.status = \'active\'';
    const params = {};

    if (search) {
      whereClause += ' AND (j.title LIKE @search OR j.description LIKE @search OR c.company_name LIKE @search)';
      params.search = `%${search}%`;
    }

    if (location) {
      whereClause += ' AND j.location LIKE @location';
      params.location = `%${location}%`;
    }

    if (job_type) {
      whereClause += ' AND j.job_type = @jobType';
      params.jobType = job_type;
    }

    if (experience_level) {
      whereClause += ' AND j.experience_level = @experienceLevel';
      params.experienceLevel = experience_level;
    }

    if (remote_work_option) {
      whereClause += ' AND j.remote_work_option = @remoteWorkOption';
      params.remoteWorkOption = remote_work_option;
    }

    if (salary_min) {
      whereClause += ' AND (j.salary_min >= @salaryMin OR j.salary_min IS NULL)';
      params.salaryMin = parseFloat(salary_min);
    }

    if (salary_max) {
      whereClause += ' AND (j.salary_max <= @salaryMax OR j.salary_max IS NULL)';
      params.salaryMax = parseFloat(salary_max);
    }

    if (industry) {
      whereClause += ' AND j.industry LIKE @industry';
      params.industry = `%${industry}%`;
    }

    // Check if application deadline has not passed
    whereClause += ' AND (j.application_deadline IS NULL OR j.application_deadline >= CAST(GETDATE() AS DATE))';

    // Build ORDER BY clause
    let orderBy = 'ORDER BY ';
    switch (sort_by) {
      case 'salary_min':
        orderBy += 'j.salary_min';
        break;
      case 'title':
        orderBy += 'j.title';
        break;
      case 'company_name':
        orderBy += 'c.company_name';
        break;
      default:
        orderBy += 'j.posted_date';
    }
    orderBy += ` ${sort_order.toUpperCase()}`;

    // Main query
    let selectClause = `
      SELECT j.job_id, j.title, j.description, j.location, j.remote_work_option,
             j.salary_min, j.salary_max, j.salary_currency, j.job_type, j.experience_level,
             j.industry, j.department, j.posted_date, j.application_deadline,
             j.max_applications, j.current_applications, j.views_count,
             c.company_name, c.logo_url, c.company_size, c.industry as company_industry,
             COUNT(*) OVER() as total_count
    `;

    // Add user-specific fields if authenticated
    if (req.user && req.user.userType === 'jobseeker') {
      selectClause += `,
        (SELECT COUNT(*) FROM Applications WHERE job_id = j.job_id AND jobseeker_id = @jobseekerId) as has_applied,
        (SELECT COUNT(*) FROM SavedJobs WHERE job_id = j.job_id AND jobseeker_id = @jobseekerId) as is_saved
      `;
      params.jobseekerId = req.user.jobseekerId;
    }

    const query = `
      ${selectClause}
      FROM Jobs j
      INNER JOIN Companies c ON j.company_id = c.company_id
      ${whereClause}
      ${orderBy}
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    params.offset = offset;
    params.limit = parseInt(limit);

    const result = await executeQuery(query, params);

    // Update view counts for the jobs (fire and forget)
    if (result.recordset.length > 0) {
      const jobIds = result.recordset.map(job => job.job_id).join(',');
      const updateViewsQuery = `
        UPDATE Jobs 
        SET views_count = views_count + 1 
        WHERE job_id IN (${jobIds})
      `;
      executeQuery(updateViewsQuery).catch(err => 
        console.error('Failed to update view counts:', err)
      );
    }

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
        },
        filters: {
          search,
          location,
          job_type,
          experience_level,
          remote_work_option,
          salary_min,
          salary_max,
          industry,
          sort_by,
          sort_order
        }
      }
    });

  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get jobs'
    });
  }
});

// Get single job details
router.get('/:jobId', optionalAuth, [
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

    let selectClause = `
      SELECT j.*, 
             c.company_name, c.company_description, c.industry as company_industry,
             c.company_size, c.website, c.logo_url, c.city as company_city, c.country as company_country
    `;

    // Add user-specific fields if authenticated
    let joinClause = '';
    const params = { jobId };

    if (req.user && req.user.userType === 'jobseeker') {
      selectClause += `,
        (SELECT COUNT(*) FROM Applications WHERE job_id = j.job_id AND jobseeker_id = @jobseekerId) as has_applied,
        (SELECT COUNT(*) FROM SavedJobs WHERE job_id = j.job_id AND jobseeker_id = @jobseekerId) as is_saved
      `;
      params.jobseekerId = req.user.jobseekerId;
    }

    const query = `
      ${selectClause}
      FROM Jobs j
      INNER JOIN Companies c ON j.company_id = c.company_id
      ${joinClause}
      WHERE j.job_id = @jobId AND j.status = 'active'
    `;

    const result = await executeQuery(query, params);

    if (result.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Job not found'
      });
    }

    const job = result.recordset[0];

    // Get required skills for the job
    const skillsQuery = `
      SELECT s.skill_id, s.skill_name, s.category, js.required_level, js.is_required
      FROM JobSkills js
      INNER JOIN Skills s ON js.skill_id = s.skill_id
      WHERE js.job_id = @jobId
      ORDER BY js.is_required DESC, s.skill_name
    `;
    const skillsResult = await executeQuery(skillsQuery, { jobId });

    // Get similar jobs
    const similarJobsQuery = `
      SELECT TOP 5 j.job_id, j.title, j.location, j.job_type, j.salary_min, j.salary_max,
             c.company_name, c.logo_url
      FROM Jobs j
      INNER JOIN Companies c ON j.company_id = c.company_id
      WHERE j.job_id != @jobId 
        AND j.status = 'active'
        AND (j.industry = @industry OR j.job_type = @jobType OR j.experience_level = @experienceLevel)
      ORDER BY j.posted_date DESC
    `;
    const similarJobsResult = await executeQuery(similarJobsQuery, {
      jobId,
      industry: job.industry,
      jobType: job.job_type,
      experienceLevel: job.experience_level
    });

    // Update view count (fire and forget)
    executeQuery('UPDATE Jobs SET views_count = views_count + 1 WHERE job_id = @jobId', { jobId })
      .catch(err => console.error('Failed to update view count:', err));

    res.json({
      success: true,
      data: {
        ...job,
        skills: skillsResult.recordset,
        similar_jobs: similarJobsResult.recordset
      }
    });

  } catch (error) {
    console.error('Get job details error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job details'
    });
  }
});

// Get job statistics (public)
router.get('/stats/overview', async (req, res) => {
  try {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM Jobs WHERE status = 'active') as active_jobs,
        (SELECT COUNT(DISTINCT company_id) FROM Jobs WHERE status = 'active') as active_companies,
        (SELECT COUNT(*) FROM Applications WHERE applied_date >= DATEADD(day, -30, GETDATE())) as applications_last_30_days,
        (SELECT TOP 1 industry FROM Jobs WHERE status = 'active' GROUP BY industry ORDER BY COUNT(*) DESC) as top_industry,
        (SELECT TOP 1 location FROM Jobs WHERE status = 'active' GROUP BY location ORDER BY COUNT(*) DESC) as top_location
    `;

    const result = await executeQuery(query);

    res.json({
      success: true,
      data: result.recordset[0]
    });

  } catch (error) {
    console.error('Get job stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get job statistics'
    });
  }
});

// Get filter options (public)
router.get('/filters/options', async (req, res) => {
  try {
    const queries = {
      industries: `
        SELECT DISTINCT industry 
        FROM Jobs 
        WHERE status = 'active' AND industry IS NOT NULL 
        ORDER BY industry
      `,
      locations: `
        SELECT DISTINCT location 
        FROM Jobs 
        WHERE status = 'active' AND location IS NOT NULL 
        ORDER BY location
      `,
      companies: `
        SELECT DISTINCT c.company_name, c.company_id
        FROM Companies c
        INNER JOIN Jobs j ON c.company_id = j.company_id
        WHERE j.status = 'active'
        ORDER BY c.company_name
      `,
      jobTypes: `
        SELECT DISTINCT job_type 
        FROM Jobs 
        WHERE status = 'active' 
        ORDER BY job_type
      `,
      experienceLevels: `
        SELECT DISTINCT experience_level 
        FROM Jobs 
        WHERE status = 'active' 
        ORDER BY 
          CASE experience_level
            WHEN 'Entry-level' THEN 1
            WHEN 'Mid-level' THEN 2
            WHEN 'Senior-level' THEN 3
            WHEN 'Executive' THEN 4
          END
      `,
      salaryRanges: `
        SELECT 
          MIN(salary_min) as min_salary,
          MAX(salary_max) as max_salary,
          AVG(salary_min) as avg_min_salary,
          AVG(salary_max) as avg_max_salary
        FROM Jobs 
        WHERE status = 'active' AND salary_min IS NOT NULL AND salary_max IS NOT NULL
      `
    };

    const results = {};
    
    for (const [key, query] of Object.entries(queries)) {
      const result = await executeQuery(query);
      results[key] = result.recordset;
    }

    res.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('Get filter options error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get filter options'
    });
  }
});

// Search jobs with advanced filters (public)
router.post('/search', optionalAuth, [
  body('keywords').optional().trim(),
  body('location').optional().trim(),
  body('radius').optional().isInt({ min: 1, max: 100 }).withMessage('Radius must be between 1 and 100 km'),
  body('job_types').optional().isArray(),
  body('experience_levels').optional().isArray(),
  body('industries').optional().isArray(),
  body('salary_range.min').optional().isNumeric(),
  body('salary_range.max').optional().isNumeric(),
  body('remote_only').optional().isBoolean(),
  body('posted_within_days').optional().isInt({ min: 1, max: 365 }),
  body('company_size').optional().isArray(),
  body('sort_by').optional().isIn(['relevance', 'posted_date', 'salary', 'company_name']),
  body('page').optional().isInt({ min: 1 }),
  body('limit').optional().isInt({ min: 1, max: 50 })
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
      keywords,
      location,
      radius,
      job_types,
      experience_levels,
      industries,
      salary_range,
      remote_only,
      posted_within_days,
      company_size,
      sort_by = 'relevance',
      page = 1,
      limit = 20
    } = req.body;

    const offset = (page - 1) * limit;

    // Build dynamic WHERE clause
    let whereClause = 'WHERE j.status = \'active\'';
    const params = {};

    if (keywords) {
      whereClause += ' AND (j.title LIKE @keywords OR j.description LIKE @keywords OR j.requirements LIKE @keywords OR c.company_name LIKE @keywords)';
      params.keywords = `%${keywords}%`;
    }

    if (location) {
      whereClause += ' AND j.location LIKE @location';
      params.location = `%${location}%`;
    }

    if (job_types && job_types.length > 0) {
      const placeholders = job_types.map((_, index) => `@jobType${index}`).join(',');
      whereClause += ` AND j.job_type IN (${placeholders})`;
      job_types.forEach((type, index) => {
        params[`jobType${index}`] = type;
      });
    }

    if (experience_levels && experience_levels.length > 0) {
      const placeholders = experience_levels.map((_, index) => `@expLevel${index}`).join(',');
      whereClause += ` AND j.experience_level IN (${placeholders})`;
      experience_levels.forEach((level, index) => {
        params[`expLevel${index}`] = level;
      });
    }

    if (industries && industries.length > 0) {
      const placeholders = industries.map((_, index) => `@industry${index}`).join(',');
      whereClause += ` AND j.industry IN (${placeholders})`;
      industries.forEach((industry, index) => {
        params[`industry${index}`] = industry;
      });
    }

    if (salary_range) {
      if (salary_range.min) {
        whereClause += ' AND (j.salary_min >= @salaryMin OR j.salary_min IS NULL)';
        params.salaryMin = salary_range.min;
      }
      if (salary_range.max) {
        whereClause += ' AND (j.salary_max <= @salaryMax OR j.salary_max IS NULL)';
        params.salaryMax = salary_range.max;
      }
    }

    if (remote_only) {
      whereClause += ' AND j.remote_work_option IN (\'Yes\', \'Hybrid\')';
    }

    if (posted_within_days) {
      whereClause += ' AND j.posted_date >= DATEADD(day, -@postedWithinDays, GETDATE())';
      params.postedWithinDays = posted_within_days;
    }

    if (company_size && company_size.length > 0) {
      const placeholders = company_size.map((_, index) => `@companySize${index}`).join(',');
      whereClause += ` AND c.company_size IN (${placeholders})`;
      company_size.forEach((size, index) => {
        params[`companySize${index}`] = size;
      });
    }

    // Build ORDER BY clause
    let orderBy = 'ORDER BY ';
    switch (sort_by) {
      case 'posted_date':
        orderBy += 'j.posted_date DESC';
        break;
      case 'salary':
        orderBy += 'j.salary_max DESC, j.salary_min DESC';
        break;
      case 'company_name':
        orderBy += 'c.company_name ASC';
        break;
      default: // relevance
        if (keywords) {
          orderBy += `
            CASE 
              WHEN j.title LIKE @keywords THEN 1
              WHEN c.company_name LIKE @keywords THEN 2
              WHEN j.description LIKE @keywords THEN 3
              ELSE 4
            END ASC, j.posted_date DESC
          `;
        } else {
          orderBy += 'j.posted_date DESC';
        }
    }

    let selectClause = `
      SELECT j.job_id, j.title, j.description, j.location, j.remote_work_option,
             j.salary_min, j.salary_max, j.salary_currency, j.job_type, j.experience_level,
             j.industry, j.posted_date, j.application_deadline, j.views_count,
             c.company_name, c.logo_url, c.company_size,
             COUNT(*) OVER() as total_count
    `;

    // Add user-specific fields if authenticated
    if (req.user && req.user.userType === 'jobseeker') {
      selectClause += `,
        (SELECT COUNT(*) FROM Applications WHERE job_id = j.job_id AND jobseeker_id = @jobseekerId) as has_applied,
        (SELECT COUNT(*) FROM SavedJobs WHERE job_id = j.job_id AND jobseeker_id = @jobseekerId) as is_saved
      `;
      params.jobseekerId = req.user.jobseekerId;
    }

    const query = `
      ${selectClause}
      FROM Jobs j
      INNER JOIN Companies c ON j.company_id = c.company_id
      ${whereClause}
      ${orderBy}
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
        },
        search_criteria: {
          keywords,
          location,
          radius,
          job_types,
          experience_levels,
          industries,
          salary_range,
          remote_only,
          posted_within_days,
          company_size,
          sort_by
        }
      }
    });

  } catch (error) {
    console.error('Advanced search error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to search jobs'
    });
  }
});

// Get trending jobs (public)
router.get('/trending/popular', async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const query = `
      SELECT TOP (@limit) j.job_id, j.title, j.location, j.job_type, j.salary_min, j.salary_max,
             j.posted_date, j.views_count, j.current_applications,
             c.company_name, c.logo_url
      FROM Jobs j
      INNER JOIN Companies c ON j.company_id = c.company_id
      WHERE j.status = 'active'
        AND j.posted_date >= DATEADD(day, -30, GETDATE())
      ORDER BY (j.views_count * 0.7 + j.current_applications * 0.3) DESC, j.posted_date DESC
    `;

    const result = await executeQuery(query, { limit: parseInt(limit) });

    res.json({
      success: true,
      data: result.recordset
    });

  } catch (error) {
    console.error('Get trending jobs error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get trending jobs'
    });
  }
});

// Get jobs by company (public)
router.get('/company/:companyId', optionalAuth, [
  param('companyId').isInt().withMessage('Invalid company ID'),
  query('page').optional().isInt({ min: 1 }),
  query('limit').optional().isInt({ min: 1, max: 50 })
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

    const { companyId } = req.params;
    const { page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    // Check if company exists
    const companyQuery = `
      SELECT company_id, company_name, company_description, logo_url, website, industry, company_size
      FROM Companies 
      WHERE company_id = @companyId
    `;
    const companyResult = await executeQuery(companyQuery, { companyId });

    if (companyResult.recordset.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const company = companyResult.recordset[0];

    let selectClause = `
      SELECT j.job_id, j.title, j.description, j.location, j.remote_work_option,
             j.salary_min, j.salary_max, j.salary_currency, j.job_type, j.experience_level,
             j.industry, j.posted_date, j.application_deadline, j.current_applications,
             COUNT(*) OVER() as total_count
    `;

    // Add user-specific fields if authenticated
    const params = { companyId, offset, limit: parseInt(limit) };

    if (req.user && req.user.userType === 'jobseeker') {
      selectClause += `,
        (SELECT COUNT(*) FROM Applications WHERE job_id = j.job_id AND jobseeker_id = @jobseekerId) as has_applied,
        (SELECT COUNT(*) FROM SavedJobs WHERE job_id = j.job_id AND jobseeker_id = @jobseekerId) as is_saved
      `;
      params.jobseekerId = req.user.jobseekerId;
    }

    const jobsQuery = `
      ${selectClause}
      FROM Jobs j
      WHERE j.company_id = @companyId AND j.status = 'active'
      ORDER BY j.posted_date DESC
      OFFSET @offset ROWS
      FETCH NEXT @limit ROWS ONLY
    `;

    const jobsResult = await executeQuery(jobsQuery, params);

    const totalCount = jobsResult.recordset.length > 0 ? jobsResult.recordset[0].total_count : 0;

    res.json({
      success: true,
      data: {
        company,
        jobs: jobsResult.recordset,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          totalPages: Math.ceil(totalCount / limit)
        }
      }
    });

  } catch (error) {
    console.error('Get jobs by company error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get company jobs'
    });
  }
});

// Get all available skills (public)
router.get('/skills/all', async (req, res) => {
  try {
    const { category } = req.query;
    
    let whereClause = '';
    const params = {};
    
    if (category) {
      whereClause = 'WHERE category = @category';
      params.category = category;
    }

    const query = `
      SELECT skill_id, skill_name, category
      FROM Skills
      ${whereClause}
      ORDER BY category, skill_name
    `;

    const result = await executeQuery(query, params);

    // Group by category
    const skillsByCategory = result.recordset.reduce((acc, skill) => {
      const category = skill.category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push({
        skill_id: skill.skill_id,
        skill_name: skill.skill_name
      });
      return acc;
    }, {});

    res.json({
      success: true,
      data: {
        skills: result.recordset,
        skills_by_category: skillsByCategory
      }
    });

  } catch (error) {
    console.error('Get skills error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get skills'
    });
  }
});

module.exports = router;