import pandas as pd
import redis
import json
import os
import time
import logging
from datetime import datetime
from typing import Dict, List, Tuple, Any
from prometheus_client import Counter, Histogram, Gauge, start_http_server
import uuid

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Prometheus metrics
recon_jobs_total = Counter('recon_jobs_total', 'Total reconciliation jobs', ['status'])
recon_duration = Histogram('recon_duration_seconds', 'Reconciliation duration in seconds')
auto_match_percentage = Gauge('auto_match_percentage', 'Percentage of auto-matched transactions')
matched_transactions = Counter('matched_transactions_total', 'Total matched transactions', ['match_type'])

class ReconciliationEngine:
    def __init__(self, redis_url: str = None):
        self.redis_url = redis_url or os.getenv('REDIS_URL', 'redis://redis:6379')
        self.redis_client = None
        self.data_dir = '/app/data'
        self.processed_dir = f'{self.data_dir}/processed'
        self.recon_output_dir = f'{self.data_dir}/recon-output'
        
        # Ensure directories exist
        os.makedirs(self.recon_output_dir, exist_ok=True)
        
    def connect_redis(self):
        """Connect to Redis"""
        try:
            self.redis_client = redis.from_url(self.redis_url)
            self.redis_client.ping()
            logger.info("Connected to Redis")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise
    
    def load_payment_instructions(self, file_path: str) -> pd.DataFrame:
        """Load payment instructions from CSV file"""
        try:
            df = pd.read_csv(file_path)
            logger.info(f"Loaded {len(df)} payment instructions from {file_path}")
            return df
        except Exception as e:
            logger.error(f"Failed to load payment instructions: {e}")
            raise
    
    def load_bank_statements(self, file_path: str = None) -> pd.DataFrame:
        """Load bank statements (for now, use sample data)"""
        if file_path and os.path.exists(file_path):
            try:
                df = pd.read_csv(file_path)
                logger.info(f"Loaded {len(df)} bank statements from {file_path}")
                return df
            except Exception as e:
                logger.error(f"Failed to load bank statements: {e}")
                raise
        
        # Generate sample bank statements for testing
        sample_data = self._generate_sample_bank_statements()
        logger.info(f"Generated {len(sample_data)} sample bank statements")
        return pd.DataFrame(sample_data)
    
    def _generate_sample_bank_statements(self) -> List[Dict]:
        """Generate sample bank statements for testing"""
        import random
        from datetime import datetime, timedelta
        
        statements = []
        base_time = datetime.now()
        
        # Generate 20 sample transactions
        for i in range(20):
            statements.append({
                'transactionId': f'BANK-{i+1:04d}',
                'timestamp': (base_time - timedelta(hours=i)).isoformat(),
                'status': 'SUCCESS',
                'amount': round(random.uniform(100, 10000), 2),
                'fromAccount': f'123456789{i%10}',
                'toAccount': f'098765432{i%10}',
                'paymentMethod': random.choice(['RTGS', 'NEFT', 'IMPS', 'UPI']),
                'referenceNumber': f'REF-{i+1:06d}',
                'processingFee': round(random.uniform(0, 50), 2),
                'netAmount': 0,  # Will be calculated
                'bankReference': f'BANK-{int(time.time())}-{i+1}',
                'utr': f'UTR{int(time.time())}{i+1:04d}'
            })
        
        # Calculate net amounts
        for stmt in statements:
            stmt['netAmount'] = stmt['amount'] - stmt['processingFee']
        
        return statements
    
    def clean_and_normalize_data(self, df: pd.DataFrame, data_type: str) -> pd.DataFrame:
        """Clean and normalize data for matching"""
        df_clean = df.copy()
        
        # Convert amount to float
        df_clean['amount'] = pd.to_numeric(df_clean['amount'], errors='coerce')
        
        # Convert timestamp to datetime
        if 'timestamp' in df_clean.columns:
            df_clean['timestamp'] = pd.to_datetime(df_clean['timestamp'])
        
        # Normalize account numbers (remove spaces, convert to string)
        for col in ['fromAccount', 'toAccount']:
            if col in df_clean.columns:
                df_clean[col] = df_clean[col].astype(str).str.strip()
        
        # Normalize payment methods
        if 'paymentMethod' in df_clean.columns:
            df_clean['paymentMethod'] = df_clean['paymentMethod'].str.upper().str.strip()
        
        # Remove rows with missing critical data
        critical_columns = ['amount', 'fromAccount', 'toAccount']
        df_clean = df_clean.dropna(subset=critical_columns)
        
        logger.info(f"Cleaned {data_type}: {len(df_clean)} records")
        return df_clean
    
    def exact_match(self, payments: pd.DataFrame, statements: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Exact match on amount, fromAccount, toAccount, and paymentMethod"""
        matched_payments = []
        matched_statements = []
        unmatched_payments = payments.copy()
        unmatched_statements = statements.copy()
        
        for _, payment in payments.iterrows():
            # Find exact matches
            mask = (
                (statements['amount'] == payment['amount']) &
                (statements['fromAccount'] == payment['fromAccount']) &
                (statements['toAccount'] == payment['toAccount']) &
                (statements['paymentMethod'] == payment['paymentMethod'])
            )
            
            matches = statements[mask]
            if len(matches) > 0:
                # Take the first match
                match = matches.iloc[0]
                matched_payments.append(payment)
                matched_statements.append(match)
                
                # Remove from unmatched
                unmatched_payments = unmatched_payments[unmatched_payments['transactionId'] != payment['transactionId']]
                unmatched_statements = unmatched_statements[unmatched_statements['transactionId'] != match['transactionId']]
        
        logger.info(f"Exact matches: {len(matched_payments)}")
        matched_transactions.labels(match_type='exact').inc(len(matched_payments))
        
        return pd.DataFrame(matched_payments), pd.DataFrame(matched_statements)
    
    def fuzzy_match(self, payments: pd.DataFrame, statements: pd.DataFrame) -> Tuple[pd.DataFrame, pd.DataFrame]:
        """Fuzzy match on amount and accounts with tolerance"""
        matched_payments = []
        matched_statements = []
        unmatched_payments = payments.copy()
        unmatched_statements = statements.copy()
        
        # Amount tolerance: ±1% or ±10, whichever is smaller
        amount_tolerance = 0.01
        
        for _, payment in unmatched_payments.iterrows():
            # Calculate amount range
            amount_min = payment['amount'] * (1 - amount_tolerance)
            amount_max = payment['amount'] * (1 + amount_tolerance)
            
            # Find fuzzy matches
            mask = (
                (statements['amount'] >= amount_min) &
                (statements['amount'] <= amount_max) &
                (statements['fromAccount'] == payment['fromAccount']) &
                (statements['toAccount'] == payment['toAccount'])
            )
            
            matches = statements[mask]
            if len(matches) > 0:
                # Take the closest amount match
                matches['amount_diff'] = abs(matches['amount'] - payment['amount'])
                best_match = matches.loc[matches['amount_diff'].idxmin()]
                
                matched_payments.append(payment)
                matched_statements.append(best_match)
                
                # Remove from unmatched
                unmatched_payments = unmatched_payments[unmatched_payments['transactionId'] != payment['transactionId']]
                unmatched_statements = unmatched_statements[unmatched_statements['transactionId'] != best_match['transactionId']]
        
        logger.info(f"Fuzzy matches: {len(matched_payments)}")
        matched_transactions.labels(match_type='fuzzy').inc(len(matched_payments))
        
        return pd.DataFrame(matched_payments), pd.DataFrame(matched_statements)
    
    def classify_exceptions(self, unmatched_payments: pd.DataFrame) -> pd.DataFrame:
        """Classify unmatched transactions according to exception taxonomy"""
        exceptions = []
        
        for _, payment in unmatched_payments.iterrows():
            exception_type = self._determine_exception_type(payment)
            exceptions.append({
                'transactionId': payment['transactionId'],
                'amount': payment['amount'],
                'fromAccount': payment['fromAccount'],
                'toAccount': payment['toAccount'],
                'paymentMethod': payment['paymentMethod'],
                'timestamp': payment['timestamp'],
                'exceptionType': exception_type,
                'exceptionReason': self._get_exception_reason(exception_type),
                'severity': self._get_exception_severity(exception_type)
            })
        
        return pd.DataFrame(exceptions)
    
    def _determine_exception_type(self, payment: pd.Series) -> str:
        """Determine exception type based on payment characteristics"""
        # This is a simplified classification logic
        # In a real system, this would be more sophisticated
        
        if payment['amount'] > 100000:
            return 'HIGH_VALUE_UNMATCHED'
        elif payment['paymentMethod'] == 'RTGS':
            return 'RTGS_UNMATCHED'
        elif payment['paymentMethod'] == 'UPI':
            return 'UPI_UNMATCHED'
        else:
            return 'GENERAL_UNMATCHED'
    
    def _get_exception_reason(self, exception_type: str) -> str:
        """Get human-readable reason for exception type"""
        reasons = {
            'HIGH_VALUE_UNMATCHED': 'High value transaction requires manual review',
            'RTGS_UNMATCHED': 'RTGS transaction not found in bank statements',
            'UPI_UNMATCHED': 'UPI transaction not found in bank statements',
            'GENERAL_UNMATCHED': 'Transaction not matched with any bank statement'
        }
        return reasons.get(exception_type, 'Unknown exception type')
    
    def _get_exception_severity(self, exception_type: str) -> str:
        """Get severity level for exception type"""
        severity_map = {
            'HIGH_VALUE_UNMATCHED': 'HIGH',
            'RTGS_UNMATCHED': 'MEDIUM',
            'UPI_UNMATCHED': 'LOW',
            'GENERAL_UNMATCHED': 'MEDIUM'
        }
        return severity_map.get(exception_type, 'UNKNOWN')
    
    def generate_recon_output(self, exact_matches: pd.DataFrame, fuzzy_matches: pd.DataFrame, 
                            exceptions: pd.DataFrame, batch_id: str) -> Dict[str, Any]:
        """Generate reconciliation output in required JSON format"""
        
        # Combine all matches
        all_matches = []
        
        # Add exact matches
        for _, (payment, statement) in exact_matches.iterrows():
            all_matches.append({
                'paymentId': payment['transactionId'],
                'statementId': statement['transactionId'],
                'amount': float(payment['amount']),
                'matchType': 'EXACT',
                'confidence': 1.0,
                'paymentData': payment.to_dict(),
                'statementData': statement.to_dict()
            })
        
        # Add fuzzy matches
        for _, (payment, statement) in fuzzy_matches.iterrows():
            all_matches.append({
                'paymentId': payment['transactionId'],
                'statementId': statement['transactionId'],
                'amount': float(payment['amount']),
                'matchType': 'FUZZY',
                'confidence': 0.8,
                'paymentData': payment.to_dict(),
                'statementData': statement.to_dict()
            })
        
        # Calculate statistics
        total_payments = len(exact_matches) + len(fuzzy_matches) + len(exceptions)
        matched_count = len(all_matches)
        auto_match_percentage.set((matched_count / total_payments) * 100 if total_payments > 0 else 0)
        
        output = {
            'batchId': batch_id,
            'timestamp': datetime.now().isoformat(),
            'summary': {
                'totalPayments': int(total_payments),
                'matchedCount': len(all_matches),
                'unmatchedCount': len(exceptions),
                'autoMatchPercentage': round((matched_count / total_payments) * 100, 2) if total_payments > 0 else 0,
                'exactMatches': len(exact_matches),
                'fuzzyMatches': len(fuzzy_matches)
            },
            'matched': all_matches,
            'exceptions': exceptions.to_dict('records') if not exceptions.empty else []
        }
        
        return output
    
    def save_recon_output(self, output: Dict[str, Any], batch_id: str) -> str:
        """Save reconciliation output to file"""
        output_file = f'{self.recon_output_dir}/{batch_id}.json'
        
        try:
            with open(output_file, 'w') as f:
                json.dump(output, f, indent=2, default=str)
            
            logger.info(f"Saved reconciliation output to {output_file}")
            return output_file
        except Exception as e:
            logger.error(f"Failed to save reconciliation output: {e}")
            raise
    
    def publish_recon_completed(self, batch_id: str, output_file: str):
        """Publish recon.completed event"""
        try:
            event = {
                'type': 'recon.completed',
                'batchId': batch_id,
                'outputFile': output_file,
                'timestamp': datetime.now().isoformat()
            }
            
            self.redis_client.publish('arealis:events', json.dumps(event))
            logger.info(f"Published recon.completed event for batch {batch_id}")
        except Exception as e:
            logger.error(f"Failed to publish recon.completed event: {e}")
    
    def process_batch(self, batch_id: str, file_path: str):
        """Main reconciliation process"""
        start_time = time.time()
        
        try:
            logger.info(f"Starting reconciliation for batch {batch_id}")
            recon_jobs_total.labels(status='started').inc()
            
            # Load data
            payments = self.load_payment_instructions(file_path)
            statements = self.load_bank_statements()
            
            # Clean and normalize
            payments_clean = self.clean_and_normalize_data(payments, 'payments')
            statements_clean = self.clean_and_normalize_data(statements, 'statements')
            
            # Multi-pass matching
            # Pass 1: Exact match
            exact_matched_payments, exact_matched_statements = self.exact_match(payments_clean, statements_clean)
            
            # Pass 2: Fuzzy match on remaining
            remaining_payments = payments_clean[~payments_clean['transactionId'].isin(exact_matched_payments['transactionId'])]
            remaining_statements = statements_clean[~statements_clean['transactionId'].isin(exact_matched_statements['transactionId'])]
            
            fuzzy_matched_payments, fuzzy_matched_statements = self.fuzzy_match(remaining_payments, remaining_statements)
            
            # Classify exceptions
            final_remaining = remaining_payments[~remaining_payments['transactionId'].isin(fuzzy_matched_payments['transactionId'])]
            exceptions = self.classify_exceptions(final_remaining)
            
            # Generate output
            output = self.generate_recon_output(
                exact_matched_payments, 
                fuzzy_matched_payments, 
                exceptions, 
                batch_id
            )
            
            # Save output
            output_file = self.save_recon_output(output, batch_id)
            
            # Publish completion event
            self.publish_recon_completed(batch_id, output_file)
            
            # Update metrics
            duration = time.time() - start_time
            recon_duration.observe(duration)
            recon_jobs_total.labels(status='completed').inc()
            
            logger.info(f"Reconciliation completed for batch {batch_id} in {duration:.2f}s")
            logger.info(f"Auto-match percentage: {output['summary']['autoMatchPercentage']}%")
            
        except Exception as e:
            logger.error(f"Reconciliation failed for batch {batch_id}: {e}")
            recon_jobs_total.labels(status='failed').inc()
            raise
    
    def listen_for_events(self):
        """Listen for batch.created events and process them"""
        logger.info("Starting event listener...")
        
        pubsub = self.redis_client.pubsub()
        pubsub.subscribe('arealis:events')
        
        for message in pubsub.listen():
            if message['type'] == 'message':
                try:
                    event = json.loads(message['data'])
                    logger.info(f"Received event: {event['type']}")
                    
                    if event['type'] == 'batch.created':
                        batch_id = event['batchId']
                        file_path = event['filePath']
                        
                        # Process in background (in production, use a task queue)
                        self.process_batch(batch_id, file_path)
                        
                except Exception as e:
                    logger.error(f"Error processing event: {e}")

def main():
    """Main entry point"""
    # Start Prometheus metrics server
    start_http_server(8000)
    logger.info("Started Prometheus metrics server on port 8000")
    
    # Initialize reconciliation engine
    engine = ReconciliationEngine()
    engine.connect_redis()
    
    # Start listening for events
    engine.listen_for_events()

if __name__ == '__main__':
    main()
