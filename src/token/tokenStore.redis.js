// src/token/tokenStore.redis.js
const { ensure } = require('../redis/client');
const { v4: uuid } = require('uuid');

/*
Redis keys:
- pts:<pageId>               ZSET (score=issuedAt, member=tokenId)
- ptt:<pageId>:<tokenId>     HASH (packet+meta mã hoá)
- pt:<pageId>                STRING (cache plaintext) TTL ~12h
- pt_meta:<pageId>           HASH { tokenId, issuedAt, expiresAt }
- primary:<pageId>           STRING tokenId (tuỳ chọn)
- lock:rotate:page:<pageId>  STRING (NX) TTL 2–5 phút
*/

const CACHE_TTL_SEC = 60 * 60 * 12;

const kZ = (pid) => `pts:${pid}`;
const kH = (pid, tid) => `ptt:${pid}:${tid}`;
const kC = (pid) => `pt:${pid}`;
const kM = (pid) => `pt_meta:${pid}`;
const kP = (pid) => `primary:${pid}`;
const kL = (pid) => `lock:rotate:page:${pid}`;

async function upsertPageTokenEncrypted(pageId, packet, meta = {}) {
  const r = await ensure();
  const tokenId = uuid();
  const issuedAt = meta.issuedAt || Date.now();

  await r.hset(kH(pageId, tokenId), {
    token_enc: packet.token_enc,
    iv: packet.iv, 
    tag: packet.tag,
    wrapped_key: packet.wrapped_key,
    wrapped_iv: packet.wrapped_iv,
    wrapped_tag: packet.wrapped_tag,
    sourceUserId: meta.sourceUserId || '',
    sourceLabel: meta.sourceLabel || '',
    issuedAt: String(issuedAt),
    expiresAt: meta.expiresAt ? String(meta.expiresAt) : '',
    status: meta.status || 'active',
    lastSuccessAt: '',
    lastError: ''
  });
  await r.zadd(kZ(pageId), issuedAt, tokenId);
  if (meta.setPrimary) await r.set(kP(pageId), tokenId);
  return tokenId;
}

async function setCachePlain(pageId, token, { tokenId, issuedAt, expiresAt } = {}) {
  const r = await ensure();
  await r.setex(kC(pageId), CACHE_TTL_SEC, token);
  const hm = {};
  if (tokenId) hm.tokenId = tokenId;
  if (issuedAt) hm.issuedAt = String(issuedAt);
  if (expiresAt) hm.expiresAt = String(expiresAt);
  if (Object.keys(hm).length) await r.hset(kM(pageId), hm);
}

async function getCachedPlain(pageId) {
  const r = await ensure();
  return r.get(kC(pageId));
}

async function acquireRotateLock(pageId, ttlSec = 180) {
  const r = await ensure();
  const ok = await r.set(kL(pageId), '1', 'EX', ttlSec, 'NX');
  return !!ok;
}

async function releaseRotateLock(pageId) {
  const r = await ensure();
  await r.del(kL(pageId));
}

async function markTokenError(pageId, tokenId, errMsg) {
  const r = await ensure();
  await r.hset(kH(pageId, tokenId), { status: 'error', lastError: errMsg || '' });
  await r.del(kC(pageId));
}

async function markTokenSuccess(pageId, tokenId) {
  const r = await ensure();
  await r.hset(kH(pageId, tokenId), { status: 'active', lastError: '', lastSuccessAt: String(Date.now()) });
}

async function getBestTokenCandidate(pageId) {
  const r = await ensure();
  const primaryId = await r.get(kP(pageId));
  if (primaryId) {
    const h = await r.hgetall(kH(pageId, primaryId));
    if (h && h.status === 'active') return { tokenId: primaryId, meta: h };
  }
  const ids = await r.zrange(kZ(pageId), -20, -1);
  for (let i = ids.length - 1; i >= 0; i--) {
    const tid = ids[i];
    const h = await r.hgetall(kH(pageId, tid));
    if (!h || !h.token_enc) continue;
    if (h.status !== 'active') continue;
    if (h.expiresAt && Number(h.expiresAt) - Date.now() < 5 * 60 * 1000) continue;
    return { tokenId: tid, meta: h };
  }
  return null;
}

async function loadEncryptedById(pageId, tokenId) {
  const r = await ensure();
  const h = await r.hgetall(kH(pageId, tokenId));
  if (!h || !h.token_enc) return null;
  return h;
}

// Lấy tất cả pages có tokens
async function getAllPagesWithTokens() {
  try {
    const r = await ensure();
    
    // Lấy tất cả keys có pattern pts:*
    const keys = await r.keys('pts:*');
    const pages = [];
    
    for (const key of keys) {
      const pageId = key.replace('pts:', '');
      
      // Kiểm tra xem page có tokens không
      const tokenCount = await r.zcard(key);
      if (tokenCount > 0) {
        pages.push(pageId);
      }
    }
    
    return pages;
  } catch (error) {
    console.error('[RedisStore] Error getting pages with tokens:', error.message);
    return [];
  }
}

module.exports = {
  upsertPageTokenEncrypted,
  setCachePlain,
  getCachedPlain,
  acquireRotateLock,
  releaseRotateLock,
  markTokenError,
  markTokenSuccess,
  getBestTokenCandidate,
  loadEncryptedById,
  getAllPagesWithTokens
};
