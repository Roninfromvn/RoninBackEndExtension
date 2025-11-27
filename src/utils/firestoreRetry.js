// src/utils/firestoreRetry.js - Firestore operations with retry mechanism
const { logger } = require('./logger');

/**
 * Firestore error codes that should trigger retry
 */
const RETRYABLE_ERROR_CODES = [
  'unavailable',
  'deadline-exceeded', 
  'resource-exhausted',
  'aborted',
  'internal',
  'unauthenticated'
];

/**
 * Check if error is retryable
 */
function isRetryableError(error) {
  // Firestore specific error codes
  if (error.code && RETRYABLE_ERROR_CODES.includes(error.code)) {
    return true;
  }
  
  // Network errors
  if (error.message && (
    error.message.includes('network') ||
    error.message.includes('timeout') ||
    error.message.includes('connection') ||
    error.message.includes('ECONNRESET') ||
    error.message.includes('ENOTFOUND')
  )) {
    return true;
  }
  
  // HTTP 5xx errors
  if (error.status && String(error.status).startsWith('5')) {
    return true;
  }
  
  return false;
}

/**
 * Retry wrapper for Firestore operations
 */
async function withFirestoreRetry(operation, options = {}) {
  const {
    maxRetries = 3,
    baseDelay = 1000,
    operationName = 'firestore_operation',
    context = {}
  } = options;
  
  let lastError;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      
      // Log success on retry
      if (attempt > 1) {
        logger.info('firestore_retry_success', {
          operationName,
          attempt,
          context
        });
      }
      
      return result;
      
    } catch (error) {
      lastError = error;
      
      const isRetryable = isRetryableError(error);
      const isLastAttempt = attempt === maxRetries;
      
      logger.warn('firestore_operation_failed', {
        operationName,
        attempt,
        maxRetries,
        error: error.message,
        errorCode: error.code,
        isRetryable,
        context
      });
      
      // Don't retry if error is not retryable or this is the last attempt
      if (!isRetryable || isLastAttempt) {
        logger.error('firestore_operation_failed_permanent', {
          operationName,
          finalAttempt: attempt,
          error: error.message,
          errorCode: error.code,
          context
        });
        throw error;
      }
      
      // Calculate delay with exponential backoff
      const delay = baseDelay * Math.pow(2, attempt - 1);
      
      logger.info('firestore_retry_scheduled', {
        operationName,
        attempt,
        nextAttempt: attempt + 1,
        delay,
        context
      });
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}

/**
 * Wrapper for Firestore document set operations
 */
async function firestoreSet(docRef, data, options = {}) {
  const { merge = false, context = {} } = options;
  
  return await withFirestoreRetry(
    () => docRef.set(data, { merge }),
    {
      operationName: 'firestore_set',
      context: {
        ...context,
        merge,
        docPath: docRef.path
      }
    }
  );
}

/**
 * Wrapper for Firestore document add operations
 */
async function firestoreAdd(collectionRef, data, context = {}) {
  return await withFirestoreRetry(
    () => collectionRef.add(data),
    {
      operationName: 'firestore_add',
      context: {
        ...context,
        collectionPath: collectionRef.path
      }
    }
  );
}

/**
 * Wrapper for Firestore document update operations
 */
async function firestoreUpdate(docRef, data, context = {}) {
  return await withFirestoreRetry(
    () => docRef.update(data),
    {
      operationName: 'firestore_update',
      context: {
        ...context,
        docPath: docRef.path
      }
    }
  );
}

/**
 * Wrapper for Firestore document delete operations
 */
async function firestoreDelete(docRef, context = {}) {
  return await withFirestoreRetry(
    () => docRef.delete(),
    {
      operationName: 'firestore_delete',
      context: {
        ...context,
        docPath: docRef.path
      }
    }
  );
}

/**
 * Wrapper for Firestore batch operations
 */
async function firestoreBatch(batch, context = {}) {
  return await withFirestoreRetry(
    () => batch.commit(),
    {
      operationName: 'firestore_batch',
      context: {
        ...context,
        batchSize: batch._mutations.length
      }
    }
  );
}

/**
 * Wrapper for Firestore transaction operations
 */
async function firestoreTransaction(transactionFn, context = {}) {
  return await withFirestoreRetry(
    () => firestore.runTransaction(transactionFn),
    {
      operationName: 'firestore_transaction',
      context
    }
  );
}

module.exports = {
  withFirestoreRetry,
  firestoreSet,
  firestoreAdd,
  firestoreUpdate,
  firestoreDelete,
  firestoreBatch,
  firestoreTransaction,
  isRetryableError
};
