const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const client = require('prom-client');

const app = express();
const PORT = process.env.PORT || 8080;

// Prometheus metrics
const register = new client.Registry();
client.collectDefaultMetrics({ register });

// Custom metrics
const filesServed = new client.Counter({
  name: 'files_served_total',
  help: 'Total number of files served',
  labelNames: ['status']
});

const fileAccessDuration = new client.Histogram({
  name: 'file_access_duration_seconds',
  help: 'Duration of file access in seconds',
  buckets: [0.1, 0.5, 1, 2, 5]
});

register.registerMetric(filesServed);
register.registerMetric(fileAccessDuration);

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json());

// Evidence store directory
const EVIDENCE_DIR = '/app/data/evidence';

// Ensure evidence directory exists
const ensureEvidenceDirectory = () => {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
};

// Calculate file hash
const calculateFileHash = (filePath) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(fileBuffer).digest('hex');
  } catch (error) {
    console.error('Error calculating file hash:', error);
    return null;
  }
};

// Get file metadata
const getFileMetadata = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    const hash = calculateFileHash(filePath);
    
    return {
      filename: path.basename(filePath),
      size: stats.size,
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
      hash: hash,
      mimeType: getMimeType(filePath)
    };
  } catch (error) {
    console.error('Error getting file metadata:', error);
    return null;
  }
};

// Get MIME type based on file extension
const getMimeType = (filePath) => {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.csv': 'text/csv',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.pdf': 'application/pdf',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xml': 'application/xml'
  };
  
  return mimeTypes[ext] || 'application/octet-stream';
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Evidence Store',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Metrics endpoint
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// List all evidence files
app.get('/files', (req, res) => {
  try {
    const files = fs.readdirSync(EVIDENCE_DIR);
    const fileList = files.map(filename => {
      const filePath = path.join(EVIDENCE_DIR, filename);
      const metadata = getFileMetadata(filePath);
      return {
        filename,
        url: `http://localhost:${PORT}/${filename}`,
        ...metadata
      };
    });
    
    res.json({
      files: fileList,
      count: fileList.length,
      directory: EVIDENCE_DIR
    });
  } catch (error) {
    console.error('Error listing files:', error);
    res.status(500).json({ error: 'Failed to list files' });
  }
});

// Get specific file
app.get('/:filename', (req, res) => {
  const startTime = Date.now();
  const { filename } = req.params;
  
  try {
    const filePath = path.join(EVIDENCE_DIR, filename);
    
    // Security check - prevent directory traversal
    if (!filePath.startsWith(EVIDENCE_DIR)) {
      filesServed.inc({ status: 'error' });
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      filesServed.inc({ status: 'not_found' });
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Get file metadata
    const metadata = getFileMetadata(filePath);
    
    // Set appropriate headers
    res.set({
      'Content-Type': metadata.mimeType,
      'Content-Length': metadata.size,
      'X-File-Hash': metadata.hash,
      'X-File-Created': metadata.createdAt.toISOString(),
      'X-File-Modified': metadata.modifiedAt.toISOString()
    });
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    // Update metrics
    filesServed.inc({ status: 'success' });
    fileAccessDuration.observe((Date.now() - startTime) / 1000);
    
  } catch (error) {
    console.error('Error serving file:', error);
    filesServed.inc({ status: 'error' });
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// Get file metadata without downloading
app.get('/:filename/metadata', (req, res) => {
  const { filename } = req.params;
  
  try {
    const filePath = path.join(EVIDENCE_DIR, filename);
    
    // Security check
    if (!filePath.startsWith(EVIDENCE_DIR)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Get metadata
    const metadata = getFileMetadata(filePath);
    
    res.json({
      filename,
      url: `http://localhost:${PORT}/${filename}`,
      ...metadata
    });
    
  } catch (error) {
    console.error('Error getting file metadata:', error);
    res.status(500).json({ error: 'Failed to get file metadata' });
  }
});

// Search files by pattern
app.get('/search/:pattern', (req, res) => {
  const { pattern } = req.params;
  
  try {
    const files = fs.readdirSync(EVIDENCE_DIR);
    const matchingFiles = files.filter(filename => 
      filename.toLowerCase().includes(pattern.toLowerCase())
    );
    
    const fileList = matchingFiles.map(filename => {
      const filePath = path.join(EVIDENCE_DIR, filename);
      const metadata = getFileMetadata(filePath);
      return {
        filename,
        url: `http://localhost:${PORT}/${filename}`,
        ...metadata
      };
    });
    
    res.json({
      pattern,
      files: fileList,
      count: fileList.length
    });
    
  } catch (error) {
    console.error('Error searching files:', error);
    res.status(500).json({ error: 'Failed to search files' });
  }
});

// Get storage statistics
app.get('/stats', (req, res) => {
  try {
    const files = fs.readdirSync(EVIDENCE_DIR);
    let totalSize = 0;
    let fileCount = 0;
    
    files.forEach(filename => {
      const filePath = path.join(EVIDENCE_DIR, filename);
      try {
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
        fileCount++;
      } catch (error) {
        console.error(`Error getting stats for ${filename}:`, error);
      }
    });
    
    res.json({
      totalFiles: fileCount,
      totalSize: totalSize,
      totalSizeMB: Math.round(totalSize / (1024 * 1024) * 100) / 100,
      directory: EVIDENCE_DIR,
      lastUpdated: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('Error getting storage stats:', error);
    res.status(500).json({ error: 'Failed to get storage statistics' });
  }
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

// Initialize
const startServer = () => {
  try {
    ensureEvidenceDirectory();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Evidence Store running on port ${PORT}`);
      console.log(`Evidence directory: ${EVIDENCE_DIR}`);
      console.log(`Available endpoints:`);
      console.log(`  GET /files - List all files`);
      console.log(`  GET /:filename - Download file`);
      console.log(`  GET /:filename/metadata - Get file metadata`);
      console.log(`  GET /search/:pattern - Search files`);
      console.log(`  GET /stats - Storage statistics`);
      console.log(`  GET /health - Health check`);
      console.log(`  GET /metrics - Prometheus metrics`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
