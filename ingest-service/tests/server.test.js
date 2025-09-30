const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../server');

describe('Ingest Pipeline', () => {
  const testCSVContent = `transactionId,amount,fromAccount,toAccount,paymentMethod,timestamp
TXN001,1000,1234567890,0987654321,RTGS,2025-09-25T10:00:00Z
TXN002,2000,1234567890,0987654321,NEFT,2025-09-25T10:01:00Z`;

  const invalidCSVContent = `transactionId,amount,fromAccount,toAccount
TXN001,1000,1234567890,0987654321`;

  beforeEach(() => {
    // Create a temporary CSV file for testing
    const tempDir = '/tmp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
  });

  afterEach(() => {
    // Clean up test files
    const tempDir = '/tmp';
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      files.forEach(file => {
        if (file.startsWith('file-') && file.endsWith('.csv')) {
          fs.unlinkSync(path.join(tempDir, file));
        }
      });
    }
  });

  describe('POST /upload', () => {
    it('should upload and process valid CSV file', async () => {
      const response = await request(app)
        .post('/upload')
        .attach('file', Buffer.from(testCSVContent), {
          filename: 'test.csv',
          contentType: 'text/csv'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.batchId).toBeDefined();
      expect(response.body.recordCount).toBe(2);
      expect(response.body.hash).toBeDefined();
    });

    it('should reject invalid CSV format', async () => {
      const response = await request(app)
        .post('/upload')
        .attach('file', Buffer.from(invalidCSVContent), {
          filename: 'invalid.csv',
          contentType: 'text/csv'
        })
        .expect(400);

      expect(response.body.error).toContain('File validation failed');
    });

    it('should reject non-CSV files', async () => {
      const response = await request(app)
        .post('/upload')
        .attach('file', Buffer.from('not a csv'), {
          filename: 'test.txt',
          contentType: 'text/plain'
        })
        .expect(400);

      expect(response.body.error).toContain('Only CSV files are allowed');
    });

    it('should reject files without required fields', async () => {
      const incompleteCSV = `transactionId,amount
TXN001,1000`;

      const response = await request(app)
        .post('/upload')
        .attach('file', Buffer.from(incompleteCSV), {
          filename: 'incomplete.csv',
          contentType: 'text/csv'
        })
        .expect(400);

      expect(response.body.error).toContain('File validation failed');
    });

    it('should reject empty files', async () => {
      const response = await request(app)
        .post('/upload')
        .attach('file', Buffer.from(''), {
          filename: 'empty.csv',
          contentType: 'text/csv'
        })
        .expect(400);

      expect(response.body.error).toContain('File validation failed');
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('Ingest Pipeline');
    });
  });

  describe('GET /metrics', () => {
    it('should return Prometheus metrics', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('files_uploaded_total');
      expect(response.text).toContain('files_processed_total');
    });
  });
});
