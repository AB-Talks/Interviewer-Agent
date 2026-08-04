import Link from "next/link";

export default function Home() {
  return (
    <div className="flex-1 flex flex-col">
      {/* Hero */}
      <section className="relative overflow-hidden py-24 px-6">
        {/* Background glow effects like ABTalks */}
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-[#7364E6]/20 rounded-full blur-[120px] pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-72 h-72 bg-[#ec4899]/15 rounded-full blur-[100px] pointer-events-none" />

        <div className="max-w-4xl mx-auto text-center relative z-10 space-y-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#2C1BA9] bg-[#191B40] text-xs font-medium text-white/70">
            <span className="w-2 h-2 rounded-full bg-[#7364E6] animate-pulse" />
            AI-Powered Interview Screening
          </div>

          <h1 className="font-display text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.1]">
            Live AI Interviews.{" "}
            <br />
            <span className="bg-gradient-to-r from-[#7364E6] to-[#ec4899] bg-clip-text text-transparent">
              Defensible Decisions.
            </span>
          </h1>

          <p className="text-white-70 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
            A live AI interviewer talks to every candidate in real time, asking the same core questions
            plus adaptive follow-ups. Proctored, recorded for review, and evaluated against
            a calibrated rubric — a human recruiter always decides.
          </p>

          <div className="pt-4 flex flex-col sm:flex-row justify-center items-center gap-4">
            <Link
              href="/i/test-token"
              className="w-full sm:w-auto px-8 py-3.5 rounded-[10px] btn-gradient text-base font-semibold"
            >
              Try Demo Interview →
            </Link>
            <Link
              href="/admin"
              className="w-full sm:w-auto px-8 py-3.5 rounded-[10px] bg-[#403880] border border-[#2C1BA9] text-white font-medium btn-abtalks text-base"
            >
              Recruiter Dashboard
            </Link>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <h2 className="font-display text-2xl md:text-3xl font-bold text-center mb-12">
            How it works
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="card-abtalks rounded-2xl p-7 space-y-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#7364E6] to-[#403880] flex items-center justify-center text-white text-sm font-bold">
                01
              </div>
              <h3 className="text-lg font-semibold text-white">Core + Probe Tracks</h3>
              <p className="text-sm text-white-70 leading-relaxed">
                Identical core questions rank every candidate fairly; personalized probes verify
                specific resume claims — evidence for a recruiter, never a score alone.
              </p>
            </div>

            <div className="card-abtalks rounded-2xl p-7 space-y-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#f97316] to-[#ec4899] flex items-center justify-center text-white text-sm font-bold">
                02
              </div>
              <h3 className="text-lg font-semibold text-white">Advisory Proctoring</h3>
              <p className="text-sm text-white-70 leading-relaxed">
                Real-time browser activity and webcam presence logging support a human review —
                never an automatic rejection.
              </p>
            </div>

            <div className="card-abtalks rounded-2xl p-7 space-y-4">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#7364E6] to-[#ec4899] flex items-center justify-center text-white text-sm font-bold">
                03
              </div>
              <h3 className="text-lg font-semibold text-white">Calibration &amp; Rubrics</h3>
              <p className="text-sm text-white-70 leading-relaxed">
                Custom scoring dimensions based purely on the transcript. Weighted subscores are
                computed in code, never trusted from the model.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/30 py-8 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <span className="text-sm text-white-50">© 2026 ABTalks. All rights reserved.</span>
          <a
            href="mailto:team@abtalks.in"
            className="text-sm text-white-50 hover:text-white transition-colors"
          >
            team@abtalks.in
          </a>
        </div>
      </footer>
    </div>
  );
}
