import { createValidator } from "../schemas/validator.js";

export type ConfidenceSignal = {
  name: string;
  value: number;
  weight: number;
};

export type ConfidenceReport = {
  score: number;
  decision: "accept" | "accept_with_caveat" | "retry" | "ask_user" | "escalate" | "block";
  signals: ConfidenceSignal[];
  summary?: string;
};

export function scoreConfidence(args: {
  verificationPassed: boolean;
  scopeClean: boolean;
  riskFlags: string[];
  repeatedFailureCount?: number;
  evidenceFresh: boolean;
}): ConfidenceReport {
  const signals: ConfidenceSignal[] = [
    { name: "verification_passed", value: args.verificationPassed ? 1 : 0, weight: 45 },
    { name: "scope_clean", value: args.scopeClean ? 1 : 0, weight: 25 },
    { name: "evidence_fresh", value: args.evidenceFresh ? 1 : 0, weight: 20 },
    { name: "risk_penalty", value: args.riskFlags.length === 0 ? 1 : Math.max(0, 1 - args.riskFlags.length * 0.15), weight: 10 },
  ];
  const score = Math.round(signals.reduce((sum, signal) => sum + signal.value * signal.weight, 0));
  const repeatedFailures = args.repeatedFailureCount ?? 0;
  const decision: ConfidenceReport["decision"] =
    !args.evidenceFresh ? "block" :
    !args.scopeClean ? "retry" :
    repeatedFailures >= 2 ? "escalate" :
    args.verificationPassed && score >= 80 ? "accept" :
    args.verificationPassed ? "accept_with_caveat" :
    "retry";
  const report: ConfidenceReport = {
    score,
    decision,
    signals,
    summary: `decision=${decision}; score=${score}`,
  };
  createValidator().assert("ConfidenceReport", report);
  return report;
}
