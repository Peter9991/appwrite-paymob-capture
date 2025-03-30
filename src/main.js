import axios from 'axios';

const PAYMOB_API_URL = 'https://accept.paymob.com/api';

const getAuthToken = async (apiKey, log, error) => {
  log('paymob-capture: Getting auth token...');
  if (!apiKey) { error('paymob-capture: API Key is missing!'); return null; }
  try {
    const response = await axios.post(`${PAYMOB_API_URL}/auth/tokens`, { api_key: apiKey });
    if (response.data && response.data.token) {
      log('paymob-capture: Got auth token.');
      return response.data.token;
    } else {
      error('paymob-capture: Failed to get auth token.');
      log('Paymob auth response:', response.data); return null;
    }
  } catch (err) {
    const errMsg = err.response?.data?.message || err.message;
    error(`paymob-capture: Error getting auth token: ${errMsg}`);
    if (err.response?.data) log('Paymob auth error details:', err.response.data);
    return null;
  }
};

const captureTransaction = async (authToken, transactionId, amountPiasters, log, error) => {
  log(`paymob-capture: Capturing Txn ID: ${transactionId}, Amount: ${amountPiasters}pts`);
  if (!transactionId || !amountPiasters || amountPiasters <= 0) {
      error('paymob-capture: Missing transactionId or invalid amount for capture.');
      return false;
  }
  try {
    const response = await axios.post(`${PAYMOB_API_URL}/acceptance/capture`, { // <-- CAPTURE endpoint
      auth_token: authToken,
      transaction_id: transactionId, // <-- Use transaction_id here
      amount_cents: amountPiasters,
    });
    // ---> Check Paymob docs for exact success indicators - assuming 2xx is okay for now <---
    if (response.status >= 200 && response.status < 300 && response.data) {
      log(`paymob-capture: Successfully captured Txn ID: ${transactionId}`);
      log('Paymob capture response:', response.data);
      return true; // Indicate success
    } else {
      error(`paymob-capture: Failed capture for Txn ID ${transactionId}: Invalid response status ${response.status}.`);
      log('Paymob capture response:', response.data);
      return false; // Indicate failure
    }
  } catch (err) {
    const errMsg = err.response?.data?.detail || err.response?.data?.message || err.message;
    error(`paymob-capture: Error capturing Txn ID ${transactionId}: ${errMsg}`);
    if (err.response?.data) log('Paymob capture error details:', err.response.data);
    return false; // Indicate failure
  }
};

export default async ({ req, res, log, error }) => {
  log("--- Executing paymob-capture function ---");
  const apiKey = process.env.PAYMOB_API_KEY;
  if (!apiKey) {
    error('paymob-capture: FATAL: Paymob API Key is missing.');
    return res.json({ success: false, error: 'Server configuration error.' }, 500);
  }

  let transactionId;
  let amount; // Amount in EGP
  try {
    if(!req.body) throw new Error('Request body is missing.');
    const bodyData = JSON.parse(req.body);
    transactionId = bodyData.transactionId;
    amount = bodyData.amount;
    if (!transactionId || typeof transactionId !== 'string') {
        throw new Error(`Invalid transactionId received: ${transactionId}`);
    }
    if (typeof amount !== 'number' || amount <= 0) {
      throw new Error(`Invalid amount received: ${amount}`);
    }
    log(`paymob-capture: Received capture request: TxnID=${transactionId}, Amount=${amount} EGP`);
  } catch (parseError) {
    error("paymob-capture: Invalid request body: " + parseError.message);
    log("Request Body Received:", req.body);
    return res.json({ success: false, error: `Invalid request body: ${parseError.message}` }, 400);
  }

  const amountPiasters = Math.round(amount * 100);

  try {
    const authToken = await getAuthToken(apiKey, log, error);
    if (!authToken) throw new Error('Paymob authentication failed.');

    const captureSuccess = await captureTransaction(authToken, transactionId, amountPiasters, log, error);
    if (!captureSuccess) throw new Error('Paymob capture API call failed.');

    log(`paymob-capture: Successfully processed capture for Txn ID: ${transactionId}`);
    return res.json({ success: true }); // Report success back to the caller

  } catch (flowError) {
     error(`paymob-capture: Error in capture flow: ${flowError.message}`);
     return res.json({ success: false, error: flowError.message || 'Capture process failed.' }, 500);
  }
};
