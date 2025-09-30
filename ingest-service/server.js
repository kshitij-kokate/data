const express = require('express');
const multer = require('multer');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const redis = require('redis');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const client = require('prom-client');

const app = express();
const PORT = process.env.PORT || 3001;

// Prometheus metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Custom metrics
const filesUploaded = new client.Counter({
  name: 'files_uploaded_total',
  help: 'Total number of files uploaded',
  labelNames: ['status']
});

const filesProcessed = new client.Counter({
  name: 'files_processed_total',
  help: 'Total number of files processed',
  labelNames: ['status']
});

const processingDuration = new client.Histogram({
  name: 'file_processing_duration_seconds',
  help: 'Duration of file processing in seconds',
  buckets: [0.1, 0.5, 1, 2, 5, 10]
});

register.registerMetric(filesUploaded);
register.registerMetric(filesProcessed);
register.registerMetric(processingDuration);

// Redis client
let redisClient;
const connectRedis = async () => {
  try {
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://redis:6379'
    });
    await redisClient.connect();
    console.log('Connected to Redis');
  } catch (error) {
    console.error('Redis connection failed:', error);
    process.exit(1);
  }
};

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Ensure data directories exist
const ensureDirectories = () => {
  const dirs = [
    '/app/data',
    '/app/data/processed',
    '/app/data/recon-output',
    '/app/data/evidence'
  ];
  
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

// CSV Schema validation
const validateCSVSchema = (data) => {
  const requiredFields = [
    'transactionId',
    'amount',
    'fromAccount',
    'toAccount',
    'paymentMethod',
    'timestamp'
  ];
  
  if (!data || data.length === 0) {
    return { valid: false, error: 'CSV file is empty' };
  }
  
  const headers = Object.keys(data[0]);
  const missingFields = requiredFields.filter(field => !headers.includes(field));
  
  if (missingFields.length > 0) {
    return { 
      valid: false, 
      error: `Missing required fields: ${missingFields.join(', ')}` 
    };
  }
  
  // Validate data types and values
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    
    // Check required fields are not empty
    for (const field of requiredFields) {
      if (!row[field] || row[field].toString().trim() === '') {
        return { 
          valid: false, 
          error: `Row ${i + 1}: ${field} is required` 
        };
      }
    }
    
    // Validate amount is numeric
    if (isNaN(parseFloat(row.amount)) || parseFloat(row.amount) <= 0) {
      return { 
        valid: false, 
        error: `Row ${i + 1}: amount must be a positive number` 
      };
    }
    
    // Validate payment method
    const validPaymentMethods = ['RTGS', 'NEFT', 'IMPS', 'UPI'];
    if (!validPaymentMethods.includes(row.paymentMethod)) {
      return { 
        valid: false, 
        error: `Row ${i + 1}: paymentMethod must be one of ${validPaymentMethods.join(', ')}` 
      };
    }
  }
  
  return { valid: true };
};

// Calculate file hash
const calculateFileHash = (filePath) => {
  const fileBuffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(fileBuffer).digest('hex');
};

// Check for duplicate files
const checkDuplicate = async (fileHash) => {
  try {
    const result = await redisClient.setNX(`filehash:${fileHash}`, 'processed');
    return result === 1; // 1 means key was set (not duplicate), 0 means key exists (duplicate)
  } catch (error) {
    console.error('Redis error:', error);
    throw new Error('Failed to check for duplicates');
  }
};

// Publish batch created event
const publishBatchCreated = async (batchId, filePath) => {
  try {
    const event = {
      type: 'batch.created',
      batchId,
      filePath,
      timestamp: new Date().toISOString()
    };
    
    await redisClient.publish('arealis:events', JSON.stringify(event));
    console.log('Published batch.created event:', event);
  } catch (error) {
    console.error('Failed to publish event:', error);
  }
};

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, '/tmp/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + '.csv');
  }
});

const upload = multer({ 
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV files are allowed'), false);
    }
  },
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB limit
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Ingest Pipeline',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// File upload endpoint
app.post('/upload', upload.single('file'), async (req, res) => {
  const startTime = Date.now();
  let tempFilePath = null;
  
  try {
    if (!req.file) {
      filesUploaded.inc({ status: 'error' });
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    tempFilePath = req.file.path;
    console.log('Processing file:', req.file.originalname);
    
    // Calculate file hash
    const fileHash = calculateFileHash(tempFilePath);
    console.log('File hash:', fileHash);
    
    // Check for duplicates
    const isNotDuplicate = await checkDuplicate(fileHash);
    if (!isNotDuplicate) {
      filesUploaded.inc({ status: 'duplicate' });
      return res.status(400).json({ 
        error: 'Duplicate file detected',
        hash: fileHash 
      });
    }
    
    // Parse and validate CSV
    const csvContent = fs.readFileSync(tempFilePath, 'utf8');
    const parseResult = Papa.parse(csvContent, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim()
    });
    
    if (parseResult.errors.length > 0) {
      filesUploaded.inc({ status: 'error' });
      return res.status(400).json({ 
        error: 'CSV parsing failed',
        details: parseResult.errors 
      });
    }
    
    // Validate schema
    const validation = validateCSVSchema(parseResult.data);
    if (!validation.valid) {
      filesUploaded.inc({ status: 'error' });
      return res.status(400).json({ 
        error: 'File validation failed',
        details: validation.error 
      });
    }
    
    // Generate batch ID and save file
    const batchId = uuidv4();
    const finalFilePath = `/app/data/processed/${batchId}.csv`;
    
    // Move file to final location
    fs.copyFileSync(tempFilePath, finalFilePath);
    
    // Publish batch created event
    await publishBatchCreated(batchId, finalFilePath);
    
    // Update metrics
    filesUploaded.inc({ status: 'success' });
    filesProcessed.inc({ status: 'success' });
    processingDuration.observe((Date.now() - startTime) / 1000);
    
    res.json({
      success: true,
      batchId,
      filePath: finalFilePath,
      recordCount: parseResult.data.length,
      hash: fileHash,
      message: 'File uploaded and processed successfully'
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    
    filesUploaded.inc({ status: 'error' });
    filesProcessed.inc({ status: 'error' });
    
    res.status(500).json({ 
      error: 'Internal server error',
      details: error.message 
    });
  } finally {
    // Clean up temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
  }
});

// Get batch status endpoint
app.get('/batch/:batchId/status', async (req, res) => {
  try {
    const { batchId } = req.params;
    const filePath = `/app/data/processed/${batchId}.csv`;
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Batch not found' });
    }
    
    const stats = fs.statSync(filePath);
    
    res.json({
      batchId,
      status: 'processed',
      filePath,
      size: stats.size,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime
    });
    
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
  }
  
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Initialize
const startServer = async () => {
  try {
    await connectRedis();
    ensureDirectories();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Ingest Pipeline running on port ${PORT}`);
      console.log(`Available endpoints:`);
      console.log(`  POST /upload`);
      console.log(`  GET /batch/:batchId/status`);
      console.log(`  GET /health`);
      console.log(`  GET /metrics`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
