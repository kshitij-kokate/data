const request = require('supertest');
const app = require('../server');

describe('Rail Statement Simulator', () => {
  describe('POST /simulate/rtgs', () => {
    it('should simulate successful RTGS transaction', async () => {
      const transaction = {
        amount: 100000,
        fromAccount: '1234567890',
        toAccount: '0987654321'
      };

      const response = await request(app)
        .post('/simulate/rtgs')
        .send({ transaction, outcome: 'success' })
        .expect(200);

      expect(response.body.status).toBe('SUCCESS');
      expect(response.body.paymentMethod).toBe('RTGS');
      expect(response.body.amount).toBe(100000);
      expect(response.body.processingFee).toBeGreaterThan(0);
    });

    it('should simulate failed RTGS transaction', async () => {
      const transaction = {
        amount: 100000,
        fromAccount: '1234567890',
        toAccount: '0987654321'
      };

      const response = await request(app)
        .post('/simulate/rtgs')
        .send({ 
          transaction, 
          outcome: 'failure', 
          failureCode: 'INSUFFICIENT_FUNDS' 
        })
        .expect(200);

      expect(response.body.status).toBe('FAILED');
      expect(response.body.failureCode).toBe('INSUFFICIENT_FUNDS');
    });

    it('should return 400 for invalid transaction data', async () => {
      const response = await request(app)
        .post('/simulate/rtgs')
        .send({ transaction: { amount: 1000 } })
        .expect(400);

      expect(response.body.error).toContain('Invalid transaction data');
    });
  });

  describe('POST /simulate/neft', () => {
    it('should simulate successful NEFT transaction', async () => {
      const transaction = {
        amount: 50000,
        fromAccount: '1234567890',
        toAccount: '0987654321'
      };

      const response = await request(app)
        .post('/simulate/neft')
        .send({ transaction, outcome: 'success' })
        .expect(200);

      expect(response.body.status).toBe('SUCCESS');
      expect(response.body.paymentMethod).toBe('NEFT');
    });
  });

  describe('POST /simulate/imps', () => {
    it('should simulate successful IMPS transaction', async () => {
      const transaction = {
        amount: 25000,
        fromAccount: '1234567890',
        toAccount: '0987654321'
      };

      const response = await request(app)
        .post('/simulate/imps')
        .send({ transaction, outcome: 'success' })
        .expect(200);

      expect(response.body.status).toBe('SUCCESS');
      expect(response.body.paymentMethod).toBe('IMPS');
    });
  });

  describe('POST /simulate/upi', () => {
    it('should simulate successful UPI transaction', async () => {
      const transaction = {
        amount: 1000,
        upiId: 'user@paytm'
      };

      const response = await request(app)
        .post('/simulate/upi')
        .send({ transaction, outcome: 'success' })
        .expect(200);

      expect(response.body.status).toBe('SUCCESS');
      expect(response.body.paymentMethod).toBe('UPI');
      expect(response.body.processingFee).toBe(0);
    });

    it('should return 400 for missing upiId', async () => {
      const response = await request(app)
        .post('/simulate/upi')
        .send({ transaction: { amount: 1000 } })
        .expect(400);

      expect(response.body.error).toContain('Invalid transaction data');
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.service).toBe('Rail Statement Simulator');
    });
  });

  describe('GET /failure-codes', () => {
    it('should return available failure codes', async () => {
      const response = await request(app)
        .get('/failure-codes')
        .expect(200);

      expect(response.body.failureCodes).toBeDefined();
      expect(response.body.failureCodes.INSUFFICIENT_FUNDS).toBeDefined();
    });
  });
});
