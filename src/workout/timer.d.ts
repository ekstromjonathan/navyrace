export type TimerSpec = {
  mode: "countdown" | "intervals" | "tabata";
  workSeconds: number;
  restSeconds: number;
  rounds: number;
  prepareSeconds?: number;
};

export type TimerPhase = {
  kind: "prepare" | "work" | "rest";
  label: string;
  round: number;
  seconds: number;
};

export function buildTimerPhases(spec: TimerSpec | null | undefined): TimerPhase[];
export function timerMoment(spec: TimerSpec | null | undefined, elapsedMs: number): {
  done: boolean;
  phase: TimerPhase | null;
  phaseIndex: number;
  remainingSeconds: number;
  totalSeconds: number;
  elapsedSeconds: number;
  progress: number;
  phaseProgress?: number;
};
export function formatClock(totalSeconds: number): string;
