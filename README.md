# Creativa Training Filter System - Backend

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)

An enterprise-grade RESTful API backend for **Creativa Innovation Hub - Mansoura**. This service securely powers the frontend operations platform, providing centralized authentication, MongoDB data persistence, and role-based data governance for training operations, candidate filtering, and auditing.

---

## 📖 Table of Contents

- [🚀 Overview](#-overview)
- [✨ Core Features](#-core-features)
- [🛠️ Tech Stack](#️-tech-stack)
- [🏗️ Architecture](#️-architecture)
- [📁 Project Structure](#-project-structure)
- [🎭 Role-Based Access Control](#-role-based-access-control)
- [🔐 Environment Variables](#-environment-variables)
- [🚀 Getting Started](#-getting-started)
- [📝 Deployment & Security](#-deployment--security)

---

## 🚀 Overview

The **Creativa Training Filter System - Backend** is a highly secure, custom Node.js and Express API. It manages all data persistence, user sessions via HttpOnly cookies, and strict role-based access to ensure operational data integrity.

### Key Value Propositions

- **Total Data Ownership**: Uses a self-hosted or managed MongoDB instance, providing total control over database schemas, indexing, and backups.
- **Enhanced Security**: Authentication is driven by secure, HttpOnly, SameSite-configured JSON Web Tokens (JWTs). Tokens are never exposed to the client's `localStorage`, nullifying XSS token theft vectors.
- **Serverless Ready**: Built and configured to deploy seamlessly to Vercel Serverless Functions, ensuring high availability, zero-maintenance scaling, and cost efficiency.
- **Automated Auditing**: All critical database mutations (user modifications, blacklist updates) automatically generate normalized audit logs using Mongoose lifecycle hooks and controller wrappers.
- **High-Performance Bulk Operations**: Processes large attendance uploads utilizing optimized MongoDB `$in` queries and parallel execution to resolve N+1 performance bottlenecks.

---

## ✨ Core Features

### 🔐 Advanced Authentication
- **Dual-Token System**: Implements short-lived Access Tokens (15m) and long-lived Refresh Tokens (7d) for robust session security.
- **HttpOnly Delivery**: Tokens are attached directly to outgoing response cookies, securing them from frontend JavaScript environments.
- **Rate Limiting**: Built-in, user-aware rate limiting prevents brute-force login attempts and API abuse.

### 👥 User Administration
- **Role Hierarchy**: Supports `admin`, `employee`, and `viewer` roles, mapped to specific API endpoints.
- **Account State**: Active/Deactivated account toggles allow instant revocation of user access.

### 🚫 Blacklist Governance
- **Mongoose Indexing**: Enforces uniqueness on National IDs to prevent duplicate blacklist entries.
- **TTL (Time-To-Live)**: Employs MongoDB TTL indexes to automatically prune expired blacklist entries after their 4-month lifecycle.
- **Dynamic Tracks Module**: Fully functional Tracks API to manage available training tracks and attach them to blacklist entries.

### ⏱️ Hours & Timetable Tracking
- **Session Consolidation**: Centralizes training session data with integrated fiscal year calculations.
- **Bulk Imports & Deduplication**: Fast Excel parsing pipeline utilizing Mongoose uniqueness logic to gracefully skip duplicate sessions.
- **Timetable Generation**: Aggregates sessions into complex, color-coded fiscal year timetables with automated snapshot caching.
- **Planned Timetable & Comparison**: Stores yearly planned hours and computes real-time comparisons between actual performance and targeted plans.

### 🧾 Attendance Sheet Organizer
- **Excel Formatting Engine**: Uses `xlsx-js-style` to programmatically parse raw Google Forms data and reconstruct it into an advanced, multi-sheet Excel workbook.
- **Intelligent Grouping**: Automatically groups trainees by Workshop Name and Date, inserts customized yellow session headers, and separates sessions with thick black rows.

### 📝 Audit Logging
- **Immutable Trail**: Actions like creating users or modifying the blacklist are permanently recorded with the performer's ID, action type, and target metadata.

---

## 🛠️ Tech Stack

| Category | Technology |
| :--- | :--- |
| **Runtime** | Node.js (v20+) |
| **Framework** | Express.js 5 |
| **Language** | TypeScript 5 |
| **Database** | MongoDB |
| **ORM / ODM** | Mongoose 8 |
| **Authentication** | JSON Web Tokens (JWT) |
| **Security** | Helmet, CORS, Express Rate Limit |
| **Validation** | Joi |
| **Deployment** | Vercel (`@vercel/node`) |

---

## 🏗️ Architecture

The backend follows a classic layered MVC-style REST architecture customized for Express and TypeScript:

1. **Routes (`src/routes/`)**: Maps HTTP methods and endpoints to specific controller logic. Attaches authorization middleware.
2. **Controllers (`src/controllers/`)**: Handles incoming HTTP request parsing, interacts with Mongoose models, and formats JSON responses.
3. **Models (`src/models/`)**: Defines MongoDB schemas, Mongoose hooks (pre-save, post-save), and TTL indexes.
4. **Middleware (`src/middleware/`)**: Contains reusable pipeline logic such as JWT verification, role-checking, and global error handling.

### Security Model

- **CORS Mitigation**: Specifically configured to accept credentials only from the designated frontend domain.
- **Vercel Proxy Trust**: Uses `app.set('trust proxy', 1)` to correctly identify client IPs behind Vercel's edge network for accurate rate-limiting.
- **Error Obfuscation**: The global error handler prevents raw stack traces from leaking to the frontend in production environments.

---

## 📁 Project Structure

```text
├── 📁 api/                       # Vercel Serverless entrypoint
│   └── 📄 index.ts               # Mounts the Express app for Vercel
├── 📁 src/
│   ├── 📁 config/                # Database connection and environment config
│   ├── 📁 controllers/           # Route handler logic
│   │   ├── 📄 audit.controller.ts
│   │   ├── 📄 auth.controller.ts
│   │   ├── 📄 blacklist.controller.ts
│   │   ├── 📄 tracks.controller.ts
│   │   └── 📄 users.controller.ts
│   ├── 📁 middleware/            # Express middlewares
│   │   ├── 📄 auth.middleware.ts # JWT parsing and role verification
│   │   └── 📄 errorHandler.ts    # Global error interceptor
│   ├── 📁 models/                # Mongoose Database Schemas
│   │   ├── 📄 AuditLog.ts
│   │   ├── 📄 BlacklistEntry.ts
│   │   ├── 📄 DailyStat.ts
│   │   ├── 📄 Track.ts
│   │   └── 📄 User.ts
│   ├── 📁 routes/                # Express router definitions
│   │   ├── 📄 audit.routes.ts
│   │   ├── 📄 auth.routes.ts
│   │   ├── 📄 blacklist.routes.ts
│   │   ├── 📄 tracks.routes.ts
│   │   └── 📄 users.routes.ts
│   └── 📄 index.ts               # Express app initialization & local dev server
├── 📄 package.json               # Dependencies and scripts
├── 📄 tsconfig.json              # TypeScript compilation rules
└── 📄 vercel.json                # Vercel rewrite rules
```

---

## 🎭 Role-Based Access Control

The backend enforces data security at the endpoint level using the `authorizeRoles` middleware.

| API Endpoint | Admin | Employee | Viewer |
| :--- | :---: | :---: | :---: |
| `POST /api/auth/login` | ✅ | ✅ | ✅ |
| `POST /api/auth/logout` | ✅ | ✅ | ✅ |
| `POST /api/auth/refresh` | ✅ | ✅ | ✅ |
| `GET /api/auth/me` | ✅ | ✅ | ✅ |
| `GET /api/dashboard/stats` | ✅ | ✅ | ✅ |
| `GET /api/blacklist` | ✅ | ✅ | ✅ |
| `GET /api/blacklist/ids` | ✅ | ✅ | ✅ |
| `POST /api/blacklist` | ✅ | ✅ | ❌ |
| `POST /api/blacklist/bulk` | ✅ | ✅ | ❌ |
| `DELETE /api/blacklist` | ✅ | ✅ | ❌ |
| `GET /api/tracks` | ✅ | ✅ | ✅ |
| `POST /api/tracks` | ✅ | ✅ | ❌ |
| `DELETE /api/tracks/:id` | ✅ | ✅ | ❌ |
| `GET /api/users` | ✅ | ❌ | ❌ |
| `POST /api/users` | ✅ | ❌ | ❌ |
| `PATCH /api/users/:id` | ✅ | ❌ | ❌ |
| `GET /api/audit` | ✅ | ❌ | ❌ |
| `GET /api/hours/sessions` | ✅ | ✅ | ✅ |
| `POST /api/hours/sessions` | ✅ | ✅ | ❌ |
| `DELETE /api/hours/sessions/:id` | ✅ | ✅ | ❌ |
| `POST /api/hours/import` | ✅ | ✅ | ❌ |
| `GET /api/hours/timetable` | ✅ | ✅ | ✅ |
| `GET /api/hours/timetable/:fiscalYear` | ✅ | ✅ | ✅ |
| `GET /api/hours/instructors` | ✅ | ✅ | ✅ |
| `DELETE /api/hours/sessions/bulk` | ✅ | ✅ | ❌ |
| `POST /api/attendance-sheet/build` | ✅ | ✅ | ❌ |
| `GET /api/planned/:fiscalYear` | ✅ | ✅ | ✅ |
| `PUT /api/planned/:fiscalYear` | ✅ | ✅ | ❌ |
| `PATCH /api/planned/:fiscalYear/cell` | ✅ | ✅ | ❌ |
| `GET /api/planned/:fiscalYear/comparison` | ✅ | ✅ | ✅ |
| `GET /api/planned/:fiscalYear/export` | ✅ | ✅ | ✅ |

---

## 🔐 Environment Variables

Create a `.env` file in the project root.

```env
# Server Configuration
PORT=5000
NODE_ENV=development

# Frontend Integration
FRONTEND_URL=http://localhost:3000

# Database
MONGODB_URI=mongodb+srv://<username>:<password>@cluster.mongodb.net/creativa

# JWT Secrets (Generate strong random strings)
JWT_ACCESS_SECRET=your_super_secret_access_key
JWT_REFRESH_SECRET=your_super_secret_refresh_key

# Admin Bootstrapping
# Used by the seeding script to create the first admin account
DEFAULT_ADMIN_EMAIL=admin@creativa.gov.eg
DEFAULT_ADMIN_PASSWORD=creativa_secure_pass
DEFAULT_ADMIN_USERNAME=admin
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 20.9.0+
- A running MongoDB instance (Local or MongoDB Atlas)

### Installation & Run

1. **Clone the repository**:
   ```bash
   git clone https://github.com/mahmoud-el-tohamy/creativa-backend.git
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure environment variables**:
   Copy `.env.example` to `.env` (or create it manually) and fill in your MongoDB URI and JWT secrets.

4. **Seed the database**:
   Run the seed script to inject the first Admin user into the database using your configured default environment variables.
   ```bash
   npm run seed
   ```

5. **Start the development server**:
   ```bash
   npm run dev
   ```
   *(The server will start on `http://localhost:5000`)*

---

## 📝 Deployment & Security

This project is optimized for deployment on **Vercel** using Serverless Functions.

- **Vercel Setup**: Connect your GitHub repository to Vercel. Vercel's Node.js builder will automatically detect the `api/index.ts` and `vercel.json` configurations.
- **Environment Variables**: Ensure all variables from your local `.env` are mirrored in your Vercel Project Settings. Remember to set `NODE_ENV=production` and update `FRONTEND_URL` to your live Next.js domain.
- **Cookie Security Options**: In production, the backend automatically flags JWT cookies as `Secure: true` and `SameSite: none` to permit cross-origin authentication with the frontend domain.

---

**Built with ❤️ for Creativa Innovation Hub - Mansoura.**
