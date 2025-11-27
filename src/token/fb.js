// fb.js - Facebook API helpers cho token operations
const { redactToken } = require('./kms');

// Facebook Graph API version
const FB_API_VERSION = process.env.FACEBOOK_API_VERSION || 'v19.0';
const FB_APP_ID = process.env.FB_APP_ID || 'unknown';

// Base URL cho Facebook Graph API
const FB_API_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;

// Debug user token để kiểm tra validity, scope, expiry
async function debugUserToken(userToken) {
  try {
    const url = `${FB_API_BASE}/debug_token`;
    const params = new URLSearchParams({
      input_token: userToken,
      access_token: userToken
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();
    
    if (!response.ok) {
      const e = data.error || {};
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message || response.statusText}`);
    }

    if (data.error) {
      const e = data.error;
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message}`);
    }

    const result = {
      isValid: data.data.is_valid,
      isExpired: data.data.is_expired || false,
      appId: data.data.app_id,
      userId: data.data.user_id,
      scopes: data.data.scopes || [],
      expiresAt: data.data.expires_at ? new Date(data.data.expires_at * 1000) : null,
      issuedAt: data.data.issued_at ? new Date(data.data.issued_at * 1000) : null
    };

    console.log(`[FB] Debug user token [${redactToken(userToken)}]:`, {
      isValid: result.isValid,
      appId: result.appId,
      userId: result.userId,
      scopes: result.scopes.length,
      expiresAt: result.expiresAt
    });

    return result;

  } catch (error) {
    console.error(`[FB] Lỗi debug user token [${redactToken(userToken)}]:`, error.message);
    throw error;
  }
}

// Lấy danh sách pages của user
async function listUserPages(userToken) {
  try {
    const url = `${FB_API_BASE}/me/accounts`;
    const params = new URLSearchParams({
      access_token: userToken,
      fields: 'id,name,access_token',
      limit: '500'
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();
    
    if (!response.ok) {
      const e = data.error || {};
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message || response.statusText}`);
    }

    if (data.error) {
      const e = data.error;
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message}`);
    }

    const pages = data.data.map(page => ({
      id: page.id,
      name: page.name,
      access_token: page.access_token
    }));

    console.log(`[FB] Lấy được ${pages.length} pages từ user token [${redactToken(userToken)}]`);

    return pages;

  } catch (error) {
    console.error(`[FB] Lỗi lấy user pages [${redactToken(userToken)}]:`, error.message);
    throw error;
  }
}

// Derive page token từ user token
async function derivePageToken(pageId, userToken) {
  try {
    const url = `${FB_API_BASE}/${pageId}`;
    const params = new URLSearchParams({
      access_token: userToken,
      fields: 'access_token'
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();
    
    if (!response.ok) {
      const e = data.error || {};
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message || response.statusText}`);
    }

    if (data.error) {
      const e = data.error;
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message}`);
    }

    const result = {
      pageToken: data.access_token,
      issuedAt: new Date(),
      expiresAt: null // Page tokens thường không expire
    };

    console.log(`[FB] Derive page token cho page ${pageId}: [${redactToken(result.pageToken)}]`);

    return result;

  } catch (error) {
    console.error(`[FB] Lỗi derive page token cho page ${pageId}:`, error.message);
    throw error;
  }
}

// Warm check page token (lightweight validation)
async function warmCheckPageToken(pageId, pageToken) {
  try {
    const url = `${FB_API_BASE}/${pageId}`;
    const params = new URLSearchParams({
      access_token: pageToken,
      fields: 'id,name'
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();
    
    if (!response.ok) {
      const e = data.error || {};
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message || response.statusText}`);
    }

    if (data.error) {
      const e = data.error;
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message}`);
    }

    // Verify page ID matches
    if (data.id !== pageId) {
      throw new Error(`Page ID mismatch: expected ${pageId}, got ${data.id}`);
    }

    console.log(`[FB] Warm check OK cho page ${pageId}: [${redactToken(pageToken)}]`);
    return {
      pageId: data.id,
      pageName: data.name,
      isValid: true
    };

  } catch (error) {
    console.error(`[FB] Warm check FAIL cho page ${pageId}:`, error.message);
    throw error;
  }
}

// Kiểm tra page permissions (đơn giản: chỉ check access)
async function checkPagePermissions(pageId, pageToken, requiredPermissions = []) {
  try {
    const url = `${FB_API_BASE}/${pageId}`;
    const params = new URLSearchParams({
      access_token: pageToken,
      fields: 'id,name'
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();
    
    if (!response.ok) {
      const e = data.error || {};
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message || response.statusText}`);
    }

    if (data.error) {
      const e = data.error;
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message}`);
    }

    // Đơn giản: nếu gọi được API thì có quyền truy cập
    console.log(`[FB] Page ${pageId} có quyền truy cập: ${data.name}`);
    return {
      hasAllPermissions: true,
      pageId: data.id,
      pageName: data.name,
      missingPermissions: []
    };

  } catch (error) {
    console.error(`[FB] Lỗi kiểm tra permissions cho page ${pageId}:`, error.message);
    throw error;
  }
}

// Kiểm tra trạng thái page
async function checkPageStatus(pageId, pageToken) {
  try {
    const url = `${FB_API_BASE}/${pageId}`;
    const params = new URLSearchParams({
      access_token: pageToken,
      fields: 'id,name,verification_status,published_posts'
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();
    
    if (!response.ok) {
      const e = data.error || {};
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message || response.statusText}`);
    }

    if (data.error) {
      const e = data.error;
      console.error('FB_FAIL', e); // log đủ message/code/subcode
      throw new Error(`Facebook API error: ${e.message}`);
    }

    const status = {
      pageId: data.id,
      pageName: data.name,
      verificationStatus: data.verification_status || 'unknown',
      publishedPosts: data.published_posts || 0,
      isActive: true
    };

    console.log(`[FB] Page ${pageId} status:`, status);
    return status;

  } catch (error) {
    console.error(`[FB] Lỗi kiểm tra status cho page ${pageId}:`, error.message);
    return {
      pageId,
      isActive: false,
      error: error.message
    };
  }
}

module.exports = {
  debugUserToken,
  listUserPages,
  derivePageToken,
  warmCheckPageToken,
  checkPagePermissions,
  checkPageStatus,
  FB_API_VERSION,
  FB_APP_ID
};
