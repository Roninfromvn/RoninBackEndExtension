// tokenVault.js - Token Vault routes (Redis-based)
const express = require('express');
const router = express.Router();

// Import Redis-based token store
const {
  upsertPageTokenEncrypted,
  setCachePlain,
  getCachedPlain,
  acquireRotateLock,
  releaseRotateLock,
  markTokenError,
  markTokenSuccess,
  getBestTokenCandidate,
  loadEncryptedById
} = require('../token/tokenStore.redis');

const { 
  encryptTokenWithWrapping, 
  decryptTokenWithWrapping 
} = require('../token/kms');

// Facebook API helper
const FB_API_VERSION = process.env.FB_API_VERSION || 'v19.0';
const FB_BASE = `https://graph.facebook.com/${FB_API_VERSION}`;
async function fbGet(path, params) {
  const url = new URL(`${FB_BASE}${path}`);
  Object.entries(params).forEach(([k,v]) => { 
    if (v!=null && v!=='') url.searchParams.set(k,v); 
  });
  const r = await fetch(url.toString());
  const text = await r.text();
  let data; 
  try { 
    data = JSON.parse(text); 
  } catch { 
    data = { raw:text }; 
  }
  if (!r.ok) {
    const e = data?.error || {};
    throw new Error(e.message || `${r.status} ${r.statusText}`);
  }
  return data;
}

// Wrapper function để xử lý async errors
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// POST /token/user/paste - Paste user token và discover pages
router.post('/user/paste', wrap(async (req, res) => {
  try {
    const { userToken, sourceLabel } = req.body;
    if (!userToken) return res.status(400).json({ error: 'userToken required' });

    const me = await fbGet('/me', { fields: 'id,name', access_token: userToken });
    const accounts = await fbGet('/me/accounts', {
      fields: 'id,name,access_token', limit: '500', access_token: userToken
    });

    const updated = [], failed = [];
    for (const p of (accounts.data || [])) {
      try {
        // warm-check tối thiểu
        await fbGet(`/${p.id}`, { fields: 'id,name', access_token: p.access_token });

        // mã hoá + lưu Redis + set cache
        const packet = encryptTokenWithWrapping(p.access_token);
        const tokenId = await upsertPageTokenEncrypted(p.id, packet, {
          sourceUserId: me.id,
          sourceLabel: sourceLabel || 'extension',
          issuedAt: Date.now(),
          status: 'active',
          setPrimary: true
        });
        await setCachePlain(p.id, p.access_token, { tokenId, issuedAt: Date.now() });

        updated.push({ pageId: p.id, pageName: p.name, tokenId, status: 'ok' });
      } catch (e) {
        failed.push({ pageId: p.id, pageName: p.name, status: 'failed', error: e.message });
      }
    }

    res.json({
      totalPages: (accounts.data || []).length,
      updated: updated.length,
      failed: failed.map(x => x.pageId),
      pages: [...updated, ...failed]
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// GET /token/page/:pageId - Lấy best available page token
router.get('/page/:pageId', wrap(async (req, res) => {
  try {
    const { pageId } = req.params;
    
    if (!pageId) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Page ID is required' 
      });
    }

    // Kiểm tra cache trước
    const cached = await getCachedPlain(pageId);
    if (cached) return res.json({ pageId, token: cached, source: 'cache' });

    const gotLock = await acquireRotateLock(pageId);
    try {
      const cached2 = await getCachedPlain(pageId);
      if (cached2) return res.json({ pageId, token: cached2, source: 'cache' });

      const cand = await getBestTokenCandidate(pageId);
      if (!cand) return res.status(401).json({ error: 'AUTH_NEEDED' });

      const packet = await loadEncryptedById(pageId, cand.tokenId);
      if (!packet) return res.status(401).json({ error: 'AUTH_NEEDED' });

      const plaintext = decryptTokenWithWrapping({
        token_enc: packet.token_enc, iv: packet.iv, tag: packet.tag,
        wrapped_key: packet.wrapped_key, wrapped_iv: packet.wrapped_iv, wrapped_tag: packet.wrapped_tag
      });

      // warm-check nhẹ
      try {
        await fbGet(`/${pageId}`, { fields: 'id,name', access_token: plaintext });
        await setCachePlain(pageId, plaintext, { tokenId: cand.tokenId, issuedAt: Date.now() });
        await markTokenSuccess(pageId, cand.tokenId);
        return res.json({ pageId, token: plaintext, source: 'store' });
      } catch (e) {
        await markTokenError(pageId, cand.tokenId, e.message);
        const cand2 = await getBestTokenCandidate(pageId);
        if (!cand2 || cand2.tokenId === cand.tokenId) {
          return res.status(401).json({ error: 'AUTH_NEEDED' });
        }
        const packet2 = await loadEncryptedById(pageId, cand2.tokenId);
        const plaintext2 = decryptTokenWithWrapping({
          token_enc: packet2.token_enc, iv: packet2.iv, tag: packet2.tag,
          wrapped_key: packet2.wrapped_key, wrapped_iv: packet2.wrapped_iv, wrapped_tag: packet2.wrapped_tag
        });
        await fbGet(`/${pageId}`, { fields: 'id,name', access_token: plaintext2 });
        await setCachePlain(pageId, plaintext2, { tokenId: cand2.tokenId, issuedAt: Date.now() });
        await markTokenSuccess(pageId, cand2.tokenId);
        return res.json({ pageId, token: plaintext2, source: 'store' });
      }
    } finally {
      if (gotLock) await releaseRotateLock(pageId);
    }
    
  } catch (err) {
    console.error('[TokenVault] Error getting page token:', err);
    res.status(500).json({ 
      ok: false, 
      error: err.message,
      code: 'INTERNAL_ERROR',
      stack: err.stack,
      timestamp: new Date().toISOString()
    });
  }
}));

// GET /token/pages - Liệt kê pages theo agent (Redis-based)
router.get('/pages', wrap(async (req, res) => {
  try {
    const agentId = req.headers['x-agent'];
    
    if (!agentId) {
      return res.status(400).json({ 
        error: 'x-agent header is required',
        message: 'Please provide x-agent header to identify the requesting agent'
      });
    }

    console.log(`[TokenVault] Getting pages for agent: ${agentId}`);
    
    // Import Redis-based store
    const { getAllPagesWithTokens } = require('../token/tokenStore.redis');
    
    // Lấy tất cả pages
    const allPages = await getAllPagesWithTokens();
    
    // Filter theo agentId (sourceLabel)
    const agentPages = allPages.filter(page => {
      // Kiểm tra nếu page có metadata và sourceLabel
      if (page.metadata && page.metadata.sourceLabel) {
        return page.metadata.sourceLabel === agentId;
      }
      // Fallback: kiểm tra trực tiếp sourceLabel
      return page.sourceLabel === agentId;
    });
    
    console.log(`[TokenVault] Found ${agentPages.length} pages for agent ${agentId}`);
    
    res.json({ 
      pages: agentPages,
      total: agentPages.length,
      agentId: agentId,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('[TokenVault] Error getting pages list:', err);
    res.status(500).json({ error: err.message });
  }
}));

module.exports = router;
