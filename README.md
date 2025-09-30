# Arealis Reconciliation & Data Platform

A comprehensive data reconciliation platform for payment processing with automated matching, journal generation, and audit capabilities.

## Project Overview

This platform provides end-to-end payment reconciliation capabilities including:
- **Rail Statement Simulators**: Mock bank servers for testing
- **Ingest Pipeline**: Secure file upload and validation
- **Reconciliation Engine (ARL)**: Automated payment matching
- **Journal Generator**: Accounting-ready exports
- **Evidence Store**: Secure audit artifact storage
- **Observability**: Monitoring and alerting

## Architecture

The platform is built as a microservices architecture using Docker Compose for local development:

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

## Quick Start

### Prerequisites

- Docker and Docker Compose
- Git

### Setup

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd DATA-TEAM
   ```

2. **Create environment file**
   ```bash
   cp env.example .env
   # Edit .env with your specific configuration
   ```

3. **Start all services**
   ```bash
   docker-compose up -d
   ```

4. **Verify services are running**
   ```bash
   docker-compose ps
   ```

### Service Endpoints

- **Simulator**: http://localhost:3000
- **Ingest API**: http://localhost:3001
- **Recon Engine**: http://localhost:8000
- **Evidence Store**: http://localhost:8080
- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin)

## Development Phases

### Phase 1: Foundation & Simulation (Target: Sep 27)
- ✅ Local Environment Setup
- ✅ Docker Compose Configuration
- ✅ CI/CD Pipeline
- ✅ Rail Statement Simulator
- ✅ Monitoring Setup

### Phase 2: Core Data Processing (Target: Sep 30)
- 🔄 Ingest Pipeline
- 🔄 Reconciliation Engine
- 🔄 Journal Generator

### Phase 3: Hardening & Security (Target: Oct 3)
- ⏳ Evidence Store
- ⏳ Advanced Observability
- ⏳ Security Hardening

## API Documentation

### Simulator Endpoints

#### POST /simulate/rtgs
Simulate RTGS (Real Time Gross Settlement) transactions.

**Request:**
```json
{
  "transaction": {
    "amount": 100000,
    "fromAccount": "1234567890",
    "toAccount": "0987654321"
  },
  "outcome": "success",
  "failureCode": "INSUFFICIENT_FUNDS" // optional, for failure cases
}
```

**Response:**
```json
{
  "transactionId": "uuid",
  "timestamp": "2025-09-25T10:30:00Z",
  "status": "SUCCESS",
  "amount": 100000,
  "fromAccount": "1234567890",
  "toAccount": "0987654321",
  "paymentMethod": "RTGS",
  "referenceNumber": "TXN-ABC12345",
  "processingFee": 25,
  "netAmount": 99975,
  "bankReference": "BANK-1695634200000",
  "utr": "RTGS1695634200000ABC123"
}
```

#### POST /simulate/neft
Simulate NEFT (National Electronic Funds Transfer) transactions.

#### POST /simulate/imps
Simulate IMPS (Immediate Payment Service) transactions.

#### POST /simulate/upi
Simulate UPI (Unified Payments Interface) transactions.

**Request:**
```json
{
  "transaction": {
    "amount": 1000,
    "upiId": "user@paytm"
  },
  "outcome": "success"
}
```

### Health Check

#### GET /health
Returns service health status.

## Testing

Run tests for individual services:

```bash
# Simulator tests
cd simulator-service
docker run --rm arealis-simulator npm test

# All services
docker-compose run simulator npm test
```

## Monitoring

Access the monitoring dashboards:

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3001 (admin/admin)

Key metrics monitored:
- Auto Match Percentage
- Transaction Processing Rate
- Service Health Status
- Error Rates

## File Structure

```
DATA-TEAM/
├── docker-compose.yml          # Main orchestration file
├── .env.example               # Environment template
├── .gitignore                 # Git ignore rules
├── .github/
│   └── workflows/
│       └── build-and-test.yml # CI/CD pipeline
├── simulator-service/          # Rail statement simulator
│   ├── Dockerfile
│   ├── package.json
│   ├── server.js
│   └── tests/
├── monitoring/                 # Observability config
│   ├── prometheus.yml
│   └── grafana/
└── README.md
```

## Contributing

1. Follow the phase-based development approach
2. Ensure all tests pass before submitting
3. Update documentation for new features
4. Follow the established API patterns

## License

MIT License - see LICENSE file for details.
