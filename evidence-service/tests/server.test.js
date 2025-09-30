const request = require('supertest');
const fs = require('fs');
const path = require('path');
const app = require('../server');

describe('Evidence Store', () => {
  const testDir = '/tmp/test-evidence';
  
  beforeAll(() => {
    // Create test directory
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    // Create test files
    fs.writeFileSync(path.join(testDir, 'test1.csv'), 'col1,col2\nval1,val2');
    fs.writeFileSync(path.join(testDir, 'test2.json'), '{"key": "value"}');
  });
  
  afterAll(() => {
    // Cleanup test directory
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });
  
  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('Evidence Store');
    });
  });

  describe('GET /metrics', () => {
    it('should return Prometheus metrics', async () => {
      const response = await request(app)
        .get('/metrics')
        .expect(200);

      expect(response.text).toContain('files_served_total');
      expect(response.text).toContain('file_access_duration_seconds');
    });
  });

  describe('GET /files', () => {
    it('should list all files', async () => {
      const response = await request(app)
        .get('/files')
        .expect(200);

      expect(response.body.files).toBeDefined();
      expect(Array.isArray(response.body.files)).toBe(true);
      expect(response.body.count).toBeDefined();
    });
  });

  describe('GET /stats', () => {
    it('should return storage statistics', async () => {
      const response = await request(app)
        .get('/stats')
        .expect(200);

      expect(response.body.totalFiles).toBeDefined();
      expect(response.body.totalSize).toBeDefined();
      expect(response.body.totalSizeMB).toBeDefined();
    });
  });

  describe('GET /search/:pattern', () => {
    it('should search files by pattern', async () => {
      const response = await request(app)
        .get('/search/csv')
        .expect(200);

      expect(response.body.pattern).toBe('csv');
      expect(response.body.files).toBeDefined();
      expect(Array.isArray(response.body.files)).toBe(true);
    });
  });

  describe('GET /:filename', () => {
    it('should return 404 for non-existent file', async () => {
      const response = await request(app)
        .get('/nonexistent.csv')
        .expect(404);

      expect(response.body.error).toBe('File not found');
    });
  });

  describe('GET /:filename/metadata', () => {
    it('should return 404 for non-existent file metadata', async () => {
      const response = await request(app)
        .get('/nonexistent.csv/metadata')
        .expect(404);

      expect(response.body.error).toBe('File not found');
    });
  });
});
