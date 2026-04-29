# CodeAssess - Online Coding Assessment Platform

A production-grade online coding assessment platform (like HackerRank) built to handle 400–1000 concurrent users.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14 (App Router), Tailwind CSS, Monaco Editor |
| Backend | NestJS, TypeORM, PostgreSQL |
| Queue | BullMQ + Redis |
| Code Execution | Judge0 CE (self-hosted) |
| Deployment | Docker + Docker Compose |

## Architecture

```
Client (Next.js :3000)
  → API Gateway (NestJS :4000)
    → BullMQ Queue (Redis :6380)
      → Worker Processors
        → Judge0 API (:2358)
    → PostgreSQL (:5433)
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+ (for local development)

### Option 1: Docker (Full Stack)

```bash
docker compose up -d
```

Wait 30-60 seconds for all services to start, then:
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000/api
- Judge0 API: http://localhost:2358

### Option 2: Local Development

1. **Start infrastructure:**

```bash
docker compose up -d platform-db platform-redis judge0-db judge0-redis judge0-server judge0-workers
```

2. **Start backend:**

```bash
cd backend
npm install
npm run start:dev
```

3. **Seed the database:**

```bash
cd backend
npm run seed
```

4. **Start frontend:**

```bash
cd frontend
npm install
npm run dev
```

## Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@codeassess.com | admin123 |
| Student | student@codeassess.com | student123 |

## Features

### Admin
- Create/Edit/Delete tests with coding & MCQ questions
- Upload hidden test cases
- Configure time limits, marks, and allowed languages
- Live test monitoring (who started, submitted, remaining time)
- Leaderboard & detailed results
- Anti-cheat flagging visibility

### Student
- View available tests
- Start test with enforced timer
- Monaco code editor with syntax highlighting
- Language selection (C, C++, Java, Python, JavaScript, Rust, C#)
- Run code with custom input
- Submit solutions for evaluation
- Auto-submit on timeout
- View detailed results after submission

### Anti-Cheating
- Fullscreen mode detection
- Tab switch detection
- Copy-paste disabled during tests
- Question order randomization
- All violations logged and visible to admins

### Performance
- Async submission processing via BullMQ
- Redis caching
- Rate limiting (1 submission per 3 seconds)
- Database indexing
- Paginated API responses
- Horizontal scalability (multiple workers)

## API Endpoints

### Auth
- `POST /api/auth/register` - Register user
- `POST /api/auth/login` - Login
- `GET /api/auth/profile` - Get profile

### Tests
- `GET /api/tests` - List all (admin)
- `GET /api/tests/active` - List active tests
- `GET /api/tests/:id` - Get test details
- `POST /api/tests` - Create test (admin)
- `PUT /api/tests/:id` - Update test (admin)
- `DELETE /api/tests/:id` - Delete test (admin)

### Questions
- `GET /api/questions/test/:testId` - Get questions for test
- `POST /api/questions` - Create question (admin)
- `PUT /api/questions/:id` - Update question (admin)
- `DELETE /api/questions/:id` - Delete question (admin)
- `POST /api/questions/:id/test-cases` - Add test case (admin)

### Submissions
- `POST /api/submissions` - Submit solution
- `POST /api/submissions/run` - Run code (custom input)
- `GET /api/submissions/:id` - Get submission status
- `GET /api/submissions/user/test/:testId` - My submissions for test

### Results
- `POST /api/results/start/:testId` - Start test
- `POST /api/results/submit/:testId` - Submit test
- `POST /api/results/anti-cheat/:testId` - Report anti-cheat
- `GET /api/results/monitor/:testId` - Live monitor (admin)
- `GET /api/results/leaderboard/:testId` - Leaderboard
- `GET /api/results/detailed/:testId` - Detailed results

## Project Structure

```
├── backend/
│   ├── src/
│   │   ├── auth/          # JWT authentication
│   │   ├── users/         # User management
│   │   ├── tests/         # Test CRUD
│   │   ├── questions/     # Questions & test cases
│   │   ├── submissions/   # Submission handling
│   │   ├── queue/         # BullMQ producer & processor
│   │   ├── judge0/        # Judge0 API client
│   │   ├── results/       # Results, leaderboard, participation
│   │   ├── common/        # Guards, decorators, filters
│   │   └── config/        # App configuration
│   └── Dockerfile
├── frontend/
│   ├── app/
│   │   ├── (auth)/        # Login & Register
│   │   ├── admin/         # Admin panel
│   │   ├── student/       # Student dashboard
│   │   └── test/[id]/     # Test-taking interface
│   ├── components/
│   │   └── test/          # CodeEditor, QuestionPanel, OutputPanel
│   ├── hooks/             # useAuth, useTimer, useFullscreen
│   ├── services/          # API client layer
│   └── Dockerfile
├── docker-compose.yml
├── judge0.conf
└── README.md
```
