import axios from 'axios';

const PAYMOB_API_URL = 'https://accept.paymob.com/api';

// SECURITY: Configure axios with security settings
const secureAxios = axios.create({
  timeout: 30000, // 30 second timeout
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'HealthyU-Paymob-Capture/1.0'
  }
});

// SECURITY: Add request interceptor for logging
secureAxios.interceptors.request.use(
  (config) => {
    // Log request for security monitoring
    console.log(`[SECURITY] Paymob API Request: ${config.method?.toUpperCase()} ${config.url}`);
    return config;
  },
  (error) => {
    console.error('[SECURITY] Paymob API Request Error:', error);
    return Promise.reject(error);
  }
);

// SECURITY: Add response interceptor for error handling
secureAxios.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    console.error('[SECURITY] Paymob API Response Error:', error.response?.status, error.message);
    return Promise.reject(error);
  }
);

// SECURITY: Input validation and sanitization
const sanitizeInput = (input) => {
  if (typeof input === 'string') {
    return input.trim().replace(/[<>]/g, ''); // Remove potential XSS characters
  }
  return input;
};

const validateTransactionId = (transactionId) => {
  if (typeof transactionId !== 'string' || transactionId.length < 1 || transactionId.length > 100) {
    throw new Error('Invalid transaction ID: must be a string between 1-100 characters');
  }
  return sanitizeInput(transactionId);
};

const validateAmount = (amount) => {
  if (typeof amount !== 'number' || amount <= 0 || amount > 1000000) {
    throw new Error('Invalid amount: must be a positive number less than 1,000,000');
  }
  return amount;
};

const captureTransaction = async (secretKey, transactionId, amountPiasters, log, error) => {
  log(`paymob-capture: Attempting to capture Txn ID: ${transactionId} for Amount: ${amountPiasters}pts`);
  if (!secretKey) {
    error('paymob-capture: Secret Key is missing!');
    throw new Error('Server configuration error: Missing Secret Key.');
  }
  if (!transactionId || !amountPiasters || amountPiasters <= 0) {
    error('paymob-capture: Missing transactionId or invalid amount for capture.');
    throw new Error('Invalid input for capture: Missing transactionId or invalid amount.');
  }
  try {
    const capturePayload = {
        transaction_id: transactionId.toString(),
        amount_cents: amountPiasters,
    };
    log('paymob-capture: Sending capture payload:', JSON.stringify(capturePayload));

    const response = await secureAxios.post(
      `${PAYMOB_API_URL}/acceptance/capture`, 
      capturePayload,
      {
        headers: { 'Authorization': `Token ${secretKey}` }
      }
    );

    log('Paymob capture response data:', response.data);

    // A successful capture returns a 201 Created status
    const isSuccess = response.status === 201;

    if (isSuccess) {
        log(`paymob-capture: Paymob API reported SUCCESS for capture of Txn ID: ${transactionId}`);
        return true;
    } else {
        const failureMsg = response.data?.message || response.data?.detail || JSON.stringify(response.data);
        error(`paymob-capture: Paymob API reported FAILURE for capture of Txn ID ${transactionId}: ${failureMsg}`);
        throw new Error(`Paymob Capture Failed: ${failureMsg}`);
    }
  } catch (err) {
    const errMsg = err.response?.data?.detail || err.response?.data?.message || err.message;
    error(`paymob-capture: Error during capture API call for Txn ID ${transactionId}: ${errMsg}`);
    if (err.response?.data) log('Paymob capture error details:', err.response.data);
    throw new Error(`Paymob Capture Request Failed: ${errMsg}`);
  }
};

export default async ({ req, res, log, error }) => {
  log("--- Executing paymob-capture function ---");
  const secretKey = process.env.PAYMOB_SECRET_KEY;
  if (!secretKey) {
    error('paymob-capture: FATAL: PAYMOB_SECRET_KEY is not set.');
    return res.json({ success: false, error: 'Server configuration error.' }, 500);
  }

  let transactionId;
  let amount; // Amount in EGP
  try {
    if(!req.body) throw new Error('Request body is missing.');
    const bodyData = JSON.parse(req.body);
    
    // SECURITY: Validate and sanitize all inputs
    transactionId = validateTransactionId(bodyData.transactionId);
    amount = validateAmount(bodyData.amount);
    
    log(`paymob-capture: Received capture request: TxnID=${transactionId}, Amount=${amount} EGP`);
  } catch (parseError) {
    error("paymob-capture: Invalid request body: " + parseError.message);
    log("Request Body Received:", req.body);
    return res.json({ success: false, error: `Invalid request body: ${parseError.message}` }, 400);
  }

  const amountPiasters = Math.round(amount * 100);
  log(`paymob-capture: Calculated amount in piasters: ${amountPiasters}`);

  try {
    await captureTransaction(secretKey, transactionId, amountPiasters, log, error);

    log(`paymob-capture: Successfully processed capture for Txn ID: ${transactionId}`);
    return res.json({ success: true });

  } catch (flowError) {
     error(`paymob-capture: Error in capture flow: ${flowError.message}`);
     return res.json({ success: false, error: flowError.message || 'Capture process failed.' }, 500);
  }
};
