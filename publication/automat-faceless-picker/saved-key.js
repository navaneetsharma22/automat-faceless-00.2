const STORAGE_KEY = "automat-faceless-vids-picker-key-v1";
const LOCK_NAME = "automat-faceless-vids-picker-key-lock-v1";
const VERSION = 1;
const ITERATIONS = 600_000;
const AAD = new TextEncoder().encode("automat-faceless-picker-key:v1");

export class SavedPickerKeyError extends Error {
  constructor(code) {
    super(code);
    this.name = "SavedPickerKeyError";
    this.code = code;
  }
}

function requireCryptoAndLocks() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new SavedPickerKeyError("secure_crypto_unavailable");
  }
  if (!navigator.locks?.request) {
    throw new SavedPickerKeyError("cross_tab_lock_unavailable");
  }
}

function withExclusiveLock(callback) {
  requireCryptoAndLocks();
  return navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, callback);
}

function encodeBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new SavedPickerKeyError("saved_record_invalid");
  }
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw new SavedPickerKeyError("saved_record_invalid");
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseRecord(raw) {
  if (raw === null) return null;
  let record;
  try {
    record = JSON.parse(raw);
  } catch {
    throw new SavedPickerKeyError("saved_record_invalid");
  }
  if (
    !record ||
    record.version !== VERSION ||
    record.cipher !== "AES-GCM" ||
    record.kdf !== "PBKDF2-SHA-256" ||
    record.iterations !== ITERATIONS ||
    !Number.isInteger(record.failedAttempts) ||
    record.failedAttempts < 0 ||
    record.failedAttempts > 3 ||
    typeof record.recordId !== "string" ||
    !record.recordId ||
    decodeBase64(record.salt).byteLength !== 16 ||
    decodeBase64(record.iv).byteLength !== 12 ||
    decodeBase64(record.ciphertext).byteLength < 17
  ) {
    throw new SavedPickerKeyError("saved_record_invalid");
  }
  return record;
}

function readRecord() {
  try {
    return parseRecord(localStorage.getItem(STORAGE_KEY));
  } catch (error) {
    if (error instanceof SavedPickerKeyError) throw error;
    throw new SavedPickerKeyError("saved_record_unavailable");
  }
}

function writeRecord(record) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  } catch {
    throw new SavedPickerKeyError("saved_record_unavailable");
  }
}

function metadata(record) {
  return {
    exists: Boolean(record),
    locked: Boolean(record && record.failedAttempts >= 3),
    attemptsRemaining: record ? Math.max(0, 3 - record.failedAttempts) : 0,
    recordId: record?.recordId || null,
  };
}

async function deriveAesKey(pin, salt) {
  const pinBytes = new TextEncoder().encode(pin);
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      pinBytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } finally {
    pinBytes.fill(0);
  }
}

async function encryptKey(apiKey, pin, failedAttempts = 0) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(pin, salt);
  const plaintext = new TextEncoder().encode(apiKey);
  try {
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: AAD },
      key,
      plaintext,
    );
    return {
      version: VERSION,
      cipher: "AES-GCM",
      kdf: "PBKDF2-SHA-256",
      iterations: ITERATIONS,
      salt: encodeBase64(salt),
      iv: encodeBase64(iv),
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      failedAttempts,
      recordId: encodeBase64(salt),
    };
  } finally {
    plaintext.fill(0);
    salt.fill(0);
    iv.fill(0);
  }
}

async function decryptKey(record, pin) {
  const salt = decodeBase64(record.salt);
  const iv = decodeBase64(record.iv);
  const ciphertext = decodeBase64(record.ciphertext);
  const key = await deriveAesKey(pin, salt);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: AAD },
      key,
      ciphertext,
    );
    const bytes = new Uint8Array(plaintext);
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } finally {
      bytes.fill(0);
    }
  } finally {
    salt.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
  }
}

async function verifyPin(record, pin) {
  const salt = decodeBase64(record.salt);
  const iv = decodeBase64(record.iv);
  const ciphertext = decodeBase64(record.ciphertext);
  const key = await deriveAesKey(pin, salt);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: AAD },
      key,
      ciphertext,
    );
    new Uint8Array(plaintext).fill(0);
  } finally {
    salt.fill(0);
    iv.fill(0);
    ciphertext.fill(0);
  }
}

function isIncorrectPin(error) {
  return error?.name === "OperationError" || error?.name === "DataError";
}

export const SAVED_PICKER_KEY_STORAGE_KEY = STORAGE_KEY;

export const savedPickerKeyVault = Object.freeze({
  isAvailable() {
    return Boolean(
      globalThis.crypto?.subtle &&
      globalThis.crypto?.getRandomValues &&
      navigator.locks?.request,
    );
  },

  getState() {
    return metadata(readRecord());
  },

  saveNew(apiKey, pin) {
    return withExclusiveLock(async () => {
      if (readRecord()) throw new SavedPickerKeyError("saved_record_exists");
      const record = await encryptKey(apiKey, pin);
      writeRecord(record);
      return metadata(record);
    });
  },

  unlock(pin) {
    return withExclusiveLock(async () => {
      const record = readRecord();
      if (!record) return { status: "missing", state: metadata(null) };
      if (record.failedAttempts >= 3) {
        return { status: "locked", state: metadata(record) };
      }
      try {
        const apiKey = await decryptKey(record, pin);
        const updated = { ...record, failedAttempts: 0 };
        writeRecord(updated);
        return { status: "unlocked", apiKey, state: metadata(updated) };
      } catch (error) {
        if (!isIncorrectPin(error)) throw error;
        const updated = {
          ...record,
          failedAttempts: Math.min(3, record.failedAttempts + 1),
        };
        writeRecord(updated);
        return {
          status: updated.failedAttempts >= 3 ? "locked" : "wrong_pin",
          state: metadata(updated),
        };
      }
    });
  },

  replace(apiKey, currentPin, newPin) {
    return withExclusiveLock(async () => {
      const record = readRecord();
      if (!record) return { status: "missing", state: metadata(null) };
      if (record.failedAttempts >= 3) {
        return { status: "locked", state: metadata(record) };
      }
      try {
        await verifyPin(record, currentPin);
      } catch (error) {
        if (!isIncorrectPin(error)) throw error;
        const updated = {
          ...record,
          failedAttempts: Math.min(3, record.failedAttempts + 1),
        };
        writeRecord(updated);
        return {
          status: updated.failedAttempts >= 3 ? "locked" : "wrong_pin",
          state: metadata(updated),
        };
      }
      writeRecord({ ...record, failedAttempts: 0 });
      const replacement = await encryptKey(apiKey, newPin);
      writeRecord(replacement);
      return { status: "replaced", state: metadata(replacement) };
    });
  },

  forget() {
    const remove = () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        throw new SavedPickerKeyError("saved_record_unavailable");
      }
      return metadata(null);
    };
    if (!navigator.locks?.request) return Promise.resolve(remove());
    return navigator.locks.request(LOCK_NAME, { mode: "exclusive" }, remove);
  },

  withPickerPermit(recordId, callback) {
    if (!navigator.locks?.request) {
      const record = readRecord();
      if (record) throw new SavedPickerKeyError("cross_tab_lock_unavailable");
      return callback(metadata(null));
    }
    return withExclusiveLock(async () => {
      const record = readRecord();
      if (record?.failedAttempts >= 3) {
        throw new SavedPickerKeyError("saved_key_locked");
      }
      if (record && record.recordId !== recordId) {
        throw new SavedPickerKeyError("saved_key_changed");
      }
      if (!record && recordId !== null) {
        throw new SavedPickerKeyError("saved_key_missing");
      }
      return callback(metadata(record));
    });
  },
});
