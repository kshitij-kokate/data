import pytest
import pandas as pd
import json
import tempfile
import os
from recon_engine import ReconciliationEngine

class TestReconciliationEngine:
    
    def setup_method(self):
        """Setup test environment"""
        self.engine = ReconciliationEngine()
        self.temp_dir = tempfile.mkdtemp()
        self.engine.data_dir = self.temp_dir
        self.engine.processed_dir = f'{self.temp_dir}/processed'
        self.engine.recon_output_dir = f'{self.temp_dir}/recon-output'
        
        # Create directories
        os.makedirs(self.engine.processed_dir, exist_ok=True)
        os.makedirs(self.engine.recon_output_dir, exist_ok=True)
    
    def teardown_method(self):
        """Cleanup test environment"""
        import shutil
        shutil.rmtree(self.temp_dir)
    
    def test_clean_and_normalize_data(self):
        """Test data cleaning and normalization"""
        # Create test data with some issues
        data = {
            'transactionId': ['TXN001', 'TXN002', 'TXN003'],
            'amount': ['1000.50', '2000', 'invalid'],
            'fromAccount': [' 1234567890 ', '0987654321', '1111111111'],
            'toAccount': ['0987654321', ' 1234567890 ', '2222222222'],
            'paymentMethod': ['rtgs', 'NEFT', 'IMPS'],
            'timestamp': ['2025-09-25T10:00:00Z', '2025-09-25T10:01:00Z', '2025-09-25T10:02:00Z']
        }
        
        df = pd.DataFrame(data)
        cleaned_df = self.engine.clean_and_normalize_data(df, 'test')
        
        # Check that invalid amount was removed
        assert len(cleaned_df) == 2
        
        # Check that amounts are numeric
        assert pd.api.types.is_numeric_dtype(cleaned_df['amount'])
        
        # Check that account numbers are cleaned
        assert cleaned_df['fromAccount'].iloc[0] == '1234567890'
        
        # Check that payment methods are normalized
        assert cleaned_df['paymentMethod'].iloc[0] == 'RTGS'
    
    def test_exact_match(self):
        """Test exact matching logic"""
        payments = pd.DataFrame({
            'transactionId': ['PAY001', 'PAY002'],
            'amount': [1000, 2000],
            'fromAccount': ['1234567890', '0987654321'],
            'toAccount': ['0987654321', '1234567890'],
            'paymentMethod': ['RTGS', 'NEFT']
        })
        
        statements = pd.DataFrame({
            'transactionId': ['STMT001', 'STMT002'],
            'amount': [1000, 2000],
            'fromAccount': ['1234567890', '0987654321'],
            'toAccount': ['0987654321', '1234567890'],
            'paymentMethod': ['RTGS', 'NEFT']
        })
        
        matched_payments, matched_statements = self.engine.exact_match(payments, statements)
        
        assert len(matched_payments) == 2
        assert len(matched_statements) == 2
        assert matched_payments['transactionId'].tolist() == ['PAY001', 'PAY002']
    
    def test_fuzzy_match(self):
        """Test fuzzy matching logic"""
        payments = pd.DataFrame({
            'transactionId': ['PAY001'],
            'amount': [1000],
            'fromAccount': ['1234567890'],
            'toAccount': ['0987654321'],
            'paymentMethod': ['RTGS']
        })
        
        statements = pd.DataFrame({
            'transactionId': ['STMT001'],
            'amount': [1005],  # 0.5% difference
            'fromAccount': ['1234567890'],
            'toAccount': ['0987654321'],
            'paymentMethod': ['RTGS']
        })
        
        matched_payments, matched_statements = self.engine.fuzzy_match(payments, statements)
        
        assert len(matched_payments) == 1
        assert len(matched_statements) == 1
    
    def test_classify_exceptions(self):
        """Test exception classification"""
        unmatched = pd.DataFrame({
            'transactionId': ['PAY001', 'PAY002'],
            'amount': [150000, 500],  # High value and normal
            'fromAccount': ['1234567890', '0987654321'],
            'toAccount': ['0987654321', '1234567890'],
            'paymentMethod': ['RTGS', 'UPI'],
            'timestamp': ['2025-09-25T10:00:00Z', '2025-09-25T10:01:00Z']
        })
        
        exceptions = self.engine.classify_exceptions(unmatched)
        
        assert len(exceptions) == 2
        assert exceptions['exceptionType'].iloc[0] == 'HIGH_VALUE_UNMATCHED'
        assert exceptions['exceptionType'].iloc[1] == 'UPI_UNMATCHED'
    
    def test_generate_recon_output(self):
        """Test reconciliation output generation"""
        exact_matches = pd.DataFrame({
            'transactionId': ['PAY001'],
            'amount': [1000],
            'fromAccount': ['1234567890'],
            'toAccount': ['0987654321'],
            'paymentMethod': ['RTGS']
        })
        
        fuzzy_matches = pd.DataFrame({
            'transactionId': ['PAY002'],
            'amount': [2000],
            'fromAccount': ['0987654321'],
            'toAccount': ['1234567890'],
            'paymentMethod': ['NEFT']
        })
        
        exceptions = pd.DataFrame({
            'transactionId': ['PAY003'],
            'amount': [3000],
            'fromAccount': ['1111111111'],
            'toAccount': ['2222222222'],
            'paymentMethod': ['IMPS'],
            'exceptionType': ['GENERAL_UNMATCHED']
        })
        
        output = self.engine.generate_recon_output(exact_matches, fuzzy_matches, exceptions, 'BATCH001')
        
        assert output['batchId'] == 'BATCH001'
        assert output['summary']['totalPayments'] == 3
        assert output['summary']['matchedCount'] == 2
        assert output['summary']['unmatchedCount'] == 1
        assert output['summary']['exactMatches'] == 1
        assert output['summary']['fuzzyMatches'] == 1
        assert len(output['matched']) == 2
        assert len(output['exceptions']) == 1
    
    def test_save_recon_output(self):
        """Test saving reconciliation output"""
        output = {
            'batchId': 'TEST001',
            'summary': {'totalPayments': 1},
            'matched': [],
            'exceptions': []
        }
        
        output_file = self.engine.save_recon_output(output, 'TEST001')
        
        assert os.path.exists(output_file)
        
        # Verify content
        with open(output_file, 'r') as f:
            saved_output = json.load(f)
        
        assert saved_output['batchId'] == 'TEST001'
