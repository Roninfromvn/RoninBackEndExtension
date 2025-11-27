// swipeLinksApi.js - API endpoints for swipe links management
const express = require('express');
const router = express.Router();
const SwipeLinksService = require('../services/SwipeLinksService');
const { wrapAsync } = require('../utils/errorHandler');

const swipeLinksService = new SwipeLinksService();

// =============================================================================
// SWIPE LINKS API ENDPOINTS
// =============================================================================

/**
 * GET /api/swipe-links/categories
 * Get all available categories
 */
router.get('/categories', wrapAsync(async (req, res) => {
  try {
    console.log('[SwipeLinksAPI] Getting categories');
    
    const categories = await swipeLinksService.getCategories();
    
    res.json({
      success: true,
      data: categories
    });
    
  } catch (error) {
    console.error('[SwipeLinksAPI] Error getting categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get categories',
      details: error.message
    });
  }
}));

/**
 * GET /api/swipe-links/stats
 * Get swipe links statistics
 */
router.get('/stats', wrapAsync(async (req, res) => {
  try {
    console.log('[SwipeLinksAPI] Getting stats');
    
    const stats = await swipeLinksService.getStats();
    
    res.json({
      success: true,
      data: stats
    });
    
  } catch (error) {
    console.error('[SwipeLinksAPI] Error getting stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get stats',
      details: error.message
    });
  }
}));

/**
 * GET /api/swipe-links/random
 * Get random swipe link (date is just for reference, not filtering)
 */
router.get('/random', wrapAsync(async (req, res) => {
  try {
    const { date, pageId, category } = req.query;
    
    // Date is optional - just for reference, not filtering
    const referenceDate = date || new Date().toISOString().split('T')[0];
    
    console.log(`[SwipeLinksAPI] Getting random swipe link for pageId: ${pageId}, category: ${category}, referenceDate: ${referenceDate}`);
    
    const swipeLink = await swipeLinksService.getRandomSwipeLink(referenceDate, pageId, category);
    
    if (!swipeLink) {
      return res.status(404).json({
        success: false,
        error: 'No active swipe links found',
        category: category || 'any',
        referenceDate: referenceDate
      });
    }
    
    res.json({
      success: true,
      data: swipeLink,
      referenceDate: referenceDate
    });
    
  } catch (error) {
    console.error('[SwipeLinksAPI] Error getting random swipe link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get random swipe link',
      details: error.message
    });
  }
}));

/**
 * GET /api/swipe-links/:id
 * Get specific swipe link by ID
 */
router.get('/:id', wrapAsync(async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`[SwipeLinksAPI] Getting swipe link by ID: ${id}`);
    
    const swipeLink = await swipeLinksService.getSwipeLinkById(parseInt(id));
    
    if (!swipeLink) {
      return res.status(404).json({
        success: false,
        error: 'Swipe link not found',
        id: id
      });
    }
    
    res.json({
      success: true,
      data: swipeLink
    });
    
  } catch (error) {
    console.error('[SwipeLinksAPI] Error getting swipe link by ID:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get swipe link',
      details: error.message
    });
  }
}));

/**
 * GET /api/swipe-links
 * Get swipe links with filtering and pagination
 */
router.get('/', wrapAsync(async (req, res) => {
  try {
    const { 
      startDate, 
      endDate, 
      is_active, 
      limit = 50, 
      offset = 0,
      sort_by,
      sort_dir
    } = req.query;
    
    console.log('[SwipeLinksAPI] Getting swipe links with params:', { 
      startDate, endDate, is_active, limit, offset, sort_by, sort_dir
    });
    
    let swipeLinks;
    
    if (startDate && endDate) {
      // Get by date range
      swipeLinks = await swipeLinksService.getSwipeLinksByDateRange(startDate, endDate);
    } else {
      // Get all (with basic filtering)
      swipeLinks = await swipeLinksService.getAllSwipeLinks({
        is_active: is_active !== undefined ? is_active === 'true' : undefined,
        limit: parseInt(limit),
        offset: parseInt(offset),
        sort_by,
        sort_dir
      });
    }
    
    res.json({
      success: true,
      data: swipeLinks,
      total: swipeLinks.length,
      params: { startDate, endDate, is_active, limit, offset, sort_by, sort_dir }
    });
    
  } catch (error) {
    console.error('[SwipeLinksAPI] Error getting swipe links:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get swipe links',
      details: error.message
    });
  }
}));

/**
 * POST /api/swipe-links
 * Create new swipe link
 */
router.post('/', wrapAsync(async (req, res) => {
  try {
    const { date, link, title, description, category, is_active } = req.body;
    
    // Validation
    if (!date || !link || !title) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: date, link, title'
      });
    }
    
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(date)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid date format. Use YYYY-MM-DD'
      });
    }
    
    // Validate URL format
    const urlRegex = /^https?:\/\/.+/;
    if (!urlRegex.test(link)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid link format. Must start with http:// or https://'
      });
    }
    
    console.log(`[SwipeLinksAPI] Creating swipe link: ${title} (${link}) for date: ${date}`);
    
    const swipeLink = await swipeLinksService.createSwipeLink({
      date,
      link,
      title,
      description,
      category: category || 'general',
      is_active: is_active !== undefined ? is_active : true
    });
    
    res.status(201).json({
      success: true,
      data: swipeLink,
      message: 'Swipe link created successfully'
    });
    
  } catch (error) {
    console.error('[SwipeLinksAPI] Error creating swipe link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create swipe link',
      details: error.message
    });
  }
}));

/**
 * PUT /api/swipe-links/:id
 * Update swipe link
 */
router.put('/:id', wrapAsync(async (req, res) => {
  try {
    const { id } = req.params;
    const { date, link, title, description, category, is_active } = req.body;
    
    console.log(`[SwipeLinksAPI] Updating swipe link ID: ${id}`);
    
    const swipeLink = await swipeLinksService.updateSwipeLink(id, {
      date,
      link,
      title,
      description,
      category,
      is_active
    });
    
    res.json({
      success: true,
      data: swipeLink,
      message: 'Swipe link updated successfully'
    });
    
  } catch (error) {
    console.error('[SwipeLinksAPI] Error updating swipe link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update swipe link',
      details: error.message
    });
  }
}));

/**
 * DELETE /api/swipe-links/:id
 * Delete swipe link
 */
router.delete('/:id', wrapAsync(async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log(`[SwipeLinksAPI] Deleting swipe link ID: ${id}`);
    
    const success = await swipeLinksService.deleteSwipeLink(id);
    
    if (!success) {
      return res.status(404).json({
        success: false,
        error: 'Swipe link not found',
        id: id
      });
    }
    
    res.json({
      success: true,
      message: 'Swipe link deleted successfully'
    });
    
  } catch (error) {
    console.error('[SwipeLinksAPI] Error deleting swipe link:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete swipe link',
      details: error.message
    });
  }
}));


/**
 * GET /api/swipe-links/page/:pageId/categories
 * Get categories assigned to a specific page
 */
router.get('/page/:pageId/categories', wrapAsync(async (req, res) => {
  try {
    const { pageId } = req.params;
    
    console.log(`[SwipeLinksAPI] Getting categories for page: ${pageId}`);
    
    const categories = await swipeLinksService.getPageCategories(pageId);
    
    res.json({
      success: true,
      data: {
        pageId: pageId,
        categories: categories,
        categoryCount: categories.length
      }
    });
    
  } catch (error) {
    console.error('[SwipeLinksAPI] Error getting page categories:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get page categories',
      details: error.message
    });
  }
}));

/**
 * POST /api/swipe-links/page/:pageId/categories
 * Assign categories to a specific page
 */
router.post('/page/:pageId/categories', wrapAsync(async (req, res) => {
  try {
    const { pageId } = req.params;
    const { categories } = req.body;
    
    // Validation
    if (!categories || !Array.isArray(categories)) {
      return res.status(400).json({
        success: false,
        error: 'Categories must be an array'
      });
    }
    
    console.log(`[SwipeLinksAPI] Assigning categories to page ${pageId}:`, categories);
    
    const result = await swipeLinksService.assignCategoriesToPage(pageId, categories);
    
    res.json({
      success: true,
      data: result,
      message: `Categories assigned to page ${pageId}`
    });
    
  } catch (error) {
    console.error('[SwipeLinksAPI] Error assigning categories to page:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to assign categories to page',
      details: error.message
    });
  }
}));


module.exports = router;
