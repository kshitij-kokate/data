import pandas as pd
import redis
import json
import os
import time
import logging
from datetime import datetime
from typing import Dict, List, Any
from prometheus_client import Counter, Histogram, start_http_server
import csv
import io

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Prometheus metrics
journal_jobs_total = Counter('journal_jobs_total', 'Total journal generation jobs', ['status'])
journal_duration = Histogram('journal_duration_seconds', 'Journal generation duration in seconds')
journal_entries_generated = Counter('journal_entries_generated_total', 'Total journal entries generated')

class JournalGenerator:
    def __init__(self, redis_url: str = None):
        self.redis_url = redis_url or os.getenv('REDIS_URL', 'redis://redis:6379')
        self.redis_client = None
        self.data_dir = '/app/data'
        self.evidence_dir = f'{self.data_dir}/evidence'
        
        # Ensure directories exist
        os.makedirs(self.evidence_dir, exist_ok=True)
        
    def connect_redis(self):
        """Connect to Redis"""
        try:
            self.redis_client = redis.from_url(self.redis_url)
            self.redis_client.ping()
            logger.info("Connected to Redis")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}")
            raise
    
    def load_recon_data(self, recon_file_path: str) -> Dict[str, Any]:
        """Load reconciliation data from JSON file"""
        try:
            with open(recon_file_path, 'r') as f:
                recon_data = json.load(f)
            logger.info(f"Loaded reconciliation data from {recon_file_path}")
            return recon_data
        except Exception as e:
            logger.error(f"Failed to load reconciliation data: {e}")
            raise
    
    def generate_tally_csv(self, recon_data: Dict[str, Any]) -> str:
        """Generate Tally v1 compliant CSV file"""
        try:
            # Create CSV content in memory
            output = io.StringIO()
            writer = csv.writer(output)
            
            # Tally v1 CSV Header
            writer.writerow([
                'Voucher Type Name',
                'Date',
                'Voucher Number',
                'Account Name',
                'Debit',
                'Credit',
                'Narration',
                'Reference'
            ])
            
            # Process matched transactions
            entries_generated = 0
            for match in recon_data.get('matched', []):
                payment_data = match.get('paymentData', {})
                statement_data = match.get('statementData', {})
                
                # Generate voucher number
                voucher_number = f"PAY-{payment_data.get('transactionId', '')}"
                
                # Parse date
                try:
                    date_str = payment_data.get('timestamp', datetime.now().isoformat())
                    if 'T' in date_str:
                        date_str = date_str.split('T')[0]
                    # Convert to DD-MM-YYYY format for Tally
                    date_obj = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    tally_date = date_obj.strftime('%d-%m-%Y')
                except:
                    tally_date = datetime.now().strftime('%d-%m-%Y')
                
                # Create debit entry (from account)
                writer.writerow([
                    'Payment',  # Voucher Type
                    tally_date,
                    voucher_number,
                    f"Bank Account - {payment_data.get('fromAccount', '')}",  # Account Name
                    payment_data.get('amount', 0),  # Debit
                    0,  # Credit
                    f"Payment to {payment_data.get('toAccount', '')} via {payment_data.get('paymentMethod', '')}",  # Narration
                    payment_data.get('transactionId', '')  # Reference
                ])
                
                # Create credit entry (to account)
                writer.writerow([
                    'Payment',  # Voucher Type
                    tally_date,
                    voucher_number,
                    f"Bank Account - {payment_data.get('toAccount', '')}",  # Account Name
                    0,  # Debit
                    payment_data.get('amount', 0),  # Credit
                    f"Payment from {payment_data.get('fromAccount', '')} via {payment_data.get('paymentMethod', '')}",  # Narration
                    statement_data.get('referenceNumber', '')  # Reference
                ])
                
                entries_generated += 2
            
            # Process exceptions (create adjustment entries)
            for exception in recon_data.get('exceptions', []):
                # Generate voucher number for exception
                voucher_number = f"EXC-{exception.get('transactionId', '')}"
                
                # Parse date
                try:
                    date_str = exception.get('timestamp', datetime.now().isoformat())
                    if 'T' in date_str:
                        date_str = date_str.split('T')[0]
                    date_obj = datetime.fromisoformat(date_str.replace('Z', '+00:00'))
                    tally_date = date_obj.strftime('%d-%m-%Y')
                except:
                    tally_date = datetime.now().strftime('%d-%m-%Y')
                
                # Create suspense entry for unmatched transactions
                writer.writerow([
                    'Payment',  # Voucher Type
                    tally_date,
                    voucher_number,
                    'Suspense Account',  # Account Name
                    exception.get('amount', 0),  # Debit
                    0,  # Credit
                    f"Unmatched payment - {exception.get('exceptionReason', '')}",  # Narration
                    exception.get('transactionId', '')  # Reference
                ])
                
                writer.writerow([
                    'Payment',  # Voucher Type
                    tally_date,
                    voucher_number,
                    f"Bank Account - {exception.get('fromAccount', '')}",  # Account Name
                    0,  # Debit
                    exception.get('amount', 0),  # Credit
                    f"Unmatched payment - {exception.get('exceptionReason', '')}",  # Narration
                    exception.get('transactionId', '')  # Reference
                ])
                
                entries_generated += 2
            
            # Add summary entry
            summary = recon_data.get('summary', {})
            if summary:
                writer.writerow([
                    'Payment',  # Voucher Type
                    datetime.now().strftime('%d-%m-%Y'),
                    f"SUMMARY-{recon_data.get('batchId', '')}",
                    'Reconciliation Summary',  # Account Name
                    0,  # Debit
                    0,  # Credit
                    f"Total: {summary.get('totalPayments', 0)}, Matched: {summary.get('matchedCount', 0)}, Unmatched: {summary.get('unmatchedCount', 0)}",  # Narration
                    recon_data.get('batchId', '')  # Reference
                ])
            
            csv_content = output.getvalue()
            output.close()
            
            journal_entries_generated.inc(entries_generated)
            logger.info(f"Generated {entries_generated} journal entries")
            
            return csv_content
            
        except Exception as e:
            logger.error(f"Failed to generate Tally CSV: {e}")
            raise
    
    def save_journal_file(self, csv_content: str, batch_id: str) -> str:
        """Save journal CSV file to evidence store"""
        try:
            # Generate filename
            timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
            filename = f"journal_{batch_id}_{timestamp}.csv"
            file_path = os.path.join(self.evidence_dir, filename)
            
            # Write CSV content to file
            with open(file_path, 'w', newline='', encoding='utf-8') as f:
                f.write(csv_content)
            
            logger.info(f"Saved journal file to {file_path}")
            return file_path
            
        except Exception as e:
            logger.error(f"Failed to save journal file: {e}")
            raise
    
    def calculate_file_hash(self, file_path: str) -> str:
        """Calculate SHA256 hash of the file"""
        import hashlib
        
        try:
            with open(file_path, 'rb') as f:
                file_content = f.read()
                return hashlib.sha256(file_content).hexdigest()
        except Exception as e:
            logger.error(f"Failed to calculate file hash: {e}")
            raise
    
    def publish_journal_completed(self, batch_id: str, file_path: str, file_hash: str):
        """Publish journal.completed event"""
        try:
            event = {
                'type': 'journal.completed',
                'batchId': batch_id,
                'filePath': file_path,
                'fileHash': file_hash,
                'timestamp': datetime.now().isoformat()
            }
            
            self.redis_client.publish('arealis:events', json.dumps(event))
            logger.info(f"Published journal.completed event for batch {batch_id}")
        except Exception as e:
            logger.error(f"Failed to publish journal.completed event: {e}")
    
    def process_recon_data(self, batch_id: str, recon_file_path: str):
        """Main journal generation process"""
        start_time = time.time()
        
        try:
            logger.info(f"Starting journal generation for batch {batch_id}")
            journal_jobs_total.labels(status='started').inc()
            
            # Load reconciliation data
            recon_data = self.load_recon_data(recon_file_path)
            
            # Generate Tally CSV
            csv_content = self.generate_tally_csv(recon_data)
            
            # Save journal file
            file_path = self.save_journal_file(csv_content, batch_id)
            
            # Calculate file hash
            file_hash = self.calculate_file_hash(file_path)
            
            # Publish completion event
            self.publish_journal_completed(batch_id, file_path, file_hash)
            
            # Update metrics
            duration = time.time() - start_time
            journal_duration.observe(duration)
            journal_jobs_total.labels(status='completed').inc()
            
            logger.info(f"Journal generation completed for batch {batch_id} in {duration:.2f}s")
            logger.info(f"File saved: {file_path}")
            logger.info(f"File hash: {file_hash}")
            
        except Exception as e:
            logger.error(f"Journal generation failed for batch {batch_id}: {e}")
            journal_jobs_total.labels(status='failed').inc()
            raise
    
    def listen_for_events(self):
        """Listen for recon.completed events and process them"""
        logger.info("Starting event listener...")
        
        pubsub = self.redis_client.pubsub()
        pubsub.subscribe('arealis:events')
        
        for message in pubsub.listen():
            if message['type'] == 'message':
                try:
                    event = json.loads(message['data'])
                    logger.info(f"Received event: {event['type']}")
                    
                    if event['type'] == 'recon.completed':
                        batch_id = event['batchId']
                        recon_file_path = event['outputFile']
                        
                        # Process in background
                        self.process_recon_data(batch_id, recon_file_path)
                        
                except Exception as e:
                    logger.error(f"Error processing event: {e}")

def main():
    """Main entry point"""
    # Start Prometheus metrics server
    start_http_server(8001)
    logger.info("Started Prometheus metrics server on port 8001")
    
    # Initialize journal generator
    generator = JournalGenerator()
    generator.connect_redis()
    
    # Start listening for events
    generator.listen_for_events()

if __name__ == '__main__':
    main()
