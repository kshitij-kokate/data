# Arealis Platform Deployment Guide

## Quick Start

### 1. Prerequisites
- Docker and Docker Compose installed
- Git
- At least 4GB RAM available
- Ports 3000-3002, 6379, 8000-8001, 8080, 9090 available

### 2. Clone and Setup
```bash
git clone <repository-url>
cd DATA-TEAM
cp env.example .env
```

### 3. Start the Platform
```bash
# Start all services
docker-compose up -d

# Check service status
docker-compose ps

# View logs
docker-compose logs -f
```

### 4. Verify Installation
```bash
# Run integration tests
npm test

# Or manually check services
curl http://localhost:3000/health  # Simulator
curl http://localhost:3001/health  # Ingest API
curl http://localhost:8080/health  # Evidence Store
```

## Service Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Simulator     │    │   Ingest API    │    │  Recon Engine  │
│   (Port 3000)   │    │   (Port 3001)   │    │   (Port 8000)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │      Redis      │
                    │   (Port 6379)   │
                    └─────────────────┘
                                 │
         ┌───────────────────────┼───────────────────────┐
         │                       │                       │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ Journal Gen.    │    │ Evidence Store  │    │   Monitoring    │
│                 │    │   (Port 8080)   │    │ Prometheus/Graf │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## API Endpoints

### Simulator Service (Port 3000)
- `POST /simulate/rtgs` - Simulate RTGS transactions
- `POST /simulate/neft` - Simulate NEFT transactions  
- `POST /simulate/imps` - Simulate IMPS transactions
- `POST /simulate/upi` - Simulate UPI transactions
- `GET /health` - Health check
- `GET /failure-codes` - Available failure codes

### Ingest API (Port 3001)
- `POST /upload` - Upload payment instruction files
- `GET /batch/:batchId/status` - Check batch status
- `GET /health` - Health check
- `GET /metrics` - Prometheus metrics

### Evidence Store (Port 8080)
- `GET /files` - List all evidence files
- `GET /:filename` - Download specific file
- `GET /:filename/metadata` - Get file metadata
- `GET /search/:pattern` - Search files
- `GET /stats` - Storage statistics
- `GET /health` - Health check

### Monitoring
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3002 (admin/admin)

## Data Flow

1. **File Upload**: CSV files uploaded to Ingest API
2. **Validation**: Files validated against schema and deduplicated
3. **Event Publishing**: `batch.created` event published to Redis
4. **Reconciliation**: Recon Engine processes batch and matches transactions
5. **Journal Generation**: Journal Generator creates Tally-compliant CSV
6. **Evidence Storage**: All artifacts stored in Evidence Store

## File Structure

```
DATA-TEAM/
├── docker-compose.yml          # Main orchestration
├── .env.example               # Environment template
├── package.json               # Platform scripts
├── test-platform.js           # Integration tests
├── simulator-service/         # Rail statement simulator
├── ingest-service/            # File upload and validation
├── recon-service/             # Reconciliation engine
├── journal-service/           # Journal generator
├── evidence-service/          # Evidence store
└── monitoring/                # Observability config
```

## Environment Variables

Key environment variables (see `env.example`):

```bash
# Database
DATABASE_URL=postgresql://arealis:password@localhost:5432/arealis_db

# Redis
REDIS_URL=redis://localhost:6379

# File Storage
DATA_DIRECTORY=./data
PROCESSED_DIRECTORY=./data/processed
RECON_OUTPUT_DIRECTORY=./data/recon-output
EVIDENCE_DIRECTORY=./data/evidence

# Monitoring
PROMETHEUS_PORT=9090
GRAFANA_PORT=3002
```

## Monitoring and Observability

### Prometheus Metrics
- Service health and availability
- Request rates and response times
- File processing metrics
- Reconciliation performance
- Auto-match percentages

### Grafana Dashboards
- System overview
- Service health status
- Performance metrics
- Error rates and trends

### Logs
```bash
# View all logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f simulator
docker-compose logs -f ingest-api
docker-compose logs -f recon-engine
```

## Troubleshooting

### Common Issues

1. **Services not starting**
   ```bash
   # Check Docker resources
   docker system df
   docker system prune
   
   # Restart services
   docker-compose restart
   ```

2. **Port conflicts**
   ```bash
   # Check port usage
   netstat -tulpn | grep :3000
   
   # Stop conflicting services
   sudo lsof -ti:3000 | xargs kill -9
   ```

3. **Redis connection issues**
   ```bash
   # Check Redis logs
   docker-compose logs redis
   
   # Test Redis connection
   docker-compose exec redis redis-cli ping
   ```

4. **File permission issues**
   ```bash
   # Fix permissions
   sudo chown -R $USER:$USER ./data
   chmod -R 755 ./data
   ```

### Health Checks

```bash
# Check all services
curl http://localhost:3000/health  # Simulator
curl http://localhost:3001/health  # Ingest
curl http://localhost:8080/health  # Evidence Store

# Check metrics
curl http://localhost:3001/metrics  # Ingest metrics
curl http://localhost:8000/metrics  # Recon metrics
curl http://localhost:8080/metrics  # Evidence metrics
```

## Development

### Adding New Services
1. Create service directory with Dockerfile
2. Add service to docker-compose.yml
3. Update monitoring configuration
4. Add health checks and metrics

### Testing
```bash
# Run unit tests
docker-compose run simulator npm test
docker-compose run ingest-api npm test
docker-compose run recon-engine python -m pytest
docker-compose run journal-service python -m pytest
docker-compose run evidence-store npm test

# Run integration tests
npm test
```

### Building Images
```bash
# Build all images
docker-compose build

# Build specific service
docker-compose build simulator
```

## Production Considerations

### Security
- Change default passwords
- Use proper SSL certificates
- Implement network segmentation
- Regular security updates

### Performance
- Allocate sufficient resources
- Monitor memory usage
- Optimize database queries
- Implement caching strategies

### Backup
- Regular database backups
- Evidence store backups
- Configuration backups
- Disaster recovery plan

## Support

For issues and questions:
1. Check logs: `docker-compose logs -f`
2. Run diagnostics: `npm test`
3. Review documentation
4. Contact Data & DevOps team

## License

MIT License - see LICENSE file for details.
