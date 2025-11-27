/**
 * FoldersCache - In-memory caching service for Google Drive folders
 * 
 * Features:
 * - In-memory cache with TTL (Time To Live)
 * - Automatic refresh when cache expires
 * - Fallback to stale cache on API errors
 * - Prevents concurrent API calls during refresh
 * - Configurable cache duration
 */

const GoogleDriveService = require('./GoogleDriveService');
const { config } = require('../../config');

class FoldersCache {
  constructor() {
    this.cache = null;
    this.lastUpdate = null;
    this.refreshPromise = null;
    
    // Configuration
    this.CACHE_TTL = 5 * 60 * 1000; // 5 minutes default
    this.MAX_STALE_AGE = 30 * 60 * 1000; // 30 minutes max stale
    
    // Services
    this.googleDriveService = new GoogleDriveService();
    this.rootFolderId = config.googleDrive.rootFolderId;
    
    console.log('[FoldersCache] Initialized with TTL:', this.CACHE_TTL / 1000, 'seconds');
  }
  
  /**
   * Get folders from cache or refresh if needed
   * @returns {Promise<Array>} Array of folder objects
   */
  async getFolders() {
    try {
      // Return fresh cache immediately
      if (this.isCacheFresh()) {
        console.log('[FoldersCache] Returning fresh cache, age:', this.getCacheAge() / 1000, 'seconds');
        return this.cache;
      }
      
      // Prevent multiple concurrent refreshes
      if (this.refreshPromise) {
        console.log('[FoldersCache] Waiting for ongoing refresh...');
        return await this.refreshPromise;
      }
      
      // Start refresh process
      console.log('[FoldersCache] Cache expired, refreshing...');
      this.refreshPromise = this.refreshCache();
      
      try {
        const result = await this.refreshPromise;
        return result;
      } finally {
        this.refreshPromise = null;
      }
      
    } catch (error) {
      console.error('[FoldersCache] Error in getFolders:', error);
      
      // Return stale cache if available and not too old
      if (this.cache && this.getCacheAge() < this.MAX_STALE_AGE) {
        console.warn('[FoldersCache] Returning stale cache due to error, age:', this.getCacheAge() / 1000, 'seconds');
        return this.cache;
      }
      
      throw new Error(`Failed to get folders: ${error.message}`);
    }
  }
  
  /**
   * Check if cache is still fresh
   * @returns {boolean}
   */
  isCacheFresh() {
    return this.cache && 
           this.lastUpdate && 
           this.getCacheAge() < this.CACHE_TTL;
  }
  
  /**
   * Get cache age in milliseconds
   * @returns {number}
   */
  getCacheAge() {
    return this.lastUpdate ? Date.now() - this.lastUpdate : Infinity;
  }
  
  /**
   * Refresh cache from Google Drive API
   * @returns {Promise<Array>}
   */
  async refreshCache() {
    const startTime = Date.now();
    console.log('[FoldersCache] Starting cache refresh...');
    
    try {
      // Fetch folders recursively from Google Drive
      const folders = await this.fetchFoldersFromDrive();
      
      // Update cache
      this.cache = folders;
      this.lastUpdate = Date.now();
      
      const duration = Date.now() - startTime;
      console.log(`[FoldersCache] ✅ Cache refreshed successfully: ${folders.length} folders in ${duration}ms`);
      
      return this.cache;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`[FoldersCache] ❌ Cache refresh failed after ${duration}ms:`, error);
      throw error;
    }
  }
  
  /**
   * Fetch folders from Google Drive recursively
   * @returns {Promise<Array>}
   */
  async fetchFoldersFromDrive() {
    const folders = [];
    const queue = [this.rootFolderId];
    
    console.log('[FoldersCache] Scanning folders from root:', this.rootFolderId);
    
    while (queue.length > 0) {
      const folderId = queue.shift();
      
      try {
        // Get subfolders in current folder
        const query = `'${folderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'`;
        const subfolders = await this.googleDriveService.listByQuery(query, 'files(id,name,createdTime,parents)');
        
        // Add to results
        folders.push(...subfolders);
        
        // Add to queue for recursive scanning
        subfolders.forEach(folder => queue.push(folder.id));
        
      } catch (error) {
        console.error(`[FoldersCache] Error scanning folder ${folderId}:`, error);
        // Continue with other folders
      }
    }
    
    console.log(`[FoldersCache] Found ${folders.length} folders total`);
    return folders;
  }
  
  /**
   * Force refresh cache (bypass TTL)
   * @returns {Promise<Array>}
   */
  async forceRefresh() {
    console.log('[FoldersCache] Force refresh requested');
    this.lastUpdate = null; // Force cache to be stale
    return await this.getFolders();
  }
  
  /**
   * Clear cache
   */
  clearCache() {
    console.log('[FoldersCache] Cache cleared');
    this.cache = null;
    this.lastUpdate = null;
    this.refreshPromise = null;
  }
  
  /**
   * Get cache statistics
   * @returns {Object}
   */
  getStats() {
    return {
      hasCacheData: !!this.cache,
      cacheSize: this.cache ? this.cache.length : 0,
      lastUpdate: this.lastUpdate,
      cacheAge: this.getCacheAge(),
      isFresh: this.isCacheFresh(),
      isRefreshing: !!this.refreshPromise,
      ttl: this.CACHE_TTL,
      maxStaleAge: this.MAX_STALE_AGE
    };
  }
}

// Export singleton instance
const foldersCache = new FoldersCache();
module.exports = foldersCache;
