export function buildTimerPhases(spec) {
  if (!spec) return [];
  const phases = [];
  const prepare = Math.max(0, Number(spec.prepareSeconds) || 0);
  const rounds = Math.max(1, Math.round(Number(spec.rounds) || 1));
  const work = Math.max(1, Math.round(Number(spec.workSeconds) || 1));
  const rest = Math.max(0, Math.round(Number(spec.restSeconds) || 0));
  if (prepare) phases.push({ kind: "prepare", label: "Gjør deg klar", round: 0, seconds: prepare });
  for (let round = 1; round <= rounds; round += 1) {
    phases.push({ kind: "work", label: "Jobb", round, seconds: work });
    if (rest) phases.push({ kind: "rest", label: "Pause", round, seconds: rest });
  }
  return phases;
}

export function timerMoment(spec, elapsedMs) {
  const phases = buildTimerPhases(spec);
  const elapsedSeconds = Math.max(0, elapsedMs / 1000);
  const totalSeconds = phases.reduce((sum, phase) => sum + phase.seconds, 0);
  if (!phases.length || elapsedSeconds >= totalSeconds) {
    return {
      done: true,
      phase: null,
      phaseIndex: phases.length,
      remainingSeconds: 0,
      totalSeconds,
      elapsedSeconds: Math.min(elapsedSeconds, totalSeconds),
      progress: 1,
    };
  }
  let cursor = 0;
  for (let index = 0; index < phases.length; index += 1) {
    const phase = phases[index];
    const end = cursor + phase.seconds;
    if (elapsedSeconds < end) {
      const intoPhase = elapsedSeconds - cursor;
      return {
        done: false,
        phase,
        phaseIndex: index,
        remainingSeconds: Math.max(0, Math.ceil(end - elapsedSeconds)),
        totalSeconds,
        elapsedSeconds,
        progress: totalSeconds ? Math.min(1, elapsedSeconds / totalSeconds) : 0,
        phaseProgress: Math.min(1, intoPhase / phase.seconds),
      };
    }
    cursor = end;
  }
  return { done: true, phase: null, remainingSeconds: 0, totalSeconds, progress: 1 };
}

export function formatClock(totalSeconds) {
  const value = Math.max(0, Math.ceil(Number(totalSeconds) || 0));
  const minutes = Math.floor(value / 60);
  const seconds = value % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
