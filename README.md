# AI Interview Agent

An asynchronous recorded screening platform designed for modern hiring. Candidates record video responses to structured questions alone, and AI transcribes, scores, and analyzes their submissions asynchronously against defined rubrics.

## 🚀 Key Features

- **Core & Probe Question Tracks**: 
  - **Core Track**: 4 structured, identical questions derived from the Job Description (JD) to ensure defensible, rankable candidate comparisons.
  - **Probe Track**: 2 dynamic questions generated from the candidate's resume match report to verify specific claims and follow up on competency gaps.
- **Client-Side Proctoring**: Monitors tab switches, focus changes, fullscreen status, and presence using MediaPipe Tasks Vision (runs in-browser without sending video feeds to the cloud).
- **Asynchronous AI Scoring**: Evaluates transcripts using Claude 3.5 Sonnet against custom rubrics. Computes weighted scores and provides transparent evidence quotes.
- **Recruiter Dashboard**: Integrates video playback, proctoring event timelines, synced transcript seeking, and candidate comparison.

---

## 🛠️ Stack & Architecture

- **Frontend/Backend**: Next.js 15 (App Router) + TypeScript
- **Styling**: Tailwind CSS
- **Database**: Neon (serverless PostgreSQL)
- **Storage**: Vercel Blob (video blobs)
- **Speech-to-Text**: Deepgram Nova (for fast, accurate batch transcription)
- **LLM**: Claude 3.5 Sonnet (for question generation and rubric grading)

---

## 📂 Repository Structure

```
├── PLAN.md                    # Phased build roadmap (read before starting any phase)
├── src/
│   ├── app/                   # Next.js App Router pages and layouts
│   └── lib/
│       ├── agents/            # Contracts + adapters for the JD parser, resume parser, readiness matcher
│       ├── db.ts               # Neon Postgres client
├── CLAUDE.md                  # LLM agent instructions & constraints
├── schema.sql                 # Neon Postgres schema
├── next.config.ts             # Next.js configuration
├── tailwind.config.ts         # Tailwind configuration
└── tsconfig.json              # TypeScript configuration
```

---

## 💻 Getting Started

### Prerequisites

- Node.js (v18.x or later)
- npm or yarn

### Installation

1. Clone the repository and navigate to the folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the development server:
   ```bash
   npm run dev
   ```
4. Build the application for production:
   ```bash
   npm run build
   ```