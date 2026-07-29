import React from "react";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col justify-center items-center px-4 relative overflow-hidden bg-slate-950 text-slate-100 py-16">
      {/* Decorative background glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/3 w-[300px] h-[300px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="max-w-4xl w-full text-center z-10 space-y-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-xs font-medium text-indigo-400 mb-4 animate-fade-in">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          AI Interview Platform
        </div>
        
        <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-200 via-slate-100 to-indigo-200 pb-2">
          Autonomous Screening. <br />
          <span className="bg-gradient-to-r from-indigo-400 to-emerald-400 bg-clip-text text-transparent">Defensible Decisions.</span>
        </h1>
        
        <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto font-light leading-relaxed">
          Structured asynchronous video interviews calibrated with custom rubrics. Proctored client-side, transcribed, and evaluated without bias.
        </p>

        <div className="pt-8 flex flex-col sm:flex-row justify-center items-center gap-4">
          <a
            href="/admin"
            className="w-full sm:w-auto px-8 py-3.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white font-medium rounded-xl shadow-lg shadow-indigo-500/25 transition-all hover:-translate-y-0.5"
          >
            Recruiter Dashboard
          </a>
          <a
            href="/i/test-token"
            className="w-full sm:w-auto px-8 py-3.5 bg-slate-900 hover:bg-slate-850 text-slate-300 font-medium rounded-xl border border-slate-800 hover:border-slate-700 transition-all hover:-translate-y-0.5"
          >
            Demo Candidate Flow
          </a>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-16 text-left">
          <div className="p-6 bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-900 hover:border-slate-800 transition-all duration-350">
            <div className="w-10 h-10 rounded-lg bg-indigo-500/10 flex items-center justify-center text-indigo-400 mb-4 font-bold text-lg">
              01
            </div>
            <h3 className="text-lg font-semibold text-slate-200 mb-2">Structured Tracks</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Standard core questions evaluate all candidates equally, coupled with tailored probes mapping back to resumes.
            </p>
          </div>

          <div className="p-6 bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-900 hover:border-slate-800 transition-all duration-350">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400 mb-4 font-bold text-lg">
              02
            </div>
            <h3 className="text-lg font-semibold text-slate-200 mb-2">Advisory Proctoring</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Real-time browser activity logging checks focus, screen changes, and webcam presence without invasive blocks.
            </p>
          </div>

          <div className="p-6 bg-slate-900/50 backdrop-blur-md rounded-2xl border border-slate-900 hover:border-slate-800 transition-all duration-350">
            <div className="w-10 h-10 rounded-lg bg-violet-500/10 flex items-center justify-center text-violet-400 mb-4 font-bold text-lg">
              03
            </div>
            <h3 className="text-lg font-semibold text-slate-200 mb-2">Calibration & Rubrics</h3>
            <p className="text-sm text-slate-400 leading-relaxed">
              Custom scoring dimensions based purely on transcripts. Weighted subscores avoid bias and ensure defensibility.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
