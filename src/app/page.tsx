import Link from "next/link";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col justify-center items-center px-4 bg-background text-foreground py-16 font-sans">
      <div className="max-w-4xl w-full text-center space-y-8">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary border border-border text-xs font-medium text-primary mb-4">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          AI Interview Platform
        </div>

        <h1 className="font-display text-4xl md:text-6xl font-extrabold tracking-tight pb-2">
          Live AI Interviews. <br />
          <span className="text-primary">Defensible Decisions.</span>
        </h1>

        <p className="text-muted-foreground text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
          A live AI interviewer talks to every candidate in real time, asking the same core questions
          plus adaptive follow-ups grounded in their resume. Proctored client-side, recorded for
          review, and evaluated against a calibrated rubric — a human recruiter always decides.
        </p>

        <div className="pt-8 flex flex-col sm:flex-row justify-center items-center gap-4">
          <Link
            href="/admin"
            className="w-full sm:w-auto px-8 py-3.5 bg-primary text-primary-foreground font-medium rounded-xl shadow-lg hover:opacity-90 transition-all"
          >
            Recruiter Dashboard
          </Link>
          <Link
            href="/i/test-token"
            className="w-full sm:w-auto px-8 py-3.5 bg-secondary hover:bg-accent text-secondary-foreground font-medium rounded-xl border border-border transition-all"
          >
            Demo Candidate Flow
          </Link>
        </div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-16 text-left">
          <div className="p-6 bg-card rounded-2xl border border-border">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 font-bold text-lg">
              01
            </div>
            <h3 className="text-lg font-semibold mb-2">Core + Probe Tracks</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Identical core questions rank every candidate fairly; personalized probes verify
              specific resume claims and gaps — evidence for a recruiter, never a score.
            </p>
          </div>

          <div className="p-6 bg-card rounded-2xl border border-border">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 font-bold text-lg">
              02
            </div>
            <h3 className="text-lg font-semibold mb-2">Advisory Proctoring</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Real-time browser activity and webcam presence logging support a human review —
              never an automatic rejection.
            </p>
          </div>

          <div className="p-6 bg-card rounded-2xl border border-border">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary mb-4 font-bold text-lg">
              03
            </div>
            <h3 className="text-lg font-semibold mb-2">Calibration & Rubrics</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Custom scoring dimensions based purely on the transcript. Weighted subscores are
              computed in code, never trusted from the model.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
