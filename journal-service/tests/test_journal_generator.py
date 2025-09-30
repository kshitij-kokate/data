import pytest
import json
import tempfile
import os
from journal_generator import JournalGenerator

class TestJournalGenerator:
    
    def setup_method(self):
        """Setup test environment"""
        self.generator = JournalGenerator()
        self.temp_dir = tempfile.mkdtemp()
        self.generator.data_dir = self.temp_dir
        self.generator.evidence_dir = f'{self.temp_dir}/evidence'
        
        # Create directories
        os.makedirs(self.generator.evidence_dir, exist_ok=True)
    
    def teardown_method(self):
        """Cleanup test environment"""
        import shutil
        shutil.rmtree(self.temp_dir)
    
    def test_generate_tally_csv(self):
        """Test Tally CSV generation"""
        # Sample reconciliation data
        recon_data = {
            'batchId': 'TEST001',
            'summary': {
                'totalPayments': 2,
                'matchedCount': 1,
                'unmatchedCount': 1
            },
            'matched': [
                {
                    'paymentId': 'PAY001',
                    'statementId': 'STMT001',
                    'amount': 1000,
                    'matchType': 'EXACT',
                    'confidence': 1.0,
                    'paymentData': {
                        'transactionId': 'PAY001',
                        'amount': 1000,
                        'fromAccount': '1234567890',
                        'toAccount': '0987654321',
                        'paymentMethod': 'RTGS',
                        'timestamp': '2025-09-25T10:00:00Z'
                    },
                    'statementData': {
                        'transactionId': 'STMT001',
                        'referenceNumber': 'REF001'
                    }
                }
            ],
            'exceptions': [
                {
                    'transactionId': 'PAY002',
                    'amount': 2000,
                    'fromAccount': '1111111111',
                    'toAccount': '2222222222',
                    'paymentMethod': 'NEFT',
                    'timestamp': '2025-09-25T10:01:00Z',
                    'exceptionType': 'GENERAL_UNMATCHED',
                    'exceptionReason': 'Transaction not matched'
                }
            ]
        }
        
        csv_content = self.generator.generate_tally_csv(recon_data)
        
        # Check that CSV content is generated
        assert csv_content is not None
        assert len(csv_content) > 0
        
        # Check for Tally header
        assert 'Voucher Type Name' in csv_content
        assert 'Date' in csv_content
        assert 'Debit' in csv_content
        assert 'Credit' in csv_content
        
        # Check for payment entries
        assert 'PAY001' in csv_content
        assert '1000' in csv_content
        
        # Check for exception entries
        assert 'PAY002' in csv_content
        assert 'Suspense Account' in csv_content
    
    def test_save_journal_file(self):
        """Test saving journal file"""
        csv_content = "Voucher Type Name,Date,Debit,Credit\nPayment,25-09-2025,1000,0"
        
        file_path = self.generator.save_journal_file(csv_content, 'TEST001')
        
        # Check that file was created
        assert os.path.exists(file_path)
        
        # Check file content
        with open(file_path, 'r') as f:
            content = f.read()
        
        assert content == csv_content
        assert 'TEST001' in file_path
    
    def test_calculate_file_hash(self):
        """Test file hash calculation"""
        # Create a test file
        test_file = os.path.join(self.temp_dir, 'test.txt')
        with open(test_file, 'w') as f:
            f.write('test content')
        
        # Calculate hash
        file_hash = self.generator.calculate_file_hash(test_file)
        
        # Check that hash is calculated
        assert file_hash is not None
        assert len(file_hash) == 64  # SHA256 hash length
    
    def test_process_recon_data(self):
        """Test complete journal generation process"""
        # Create sample recon data file
        recon_data = {
            'batchId': 'TEST001',
            'summary': {
                'totalPayments': 1,
                'matchedCount': 1,
                'unmatchedCount': 0
            },
            'matched': [
                {
                    'paymentId': 'PAY001',
                    'statementId': 'STMT001',
                    'amount': 1000,
                    'matchType': 'EXACT',
                    'confidence': 1.0,
                    'paymentData': {
                        'transactionId': 'PAY001',
                        'amount': 1000,
                        'fromAccount': '1234567890',
                        'toAccount': '0987654321',
                        'paymentMethod': 'RTGS',
                        'timestamp': '2025-09-25T10:00:00Z'
                    },
                    'statementData': {
                        'transactionId': 'STMT001',
                        'referenceNumber': 'REF001'
                    }
                }
            ],
            'exceptions': []
        }
        
        recon_file = os.path.join(self.temp_dir, 'recon.json')
        with open(recon_file, 'w') as f:
            json.dump(recon_data, f)
        
        # Process the data
        self.generator.process_recon_data('TEST001', recon_file)
        
        # Check that journal file was created
        evidence_files = os.listdir(self.generator.evidence_dir)
        assert len(evidence_files) > 0
        
        # Check that file contains expected content
        journal_file = os.path.join(self.generator.evidence_dir, evidence_files[0])
        with open(journal_file, 'r') as f:
            content = f.read()
        
        assert 'PAY001' in content
        assert '1000' in content
