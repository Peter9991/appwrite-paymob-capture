import axios from 'axios';
import crypto from 'crypto';

const PAYMOB_API_URL = 'https://accept.paymob.com/api';

// SECURITY: Production security configuration
const SECURITY_CONFIG = {
  MAX_REQUEST_SIZE: 512000, // 512KB
  REQUEST_TIMEOUT: 10000, // 10s for capture operations
  MAX_RETRY_ATTEMPTS: 2,
  RATE_LIMIT_WINDOW: 60000,
  MAX_REQUESTS_PER_IP: 5 // Lower for capture operations
};

const rateLimitStore = new Map();

// SECURITY: Configure axios with production security settings
const secureAxios = axios.create({
  timeout: SECURITY_CONFIG.REQUEST_TIMEOUT,
  maxRedirects: 0,
  maxContentLength: SECURITY_CONFIG.MAX_REQUEST_SIZE,
  validateStatus: (status) => status >= 200 && status < 300,
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'HealthyU-Capture/2.0',
    'Accept': 'application/json',
    'Cache-Control': 'no-cache'
  }
});

// SECURITY: Production interceptors
secureAxios.interceptors.request.use(
  (config) => {
    config.headers['X-Request-ID'] = crypto.randomUUID();
    config.headers['X-Request-Time'] = Date.now().toString();
    return config;
  },
  (error) => {
    throw new Error('Capture request configuration failed');
  }
);

secureAxios.interceptors.response.use(
  (response) => {
    if (!response.data || typeof response.data !== 'object') {
      throw new Error('Invalid capture response format');
    }
    return response;
  },
  (error) => {
    const status = error.response?.status;
    if (status === 429) {
      throw new Error('Capture rate limit exceeded');
    } else if (status >= 500) {
      throw new Error('Capture service unavailable');
    } else if (status === 401 || status === 403) {
      throw new Error('Capture authentication failed');
    }
    throw new Error('Capture request failed');
  }
);

// SECURITY: Rate limiting for capture operations
const checkRateLimit = (clientId) => {
  const now = Date.now();
  const windowStart = now - SECURITY_CONFIG.RATE_LIMIT_WINDOW;
  
  if (!rateLimitStore.has(clientId)) {
    rateLimitStore.set(clientId, []);
  }
  
  const requests = rateLimitStore.get(clientId);
  const validRequests = requests.filter(timestamp => timestamp > windowStart);
  
  if (validRequests.length >= SECURITY_CONFIG.MAX_REQUESTS_PER_IP) {
    return false;
  }
  
  validRequests.push(now);
  rateLimitStore.set(clientId, validRequests);
  return true;
};

// SECURITY: Enhanced input validation
const sanitizeInput = (input, maxLength = 100) => {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }
  
  let sanitized = input
    .trim()
    .replace(/[<>"'&\x00-\x1f\x7f-\x9f]/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+=/gi, '')
    .substring(0, maxLength);
    
  if (sanitized.length === 0) {
    throw new Error('Input cannot be empty after sanitization');
  }
  
  return sanitized;
};

const validateTransactionId = (transactionId) => {
  if (typeof transactionId !== 'string') {
    throw new Error('Transaction ID must be a string');
  }
  if (transactionId.length < 5 || transactionId.length > 50) {
    throw new Error('Transaction ID must be 5-50 characters');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(transactionId)) {
    throw new Error('Transaction ID contains invalid characters');
  }
  return sanitizeInput(transactionId, 50);
};

const validateAmount = (amount) => {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error('Amount must be a finite number');
  }
  if (amount <= 0) {
    throw new Error('Amount must be positive');
  }
  if (amount > 99999999) { // Max amount in piasters
    throw new Error('Amount exceeds maximum limit');
  }
  if (!Number.isInteger(amount)) {
    throw new Error('Amount must be an integer (piasters)');
  }
  return amount;
};

const captureTransaction = async (secretKey, transactionId, amountPiasters, log, error) => {
  // PRODUCTION: Minimal logging
  if (!secretKey) {
    throw new Error('Server configuration error: Missing Secret Key.');
  }
  if (!transactionId || !amountPiasters || amountPiasters <= 0) {
    throw new Error('Invalid input for capture: Missing transactionId or invalid amount.');
  }
  try {
    const capturePayload = {
        transaction_id: transactionId.toString(),
        amount_cents: amountPiasters,
    };
    // PRODUCTION: No sensitive data logging
    const response = await secureAxios.post(
      `${PAYMOB_API_URL}/acceptance/capture`, 
      capturePayload,
      {
        headers: { 'Authorization': `Token ${secretKey}` }
      }
    );

    // SECURITY: Validate response structure
    if (!response.data || typeof response.data !== 'object') {
      throw new Error('Invalid capture response format');
    }

    // A successful capture can return 200 OK or 201 Created status
    const isSuccess = response.status === 200 || response.status === 201;

    if (isSuccess) {
        // PRODUCTION: Success without logging sensitive data
        return true;
    } else {
        const failureMsg = response.data?.message || response.data?.detail || 'Capture failed';
        throw new Error(`Paymob Capture Failed: ${failureMsg}`);
    }
  } catch (err) {
    const errMsg = err.response?.data?.detail || err.response?.data?.message || err.message;
    // PRODUCTION: No detailed error logging for security
    throw new Error(`Paymob Capture Request Failed: ${errMsg}`);
  }
};

export default async ({ req, res, log, error }) => {
  const requestId = crypto.randomUUID();
  const startTime = Date.now();
  
  try {
    // SECURITY: Basic request validation
    if (req.method !== 'POST') {
      return res.json({ success: false, error: 'Method not allowed' }, 405);
    }
    
    // SECURITY: Rate limiting
    const clientId = req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown';
    if (!checkRateLimit(clientId)) {
      return res.json({ success: false, error: 'Too many capture requests' }, 429);
    }
    
    // SECURITY: Request size validation
    const bodySize = Buffer.byteLength(JSON.stringify(req.body));
    if (bodySize > SECURITY_CONFIG.MAX_REQUEST_SIZE) {
      return res.json({ success: false, error: 'Request too large' }, 413);
    }
  
  const secretKey = process.env.PAYMOB_SECRET_KEY;
  if (!secretKey) {
    return res.json({ success: false, error: 'Server configuration error.' }, 500);
  }

  let transactionId;
  let amountCents; // Amount in piasters (cents)
  try {
    if(!req.body) throw new Error('Request body is missing.');
    const bodyData = JSON.parse(req.body);
    
    // SECURITY: Validate and sanitize all inputs
    transactionId = validateTransactionId(bodyData.transactionId);
    amountCents = validateAmount(bodyData.amountCents); // Fixed: expect amountCents from frontend
    
    // PRODUCTION: Minimal logging
  } catch (parseError) {
    return res.json({ success: false, error: 'Invalid request body' }, 400);
  }

  try {
    await captureTransaction(secretKey, transactionId, amountCents, log, error);
    return res.json({ success: true, requestId });

  } catch (flowError) {
     return res.json({ success: false, error: 'Capture process failed', requestId }, 500);
  }
  
  } catch (mainError) {
    return res.json({ success: false, error: 'Server error', requestId }, 500);
  }
};
