# Creativa Training Filter System - Backend API

<div align="center">
  <img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express.js-404D59?style=for-the-badge&logo=express&logoColor=white" alt="Express" />
  <img src="https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white" alt="MongoDB" />
  <img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white" alt="Vercel" />
</div>

<br />

An enterprise-grade, high-performance RESTful API backend engineered exclusively for **Creativa Innovation Hub - Mansoura**. This service acts as the secure backbone for operations, providing centralized authentication, robust MongoDB data persistence, automated auditing, and strict role-based data governance for complex workflows like candidate filtering, timetable generation, and financial tracking.

---

## 📖 Table of Contents

- [🚀 Architecture Overview](#-architecture-overview)
- [✨ Core Capabilities](#-core-capabilities)
  - [🔐 Security & Identity](#-security--identity)
  - [👥 Instructors & Financial Management](#-instructors--financial-management)
  - [🚫 Blacklist & Data Governance](#-blacklist--data-governance)
  - [⏱️ Hours & Operational Timetables](#️-hours--operational-timetables)
  - [📝 Immutable Audit Logging](#-immutable-audit-logging)
- [🛠️ Technology Stack](#️-technology-stack)
- [🏗️ Project Structure](#️-project-structure)
- [🎭 Role-Based Access Matrix](#-role-based-access-matrix)
- [⚙️ Environment Configuration](#️-environment-configuration)
- [🚀 Local Development](#-local-development)
- [🌐 Deployment](#-deployment)

---

## 🚀 Architecture Overview

The backend is built as a highly secure Node.js & Express API, fully typed with TypeScript, and connected to MongoDB via Mongoose. It is optimized to operate seamlessly within Vercel's Serverless environment, ensuring zero-maintenance scaling and high availability.

### Key Architectural Decisions:
- **Serverless-First:** Configured natively for Vercel functions (`api/index.ts`).
- **Base64 Image Architecture:** Completely bypasses traditional file-system limitations (like Vercel's read-only execution environment) by relying on client-side compression and storing profile pictures purely as Base64 strings in MongoDB.
- **Stateless Authentication:** Relies entirely on `HttpOnly`, `SameSite` JWT cookies for maximum security against XSS attacks.
- **Algorithmic Optimizations:** Processes massive attendance logs in milliseconds utilizing bulk MongoDB operations and `$in` queries to avoid N+1 issues.

---

## ✨ Core Capabilities

### 🔐 Security & Identity
- **Dual-Token System:** Short-lived Access Tokens (15m) paired with sliding-window Refresh Tokens (7d).
- **HttpOnly Cookie Delivery:** Tokens are attached directly to HTTP response headers, ensuring they never touch client-side `localStorage`.
- **Intelligent Rate Limiting:** Built-in dynamic rate-limiting mapped to JWT User IDs, neutralizing brute-force and scraping attempts.

### 👥 Instructors & Financial Management
- **Centralized Instructor Profiles:** Manage instructor details, external CV links, specialized training tracks, and daily financial rates (Training vs. Consultation).
- **Financial Analytics:** Computes exact session costs mathematically dynamically based on the session's duration, instructor's daily rates, and the type of session.
- **Reporting:** Export advanced fiscal reports directly tracking total instructor expenditures across specific months or fiscal years.

### 🚫 Blacklist & Data Governance
- **Mongoose Constraints:** National IDs enforce unique compound indexing to absolutely prevent dirty data injection.
- **Automated TTL Pruning:** Employs MongoDB Time-To-Live (TTL) indexing to automatically destroy blacklist entries exactly 4 months after their creation.
- **Bulk Safe-Check APIs:** Exposes preview endpoints that allow the frontend to safely check candidate warning levels *before* executing punitive actions.

### ⏱️ Hours & Operational Timetables
- **Fiscal Year Calculation:** Programmatically groups training sessions into accurate fiscal year blocks for government reporting.
- **Planned vs Actual Tracking:** Allows operations to record "Target Hours" for a fiscal year and compare them dynamically against actual accomplished training sessions.
- **Smart Deduplication:** Bulk-importing thousands of sessions from Excel is protected by upsert logic that safely skips already recorded sessions.

### 📝 Immutable Audit Logging
- Every single critical data mutation (Adding to blacklist, deleting sessions, modifying users) triggers a Mongoose post-hook that permanently logs the action, the performer's ID, and the affected metadata into an isolated Audit collection.

---

## 🛠️ Technology Stack

| Domain | Technology | Description |
| :--- | :--- | :--- |
| **Runtime** | Node.js (v20+) | High-performance V8 engine runtime |
| **Framework** | Express.js 5 | Lightweight, fast web framework |
| **Language** | TypeScript 5 | Strict typing for enterprise reliability |
| **Database** | MongoDB | Highly scalable NoSQL document store |
| **ODM** | Mongoose 8 | Schema validation and querying |
| **Auth** | JWT | Secure stateless authentication |
| **Security** | Helmet, CORS, Rate Limit | Defensive headers and traffic control |

---

## 🏗️ Project Structure

```text
├── 📁 api/                       # Vercel Serverless entrypoint
│   └── 📄 index.ts               # Mounts the Express app for Vercel
├── 📁 src/
│   ├── 📁 config/                # Database connection logic
│   ├── 📁 controllers/           # API Endpoint logic
│   │   ├── 📄 audit.controller.ts
│   │   ├── 📄 auth.controller.ts
│   │   ├── 📄 blacklist.controller.ts
│   │   ├── 📄 finance.controller.ts  # Financial tracking calculations
│   │   ├── 📄 instructors.controller.ts
│   │   ├── 📄 tracks.controller.ts
│   │   └── 📄 users.controller.ts
│   ├── 📁 middleware/            # Pipeline middlewares
│   │   ├── 📄 auth.middleware.ts # JWT verification & RBAC enforcement
│   │   └── 📄 errorHandler.ts    # Global exception catcher
│   ├── 📁 models/                # Mongoose Schemas & Hooks
│   │   ├── 📄 AuditLog.ts
│   │   ├── 📄 BlacklistEntry.ts
│   │   ├── 📄 Instructor.ts
│   │   ├── 📄 TrainingSession.ts
│   │   └── 📄 User.ts
│   ├── 📁 routes/                # Express router definitions
│   └── 📄 index.ts               # Local development server bootstrapper
├── 📄 package.json               # Dependencies and scripts
└── 📄 vercel.json                # Vercel deployment configurations
```

---

## 🎭 Role-Based Access Matrix

The backend enforces endpoint-level authorization via the `authorizeRoles` middleware. Here is a high-level overview of the security matrix:

| Subsystem | Admin | Employee | Viewer |
| :--- | :---: | :---: | :---: |
| **Authentication & Profile** | ✅ | ✅ | ✅ |
| **View Analytics & Dashboards** | ✅ | ✅ | ✅ |
| **View Blacklist & Sessions** | ✅ | ✅ | ✅ |
| **Mutate Blacklist (Add/Del)** | ✅ | ✅ | ❌ |
| **Import/Edit Sessions & Hours** | ✅ | ✅ | ❌ |
| **Manage Instructor Profiles** | ✅ | ✅ | ❌ |
| **View Financial Reports** | ✅ | ✅ | ❌ |
| **Manage Users & Audit Logs** | ✅ | ❌ | ❌ |

---

## ⚙️ Environment Configuration

Create a `.env` file in the project root:

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
DEFAULT_ADMIN_EMAIL=admin@creativa.gov.eg
DEFAULT_ADMIN_PASSWORD=creativa_secure_pass
DEFAULT_ADMIN_USERNAME=admin
```

---

## 🚀 Local Development

1. **Clone & Install**:
   ```bash
   git clone https://github.com/mahmoud-el-tohamy/creativa-backend.git
   cd creativa-backend
   npm install
   ```

2. **Configure Environment**: Set up your `.env` file with a valid MongoDB URI.

3. **Seed Database**: Inject the initial Admin account.
   ```bash
   npm run seed
   ```

4. **Start Development Server**:
   ```bash
   npm run dev
   ```

---

## 🌐 Deployment

This backend is optimized for zero-config deployment on **Vercel**.
- The `vercel.json` rewrite rules natively route all requests into the Serverless function located at `api/index.ts`.
- Make sure to configure the `FRONTEND_URL` environment variable on Vercel to match your live Next.js domain, ensuring CORS allows cookie transmissions seamlessly.
- Cookies will automatically be marked `Secure: true` and `SameSite: none` in production mode.

---

<div align="center">
  <b>Built with ❤️ for Creativa Innovation Hub - Mansoura.</b>
</div>
