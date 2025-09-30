const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Predefined failure reason codes
const FAILURE_CODES = {
  'INSUFFICIENT_FUNDS': 'Insufficient funds in account',
  'INVALID_ACCOUNT': 'Invalid account number',
  'NETWORK_ERROR': 'Network connectivity issue',
  'BANK_MAINTENANCE': 'Bank system under maintenance',
  'DAILY_LIMIT_EXCEEDED': 'Daily transaction limit exceeded',
  'INVALID_UPI_ID': 'Invalid UPI ID',
  'BENEFICIARY_NOT_FOUND': 'Beneficiary account not found',
  'TECHNICAL_ERROR': 'Technical error in processing'
};

// Generate realistic bank statement line item
function generateStatementItem(transaction, outcome, failureCode = null) {
  const timestamp = new Date().toISOString();
  const transactionId = uuidv4();
  
  if (outcome === 'failure') {
    return {
      transactionId,
      timestamp,
      status: 'FAILED',
      amount: transaction.amount,
      fromAccount: transaction.fromAccount,
      toAccount: transaction.toAccount,
      paymentMethod: transaction.paymentMethod,
      failureCode: failureCode || 'TECHNICAL_ERROR',
      failureReason: FAILURE_CODES[failureCode] || 'Transaction failed',
      referenceNumber: `FAIL-${transactionId.substring(0, 8).toUpperCase()}`,
      processingFee: 0,
      netAmount: 0
    };
  }
  
  // Success case
  const processingFee = calculateProcessingFee(transaction.amount, transaction.paymentMethod);
  const netAmount = transaction.amount - processingFee;
  
  return {
    transactionId,
    timestamp,
    status: 'SUCCESS',
    amount: transaction.amount,
    fromAccount: transaction.fromAccount,
    toAccount: transaction.toAccount,
    paymentMethod: transaction.paymentMethod,
    referenceNumber: `TXN-${transactionId.substring(0, 8).toUpperCase()}`,
    processingFee,
    netAmount,
    bankReference: `BANK-${Date.now()}`,
    utr: generateUTR(transaction.paymentMethod)
  };
}

function calculateProcessingFee(amount, paymentMethod) {
  const feeStructure = {
    'RTGS': Math.max(25, amount * 0.0001), // Min ₹25, 0.01% of amount
    'NEFT': Math.max(2.5, amount * 0.0001), // Min ₹2.5, 0.01% of amount
    'IMPS': Math.max(5, amount * 0.0005),   // Min ₹5, 0.05% of amount
    'UPI': 0 // UPI is typically free
  };
  
  return Math.round(feeStructure[paymentMethod] * 100) / 100;
}

function generateUTR(paymentMethod) {
  const prefixes = {
    'RTGS': 'RTGS',
    'NEFT': 'NEFT',
    'IMPS': 'IMPS',
    'UPI': 'UPI'
  };
  
  const prefix = prefixes[paymentMethod] || 'TXN';
  const random = Math.random().toString(36).substring(2, 15).toUpperCase();
  return `${prefix}${Date.now()}${random}`;
}

// API Endpoints
app.post('/simulate/rtgs', (req, res) => {
  try {
    const { transaction, outcome, failureCode } = req.body;
    
    if (!transaction || !transaction.amount || !transaction.fromAccount || !transaction.toAccount) {
      return res.status(400).json({
        error: 'Invalid transaction data. Required fields: amount, fromAccount, toAccount'
      });
    }
    
    transaction.paymentMethod = 'RTGS';
    const statementItem = generateStatementItem(transaction, outcome, failureCode);
    
    res.json(statementItem);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/simulate/neft', (req, res) => {
  try {
    const { transaction, outcome, failureCode } = req.body;
    
    if (!transaction || !transaction.amount || !transaction.fromAccount || !transaction.toAccount) {
      return res.status(400).json({
        error: 'Invalid transaction data. Required fields: amount, fromAccount, toAccount'
      });
    }
    
    transaction.paymentMethod = 'NEFT';
    const statementItem = generateStatementItem(transaction, outcome, failureCode);
    
    res.json(statementItem);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/simulate/imps', (req, res) => {
  try {
    const { transaction, outcome, failureCode } = req.body;
    
    if (!transaction || !transaction.amount || !transaction.fromAccount || !transaction.toAccount) {
      return res.status(400).json({
        error: 'Invalid transaction data. Required fields: amount, fromAccount, toAccount'
      });
    }
    
    transaction.paymentMethod = 'IMPS';
    const statementItem = generateStatementItem(transaction, outcome, failureCode);
    
    res.json(statementItem);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/simulate/upi', (req, res) => {
  try {
    const { transaction, outcome, failureCode } = req.body;
    
    if (!transaction || !transaction.amount || !transaction.upiId) {
      return res.status(400).json({
        error: 'Invalid transaction data. Required fields: amount, upiId'
      });
    }
    
    transaction.paymentMethod = 'UPI';
    transaction.fromAccount = transaction.upiId;
    transaction.toAccount = transaction.upiId; // For UPI, both are same
    const statementItem = generateStatementItem(transaction, outcome, failureCode);
    
    res.json(statementItem);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Rail Statement Simulator',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Get available failure codes
app.get('/failure-codes', (req, res) => {
  res.json({
    failureCodes: FAILURE_CODES
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Rail Statement Simulator running on port ${PORT}`);
  console.log(`Available endpoints:`);
  console.log(`  POST /simulate/rtgs`);
  console.log(`  POST /simulate/neft`);
  console.log(`  POST /simulate/imps`);
  console.log(`  POST /simulate/upi`);
  console.log(`  GET /health`);
  console.log(`  GET /failure-codes`);
});

module.exports = app;
