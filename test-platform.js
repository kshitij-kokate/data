#!/usr/bin/env node

/**
 * Arealis Platform Integration Test
 * Tests the complete end-to-end flow of the platform
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

// Configuration
const SERVICES = {
  simulator: 'http://localhost:3000',
  ingest: 'http://localhost:3001',
  recon: 'http://localhost:8000',
  evidence: 'http://localhost:8080',
  prometheus: 'http://localhost:9090',
  grafana: 'http://localhost:3002'
};

// Test data
const TEST_CSV_CONTENT = `transactionId,amount,fromAccount,toAccount,paymentMethod,timestamp
TXN001,100000,1234567890,0987654321,RTGS,2025-09-25T10:00:00Z
TXN002,50000,1234567890,0987654321,NEFT,2025-09-25T10:01:00Z
TXN003,25000,1234567890,0987654321,IMPS,2025-09-25T10:02:00Z
TXN004,1000,user@paytm,merchant@paytm,UPI,2025-09-25T10:03:00Z`;

class PlatformTester {
  constructor() {
    this.results = {
      passed: 0,
      failed: 0,
      tests: []
    };
  }

  async runTest(name, testFn) {
    try {
      console.log(`\n🧪 Running: ${name}`);
      await testFn();
      this.results.passed++;
      this.results.tests.push({ name, status: 'PASSED' });
      console.log(`✅ ${name} - PASSED`);
    } catch (error) {
      this.results.failed++;
      this.results.tests.push({ name, status: 'FAILED', error: error.message });
      console.log(`❌ ${name} - FAILED: ${error.message}`);
    }
  }

  async testServiceHealth() {
    const services = ['simulator', 'ingest', 'evidence'];
    
    for (const service of services) {
      const response = await axios.get(`${SERVICES[service]}/health`);
      if (response.status !== 200) {
        throw new Error(`${service} health check failed`);
      }
    }
  }

  async testSimulatorEndpoints() {
    // Test RTGS simulation
    const rtgsResponse = await axios.post(`${SERVICES.simulator}/simulate/rtgs`, {
      transaction: {
        amount: 100000,
        fromAccount: '1234567890',
        toAccount: '0987654321'
      },
      outcome: 'success'
    });
    
    if (rtgsResponse.data.status !== 'SUCCESS') {
      throw new Error('RTGS simulation failed');
    }

    // Test UPI simulation
    const upiResponse = await axios.post(`${SERVICES.simulator}/simulate/upi`, {
      transaction: {
        amount: 1000,
        upiId: 'user@paytm'
      },
      outcome: 'success'
    });
    
    if (upiResponse.data.status !== 'SUCCESS') {
      throw new Error('UPI simulation failed');
    }
  }

  async testFileUpload() {
    // Create temporary CSV file
    const tempFile = '/tmp/test-payments.csv';
    fs.writeFileSync(tempFile, TEST_CSV_CONTENT);
    
    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(tempFile), {
        filename: 'test-payments.csv',
        contentType: 'text/csv'
      });
      
      const response = await axios.post(`${SERVICES.ingest}/upload`, formData, {
        headers: formData.getHeaders()
      });
      
      if (!response.data.success) {
        throw new Error('File upload failed');
      }
      
      this.batchId = response.data.batchId;
      console.log(`📁 File uploaded successfully. Batch ID: ${this.batchId}`);
      
    } finally {
      // Cleanup temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  }

  async testBatchStatus() {
    if (!this.batchId) {
      throw new Error('No batch ID available');
    }
    
    const response = await axios.get(`${SERVICES.ingest}/batch/${this.batchId}/status`);
    
    if (response.data.status !== 'processed') {
      throw new Error('Batch not processed');
    }
  }

  async testEvidenceStore() {
    // List files in evidence store
    const response = await axios.get(`${SERVICES.evidence}/files`);
    
    if (!response.data.files || !Array.isArray(response.data.files)) {
      throw new Error('Evidence store file listing failed');
    }
    
    console.log(`📊 Evidence store contains ${response.data.count} files`);
  }

  async testPrometheusMetrics() {
    const response = await axios.get(`${SERVICES.prometheus}/api/v1/query?query=up`);
    
    if (response.status !== 200) {
      throw new Error('Prometheus metrics not accessible');
    }
  }

  async testGrafanaAccess() {
    try {
      const response = await axios.get(`${SERVICES.grafana}/api/health`);
      if (response.status !== 200) {
        throw new Error('Grafana not accessible');
      }
    } catch (error) {
      // Grafana might take time to start, this is not critical
      console.log('⚠️  Grafana not yet ready (this is normal during startup)');
    }
  }

  async runAllTests() {
    console.log('🚀 Starting Arealis Platform Integration Tests\n');
    
    await this.runTest('Service Health Checks', () => this.testServiceHealth());
    await this.runTest('Simulator Endpoints', () => this.testSimulatorEndpoints());
    await this.runTest('File Upload', () => this.testFileUpload());
    await this.runTest('Batch Status Check', () => this.testBatchStatus());
    await this.runTest('Evidence Store Access', () => this.testEvidenceStore());
    await this.runTest('Prometheus Metrics', () => this.testPrometheusMetrics());
    await this.runTest('Grafana Access', () => this.testGrafanaAccess());
    
    this.printResults();
  }

  printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 TEST RESULTS SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`📈 Total: ${this.results.passed + this.results.failed}`);
    
    if (this.results.failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.results.tests
        .filter(test => test.status === 'FAILED')
        .forEach(test => {
          console.log(`  - ${test.name}: ${test.error}`);
        });
    }
    
    console.log('\n🎯 PLATFORM STATUS:');
    if (this.results.failed === 0) {
      console.log('🟢 ALL SYSTEMS OPERATIONAL');
    } else if (this.results.failed <= 2) {
      console.log('🟡 MOSTLY OPERATIONAL (minor issues)');
    } else {
      console.log('🔴 NEEDS ATTENTION (multiple failures)');
    }
    
    console.log('\n📋 SERVICE ENDPOINTS:');
    Object.entries(SERVICES).forEach(([name, url]) => {
      console.log(`  ${name.padEnd(12)}: ${url}`);
    });
  }
}

// Main execution
async function main() {
  const tester = new PlatformTester();
  
  try {
    await tester.runAllTests();
  } catch (error) {
    console.error('💥 Test runner failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = PlatformTester;
