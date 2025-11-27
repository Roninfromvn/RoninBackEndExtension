// store.js - Token store operations với Firestore
const { Firestore } = require('@google-cloud/firestore');
const { encryptTokenWithWrapping, decryptTokenWithWrapping, redactToken } = require('./kms');
const crypto = require('crypto');

// Khởi tạo Firestore
const firestore = new Firestore({
  projectId: process.env.GOOGLE_CLOUD_PROJECT || 'your-project-id'
});

// Collections
const PAGE_TOKENS_COL = firestore.collection('page_tokens');
const PAGES_COL = firestore.collection('pages');

// Generate unique token ID
function generateTokenId() {
  return crypto.randomBytes(16).toString('hex');
}

// Lưu page token vào Firestore
async function savePageToken(pageId, tokenData) {
  try {
    const {
      pageToken,
      sourceUserId,
      sourceLabel = 'unknown',
      appId = process.env.FB_APP_ID || 'unknown',
      issuedAt = new Date(),
      expiresAt = null
    } = tokenData;

    // Encrypt token
    const encryptedData = encryptTokenWithWrapping(pageToken);
    
    // Tạo token document
    const tokenId = generateTokenId();
    const tokenDoc = {
      token_enc: encryptedData.token_enc,
      iv: encryptedData.iv,
      tag: encryptedData.tag,
      wrapped_key: encryptedData.wrapped_key,
      wrapped_iv: encryptedData.wrapped_iv,
      wrapped_tag: encryptedData.wrapped_tag,
      sourceUserId,
      sourceLabel,
      appId,
      issuedAt: Firestore.Timestamp.fromDate(issuedAt),
      expiresAt: expiresAt ? Firestore.Timestamp.fromDate(expiresAt) : null,
      status: 'active',
      lastSuccessAt: Firestore.Timestamp.fromDate(new Date()),
      lastError: null
    };

    // Lưu vào page_tokens/{pageId}/tokens/{tokenId}
    await PAGE_TOKENS_COL.doc(pageId).collection('tokens').doc(tokenId).set(tokenDoc);

    // Cập nhật pages/{pageId} nếu chưa có primaryTokenId
    const pageRef = PAGES_COL.doc(pageId);
    const pageDoc = await pageRef.get();
    
    if (!pageDoc.exists || !pageDoc.data().primaryTokenId) {
      await pageRef.set({
        primaryTokenId: tokenId,
        lastUpdated: Firestore.Timestamp.fromDate(new Date())
      }, { merge: true });
    }

    console.log(`[Store] Đã lưu token cho page ${pageId}, tokenId: ${tokenId}`);
    return tokenId;

  } catch (error) {
    console.error(`[Store] Lỗi lưu token cho page ${pageId}:`, error.message);
    throw error;
  }
}

// Cập nhật trạng thái token
async function updateTokenStatus(pageId, tokenId, updates) {
  try {
    const tokenRef = PAGE_TOKENS_COL.doc(pageId).collection('tokens').doc(tokenId);
    
    // Chỉ cho phép cập nhật một số field nhất định
    const allowedUpdates = {};
    const allowedFields = ['status', 'lastSuccessAt', 'lastError', 'expiresAt'];
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        if (key === 'lastSuccessAt' || key === 'expiresAt') {
          allowedUpdates[key] = value instanceof Date ? 
            Firestore.Timestamp.fromDate(value) : value;
        } else {
          allowedUpdates[key] = value;
        }
      }
    }

    if (Object.keys(allowedUpdates).length === 0) {
      throw new Error('No valid fields to update');
    }

    await tokenRef.update(allowedUpdates);
    console.log(`[Store] Đã cập nhật token ${tokenId} cho page ${pageId}`);

  } catch (error) {
    console.error(`[Store] Lỗi cập nhật token ${tokenId}:`, error.message);
    throw error;
  }
}

// Lấy danh sách tokens của page
async function getPageTokens(pageId, status = 'active') {
  try {
    let query = PAGE_TOKENS_COL.doc(pageId).collection('tokens');
    
    if (status) {
      query = query.where('status', '==', status);
    }

    const snapshot = await query.get();
    const tokens = [];

    snapshot.forEach(doc => {
      tokens.push({
        tokenId: doc.id,
        ...doc.data()
      });
    });

    // Sort theo issuedAt (mới nhất trước)
    tokens.sort((a, b) => {
      const aTime = a.issuedAt?.toDate?.() || a.issuedAt || new Date(0);
      const bTime = b.issuedAt?.toDate?.() || b.issuedAt || new Date(0);
      return bTime - aTime;
    });

    return tokens;

  } catch (error) {
    console.error(`[Store] Lỗi lấy tokens cho page ${pageId}:`, error.message);
    return [];
  }
}

// Lấy và decrypt token
async function getDecryptedToken(pageId, tokenId) {
  try {
    const tokenDoc = await PAGE_TOKENS_COL.doc(pageId)
      .collection('tokens').doc(tokenId).get();

    if (!tokenDoc.exists) {
      throw new Error('Token not found');
    }

    const tokenData = tokenDoc.data();
    
    // Decrypt token
    const decryptedToken = decryptTokenWithWrapping(tokenData);
    
    return {
      tokenId,
      pageToken: decryptedToken,
      ...tokenData
    };

  } catch (error) {
    console.error(`[Store] Lỗi decrypt token ${tokenId}:`, error.message);
    throw error;
  }
}

// Lấy primary token ID
async function getPrimaryTokenId(pageId) {
  try {
    const pageDoc = await PAGES_COL.doc(pageId).get();
    
    if (pageDoc.exists) {
      return pageDoc.data().primaryTokenId;
    }
    
    return null;

  } catch (error) {
    console.error(`[Store] Lỗi lấy primary token ID cho page ${pageId}:`, error.message);
    return null;
  }
}

// Set primary token ID
async function setPrimaryToken(pageId, tokenId) {
  try {
    await PAGES_COL.doc(pageId).set({
      primaryTokenId: tokenId,
      lastUpdated: Firestore.Timestamp.fromDate(new Date())
    }, { merge: true });

    console.log(`[Store] Đã set primary token ${tokenId} cho page ${pageId}`);

  } catch (error) {
    console.error(`[Store] Lỗi set primary token cho page ${pageId}:`, error.message);
    throw error;
  }
}

// Cleanup old tokens
async function cleanupOldTokens(pageId, keepN = 5) {
  try {
    const tokens = await getPageTokens(pageId);
    const now = new Date();
    const cutoffError = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000); // 14 days
    const cutoffExpired = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000); // 3 days

    let deletedCount = 0;
    const tokensToDelete = [];

    // Xóa tokens cũ (giữ lại N tokens gần nhất)
    if (tokens.length > keepN) {
      const tokensToRemove = tokens.slice(keepN);
      for (const token of tokensToRemove) {
        tokensToDelete.push(token.tokenId);
      }
    }

    // Xóa error tokens cũ
    for (const token of tokens) {
      if (token.status === 'error' && token.lastError) {
        const lastErrorTime = token.lastError.toDate?.() || token.lastError;
        if (lastErrorTime < cutoffError) {
          tokensToDelete.push(token.tokenId);
        }
      }
    }

    // Xóa expired tokens cũ
    for (const token of tokens) {
      if (token.expiresAt) {
        const expiryTime = token.expiresAt.toDate?.() || token.expiresAt;
        if (expiryTime < cutoffExpired) {
          tokensToDelete.push(token.tokenId);
        }
      }
    }

    // Thực hiện xóa
    const batch = firestore.batch();
    for (const tokenId of tokensToDelete) {
      const tokenRef = PAGE_TOKENS_COL.doc(pageId).collection('tokens').doc(tokenId);
      batch.delete(tokenRef);
    }

    if (tokensToDelete.length > 0) {
      await batch.commit();
      deletedCount = tokensToDelete.length;
      console.log(`[Store] Đã xóa ${deletedCount} tokens cũ cho page ${pageId}`);
    }

    return deletedCount;

  } catch (error) {
    console.error(`[Store] Lỗi cleanup tokens cho page ${pageId}:`, error.message);
    return 0;
  }
}

// Lấy tất cả pages có tokens
async function getAllPagesWithTokens() {
  try {
    const snapshot = await PAGE_TOKENS_COL.get();
    const pages = [];

    for (const doc of snapshot.docs) {
      const pageId = doc.id;
      const tokensSnapshot = await doc.ref.collection('tokens').get();
      
      if (tokensSnapshot.size > 0) {
        pages.push(pageId);
      }
    }

    return pages;

  } catch (error) {
    console.error('[Store] Lỗi lấy pages với tokens:', error.message);
    return [];
  }
}

module.exports = {
  savePageToken,
  updateTokenStatus,
  getPageTokens,
  getDecryptedToken,
  getPrimaryTokenId,
  setPrimaryToken,
  cleanupOldTokens,
  getAllPagesWithTokens,
  generateTokenId
};
