/**
 * API Key Encryption Module
 * Provides AES-256-GCM encryption for API keys using Web Crypto API
 */

// API Key Encryption using Web Crypto API
// Derive encryption key from extension ID for unique per-installation encryption
async function getEncryptionKey() {
  try {
    // Get extension ID
    const extensionId = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id)
      ? chrome.runtime.id
      : '';

    // Derive a key from extension ID using PBKDF2
    const encoder = typeof TextEncoder !== 'undefined'
      ? new TextEncoder()
      : require('util').TextEncoder ? new (require('util').TextEncoder)() : null;
    if (!encoder) {
      throw new Error('TextEncoder is not available in this environment');
    }
    const password = encoder.encode(extensionId + 'open-webui-extension-salt');
    const salt = encoder.encode('open-webui-api-key-encryption-salt-v1');

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      password,
      'PBKDF2',
      false,
      ['deriveBits', 'deriveKey']
    );

    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      keyMaterial,
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );

    return key;
  } catch (error) {
    console.error("Extension: Failed to get encryption key:", error);
    throw error;
  }
}

// Encrypt API key
export async function encryptApiKey(apiKey) {
  try {
    if (!apiKey || typeof apiKey !== 'string') {
      throw new Error("Invalid API key for encryption");
    }

    const key = await getEncryptionKey();
    const encoder = new TextEncoder();
    const data = encoder.encode(apiKey);

    // Generate IV for each encryption
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encrypted = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv
      },
      key,
      data
    );

    // Combine IV and encrypted data, then encode as base64
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error("Extension: Encryption failed:", error);
    throw error;
  }
}

// Decrypt API key
export async function decryptApiKey(encryptedApiKey) {
  try {
    if (!encryptedApiKey || typeof encryptedApiKey !== 'string') {
      throw new Error("Invalid encrypted API key");
    }

    // Check if it's already decrypted (backward compatibility)
    // Encrypted keys start with base64 pattern, unencrypted keys typically don't
    // Simple heuristic: if it doesn't look like base64 or is short, assume unencrypted
    if (encryptedApiKey.length < 20 || !/^[A-Za-z0-9+/=]+$/.test(encryptedApiKey)) {
      // Likely unencrypted, return as-is (backward compatibility)
      return encryptedApiKey;
    }

    const key = await getEncryptionKey();

    // Decode base64
    const combined = Uint8Array.from(atob(encryptedApiKey), c => c.charCodeAt(0));

    // Extract IV (first 12 bytes) and encrypted data
    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    try {
      const decrypted = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv
        },
        key,
        encrypted
      );

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (decryptError) {
      // If decryption fails, assume it's an unencrypted key (backward compatibility)
      console.log("Extension: Decryption failed, assuming unencrypted key:", decryptError);
      return encryptedApiKey;
    }
  } catch (error) {
    console.error("Extension: Decryption failed:", error);
    // Return as-is for backward compatibility
    return encryptedApiKey;
  }
}
