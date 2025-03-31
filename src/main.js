import axios from 'axios';

const PAYMOB_API_URL = 'https://accept.paymob.com/api';

const getAuthToken = async (apiKey, log, error) => {
  log('paymob-capture: Getting auth token...');
  if (!apiKey) {
      error('paymob-capture: API Key is missing!');
      throw new Error('Server configuration error: Missing API Key.');
  }
  try {
    const response = await axios.post(`${PAYMOB_API_URL}/auth/tokens`, { api_key: apiKey });
    if (response.data && response.data.token) {
      log('paymob-capture: Got auth token.');
      return response.data.token;
    } else {
      const errMsg = response.data ? JSON.stringify(response.data) : 'Invalid auth response';
      error(`paymob-capture: Failed to get auth token: ${errMsg}`);
      log('Paymob auth response:', response.data);
      throw new Error(`Paymob Auth Failed: ${errMsg}`);
    }
  } catch (err) {
    const errMsg = err.response?.data?.message || err.response?.data?.detail || err.message;
    error(`paymob-capture: Error getting auth token: ${errMsg}`);
    if (err.response?.data) log('Paymob auth error details:', err.response.data);
    throw new Error(`Paymob Auth Request Failed: ${errMsg}`);
  }
};

const captureTransaction = async (authToken, transactionId, amountPiasters, log, error) => {
  log(`paymob-capture: Capturing Txn ID: ${transactionId}, Amount: ${amountPiasters}pts`);
  if (!transactionId || !amountPiasters || amountPiasters <= 0) {
    error('paymob-capture: Missing transactionId or invalid amount for capture.');
    throw new Error('Invalid input for capture: Missing transactionId or invalid amount.');
  }
  try {
    const response = await axios.post(`${PAYMOB_API_URL}/acceptance/capture`, {
      auth_token: authToken,
      transaction_id: transactionId,
      amount_cents: amountPiasters,
    });

    log('Paymob capture response data:', response.data);

    const isSuccess = response.status >= 200 && response.status < 300;

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
  const apiKey = process.env.PAYMOB_API_KEY;

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
    const captureSuccess = await captureTransaction(authToken, transactionId, amountPiasters, log, error);

    log(`paymob-capture: Successfully processed capture for Txn ID: ${transactionId}`);
    return res.json({ success: true });

  } catch (flowError) {
     error(`paymob-capture: Error in capture flow: ${flowError.message}`);
     return res.json({ success: false, error: flowError.message || 'Capture process failed.' }, 500);
  }
};
