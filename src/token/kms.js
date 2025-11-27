// kms.js - Key Management Service với AES-256-GCM encryption
const crypto = require('crypto');

// Lấy master key từ environment hoặc tạo mặc định (DEV-ONLY)
const MASTER_KEY = process.env.KMS_MASTER_KEY || 
  crypto.randomBytes(32).toString('base64');

// Log cảnh báo nếu dùng master key tự tạo
if (!process.env.KMS_MASTER_KEY) {
  console.warn('⚠️  [KMS] WARNING: Using auto-generated MASTER_KEY for development only!');
  console.warn('⚠️  [KMS] Set KMS_MASTER_KEY environment variable for production!');
}

// Convert base64 string sang Buffer
function base64ToBuffer(base64String) {
  return Buffer.from(base64String, 'base64');
}

// Convert Buffer sang base64 string
function bufferToBase64(buffer) {
  return buffer.toString('base64');
}

// Tạo data key ngẫu nhiên (32 bytes cho AES-256)
function generateDataKey() {
  return crypto.randomBytes(32);
}

// Wrap data key với master key (simulate KMS)
function wrapDataKey(dataKey) {
  try {
    const masterKeyBuffer = base64ToBuffer(MASTER_KEY);
    
    // Tạo IV cho wrapping
    const wrappedIv = crypto.randomBytes(16);
    
    // Encrypt data key với master key
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKeyBuffer, wrappedIv);
    
    let wrappedKey = cipher.update(dataKey);
    wrappedKey = Buffer.concat([wrappedKey, cipher.final()]);
    
    // Lấy tag từ cipher (không tạo ngẫu nhiên!)
    const wrappedTag = cipher.getAuthTag();
    
    return {
      wrapped_key: bufferToBase64(wrappedKey),
      wrapped_iv: bufferToBase64(wrappedIv),
      wrapped_tag: bufferToBase64(wrappedTag)
    };
  } catch (error) {
    throw new Error(`Failed to wrap data key: ${error.message}`);
  }
}

// Unwrap data key với master key
function unwrapDataKey(wrappedData) {
  try {
    const { wrapped_key, wrapped_iv, wrapped_tag } = wrappedData;
    
    const masterKeyBuffer = base64ToBuffer(MASTER_KEY);
    const wrappedKeyBuffer = base64ToBuffer(wrapped_key);
    const wrappedIvBuffer = base64ToBuffer(wrapped_iv);
    const wrappedTagBuffer = base64ToBuffer(wrapped_tag);
    
    // Decrypt data key
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKeyBuffer, wrappedIvBuffer);
    decipher.setAuthTag(wrappedTagBuffer);
    
    let dataKey = decipher.update(wrappedKeyBuffer);
    dataKey = Buffer.concat([dataKey, decipher.final()]);
    
    return dataKey;
  } catch (error) {
    throw new Error(`Failed to unwrap data key: ${error.message}`);
  }
}

// Encrypt token với data key wrapping
function encryptTokenWithWrapping(plainToken) {
  try {
    // Tạo data key mới cho mỗi lần encrypt
    const dataKey = generateDataKey();
    
    // Wrap data key
    const wrappedData = wrapDataKey(dataKey);
    
    // Encrypt token với data key
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', dataKey, iv);
    
    let encrypted = cipher.update(plainToken, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const tag = cipher.getAuthTag();
    
    return {
      token_enc: bufferToBase64(encrypted),
      iv: bufferToBase64(iv),
      tag: bufferToBase64(tag),
      wrapped_key: wrappedData.wrapped_key,
      wrapped_iv: wrappedData.wrapped_iv,
      wrapped_tag: wrappedData.wrapped_tag
    };
  } catch (error) {
    throw new Error(`Failed to encrypt token: ${error.message}`);
  }
}

// Decrypt token với data key unwrapping
function decryptTokenWithWrapping(encryptedData) {
  try {
    const { token_enc, iv, tag, wrapped_key, wrapped_iv, wrapped_tag } = encryptedData;
    
    // Unwrap data key
    const dataKey = unwrapDataKey({
      wrapped_key,
      wrapped_iv,
      wrapped_tag
    });
    
    // Decrypt token
    const encryptedBuffer = base64ToBuffer(token_enc);
    const ivBuffer = base64ToBuffer(iv);
    const tagBuffer = base64ToBuffer(tag);
    
    const decipher = crypto.createDecipheriv('aes-256-gcm', dataKey, ivBuffer);
    decipher.setAuthTag(tagBuffer);
    
    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    throw new Error(`Failed to decrypt token: ${error.message}`);
  }

}

// Redact token trong log (không bao giờ log token thật)
function redactToken(token, keepLength = 4) {
  if (!token || typeof token !== 'string') {
    return '[INVALID_TOKEN]';
  }
  
  if (token.length <= keepLength * 2) {
    return '[SHORT_TOKEN]';
  }
  
  return `${token.substring(0, keepLength)}...${token.substring(token.length - keepLength)}`;
}

// Validate encrypted data structure
function validateEncryptedData(data) {
  const requiredFields = ['token_enc', 'iv', 'tag', 'wrapped_key', 'wrapped_iv', 'wrapped_tag'];
  
  for (const field of requiredFields) {
    if (!data[field] || typeof data[field] !== 'string') {
      return false;
    }
  }
  
  return true;
}

module.exports = {
  encryptTokenWithWrapping,
  decryptTokenWithWrapping,
  redactToken,
  generateDataKey,
  wrapDataKey,
  unwrapDataKey,
  validateEncryptedData
};
