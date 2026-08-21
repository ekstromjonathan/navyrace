import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  Timer as TimerIcon,
} from "lucide-react";
import { formatClock, timerMoment } from "./timer.js";

const token = decodeURIComponent(window.location.pathname.split("/").filter(Boolean).at(-1) || "");
const shortToken = token.slice(-16);
const CACHE_KEY = `lodd:workout:${shortToken}`;
const RUN_KEY = `lodd:workout-run:${shortToken}`;
const QUEUE_KEY = `lodd:workout-complete:${shortToken}`;

function readJson(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The loaded page still works when storage is unavailable.
  }
}

function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
  );
}

function responseError(response) {
  const error = new Error(`status:${response.status}`);
  error.status = response.status;
  return error;
}

async function postCompletion(payload) {
  const response = await fetch(`/api/workouts/${encodeURIComponent(token)}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw responseError(response);
  return response.json();
}

function validCachedWorkout() {
  const cached = readJson(CACHE_KEY, null);
  if (!cached?.expiresAt || Date.parse(cached.expiresAt) <= Date.now()) {
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    return null;
  }
  return cached;
}

function clearWorkoutStorage() {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(RUN_KEY);
    localStorage.removeItem(QUEUE_KEY);
  } catch {
    // Storage may be unavailable.
  }
}

function useWorkoutTimer(spec) {
  const stored = readJson(RUN_KEY, null);
  const [clock, setClock] = useState(
    stored?.timer ?? { status: "idle", elapsedMs: 0, startedAt: null },
  );
  const [, render] = useState(0);
  const phaseRef = useRef(-1);
  const audioRef = useRef(null);
  const wakeRef = useRef(null);

  const elapsedMs =
    clock.status === "running" && clock.startedAt
      ? clock.elapsedMs + Math.max(0, Date.now() - clock.startedAt)
      : clock.elapsedMs;
  const moment = timerMoment(spec, elapsedMs);

  useEffect(() => {
    if (clock.status !== "running") return undefined;
    const id = setInterval(() => render((n) => n + 1), 250);
    const visible = () => render((n) => n + 1);
    document.addEventListener("visibilitychange", visible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [clock.status]);

  useEffect(() => {
    writeJson(RUN_KEY, { ...readJson(RUN_KEY, {}), timer: clock });
  }, [clock]);

  useEffect(() => {
    if (clock.status !== "running" || moment.done) return;
    if (phaseRef.current >= 0 && phaseRef.current !== moment.phaseIndex) {
      try {
        const ctx = audioRef.current;
        if (ctx) {
          const oscillator = ctx.createOscillator();
          const gain = ctx.createGain();
          oscillator.frequency.value = moment.phase?.kind === "work" ? 880 : 560;
          gain.gain.setValueAtTime(0.0001, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
          oscillator.connect(gain).connect(ctx.destination);
          oscillator.start();
          oscillator.stop(ctx.currentTime + 0.13);
        }
        navigator.vibrate?.(moment.phase?.kind === "work" ? 30 : 15);
      } catch {
        // Sound and haptics are progressive enhancement.
      }
    }
    phaseRef.current = moment.phaseIndex;
  }, [clock.status, moment.done, moment.phaseIndex, moment.phase?.kind]);

  useEffect(() => {
    if (clock.status !== "running" || !navigator.wakeLock?.request) return undefined;
    let active = true;
    navigator.wakeLock.request("screen").then((lock) => {
      if (active) wakeRef.current = lock;
      else lock.release().catch(() => {});
    }).catch(() => {});
    return () => {
      active = false;
      wakeRef.current?.release?.().catch(() => {});
      wakeRef.current = null;
    };
  }, [clock.status]);

  useEffect(() => {
    if (moment.done && clock.status === "running") {
      setClock({ status: "done", elapsedMs: moment.totalSeconds * 1000, startedAt: null });
    }
  }, [clock.status, moment.done, moment.totalSeconds]);

  function start() {
    try {
      audioRef.current ??= new (window.AudioContext || window.webkitAudioContext)();
      audioRef.current.resume?.();
    } catch {
      // No sound support; timer remains fully usable.
    }
    phaseRef.current = -1;
    setClock((value) => ({
      status: "running",
      elapsedMs: value.status === "done" ? 0 : value.elapsedMs,
      startedAt: Date.now(),
    }));
  }

  function pause() {
    setClock({ status: "paused", elapsedMs, startedAt: null });
  }

  function reset() {
    phaseRef.current = -1;
    setClock({ status: "idle", elapsedMs: 0, startedAt: null });
  }

  return { clock, moment, start, pause, reset };
}

function TimerBlock({ block }) {
  const timer = useWorkoutTimer(block.timer);
  const phase = timer.moment.phase;
  const running = timer.clock.status === "running";
  return (
    <section className={`timer-card ${phase?.kind || "idle"}`} aria-label={block.title}>
      <div className="section-kicker"><TimerIcon size={14} /> {block.title}</div>
      <div className="timer-meta">
        <span>{phase?.label || (timer.moment.done ? "Ferdig" : "Klar")}</span>
        {phase?.round ? <span>Runde {phase.round} / {block.timer.rounds}</span> : null}
      </div>
      <div className="timer-time" aria-live="polite">{formatClock(timer.moment.remainingSeconds)}</div>
      <progress className="timer-track" max="1" value={timer.moment.progress || 0} aria-label="Total fremdrift" />
      <div className="timer-actions">
        <button className="icon-button" type="button" onClick={timer.reset} aria-label="Start klokka på nytt">
          <RotateCcw size={19} />
        </button>
        <button className="timer-primary" type="button" onClick={running ? timer.pause : timer.start}>
          {running ? <Pause size={19} /> : <Play size={19} />}
          {running ? "Pause" : timer.moment.done ? "Kjør igjen" : timer.clock.status === "paused" ? "Fortsett" : "Start"}
        </button>
      </div>
    </section>
  );
}

function ExerciseList({ exercises, completed, onToggle }) {
  return (
    <div className="exercise-list">
      {exercises.map((exercise) => {
        const done = completed.has(exercise.id);
        return (
          <button
            type="button"
            className={`exercise-row ${done ? "done" : ""}`}
            key={exercise.id}
            aria-pressed={done}
            onClick={() => onToggle(exercise.id)}
          >
            <span className="exercise-check" aria-hidden="true">{done ? <Check size={17} /> : null}</span>
            <span className="exercise-copy">
              <strong>{exercise.name}</strong>
              {exercise.cue ? <span>{exercise.cue}</span> : null}
            </span>
            {exercise.detail ? <span className="exercise-dose">{exercise.detail}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

function Feedback({ sending, error, onSubmit }) {
  const [quality, setQuality] = useState("");
  const [body, setBody] = useState("");
  const [note, setNote] = useState("");
  return (
    <main className="workout-shell state-page">
      <header className="compact-header">
        <p className="wordmark">lodd.ai</p>
        <p>Økta er gjennomført</p>
      </header>
      <section className="feedback-heading">
        <span className="success-mark"><Check size={24} /></span>
        <h1>Hvordan traff økta?</h1>
        <p>To raske signaler gjør neste økt bedre.</p>
      </section>
      <fieldset className="choice-group">
        <legend>Innsats</legend>
        {[
          ["lett", "Lett", "Kunne gjort mer"],
          ["passe", "Passe", "Riktig dose"],
          ["brutalt", "Brutalt", "For tungt i dag"],
        ].map(([value, label, detail]) => (
          <button type="button" key={value} aria-pressed={quality === value} onClick={() => setQuality(value)}>
            <span><strong>{label}</strong><small>{detail}</small></span>
            <span className="radio-dot" />
          </button>
        ))}
      </fieldset>
      <fieldset className="choice-group">
        <legend>Kroppen</legend>
        {[
          ["good", "Bra", "Ingen problemer"],
          ["tight", "Stram", "Støl eller stiv"],
          ["pain", "Vondt", "Ny eller økende smerte"],
        ].map(([value, label, detail]) => (
          <button type="button" key={value} aria-pressed={body === value} onClick={() => setBody(value)}>
            <span><strong>{label}</strong><small>{detail}</small></span>
            <span className="radio-dot" />
          </button>
        ))}
      </fieldset>
      <label className="note-field">
        <span>Noe coachen bør vite? <small>Valgfritt</small></span>
        <textarea value={note} maxLength={280} onChange={(event) => setNote(event.target.value)} placeholder="Kort kommentar" />
      </label>
      <button
        type="button"
        className="primary-button"
        disabled={!quality || !body || sending}
        onClick={() => onSubmit({ quality, body, note, clientCompletionId: createId() })}
      >
        {sending ? "Lagrer …" : "Lagre hos coachen"} <ChevronRight size={18} />
      </button>
      {error ? <p className="submit-error" role="alert">{error}</p> : null}
      <p className="privacy-note">Tilbakemeldingen lagres i den private coach-journalen.</p>
    </main>
  );
}

function Completed({ queued = false }) {
  return (
    <main className="workout-shell state-page complete-page">
      <p className="wordmark">lodd.ai</p>
      <span className="success-mark large"><Check size={30} /></span>
      <h1>{queued ? "Lagret på telefonen" : "Økta er logget"}</h1>
      <p>
        {queued
          ? "Vi sender den til coachen så snart nettet er tilbake."
          : "Coachen har økta og bruker svaret når neste økt tilpasses."}
      </p>
      <div className="completion-rule" />
      <p className="quiet">Du kan lukke siden og fortsette i iMessage.</p>
    </main>
  );
}

function ErrorState({ offline = false }) {
  return (
    <main className="workout-shell state-page error-page">
      <p className="wordmark">lodd.ai</p>
      <h1>{offline ? "Ingen forbindelse" : "Denne øktlenken virker ikke lenger"}</h1>
      <p>{offline ? "Koble til nettet og prøv igjen." : "Be coachen sende dagens økt på nytt i iMessage."}</p>
      <button className="secondary-button" type="button" onClick={() => window.location.reload()}>Prøv igjen</button>
    </main>
  );
}

export default function WorkoutApp() {
  const [resource, setResource] = useState({ state: "loading", data: null });
  const storedRun = readJson(RUN_KEY, { completed: [] });
  const [completed, setCompleted] = useState(new Set(storedRun.completed || []));
  const [view, setView] = useState("workout");
  const [sending, setSending] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/workouts/${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw responseError(response);
        return response.json();
      })
      .then((data) => {
        if (cancelled) return;
        writeJson(CACHE_KEY, data);
        setResource({ state: "ready", data });
        if (data.completed) {
          clearWorkoutStorage();
          setView("complete");
        }
      })
      .catch((error) => {
        if (cancelled) return;
        if (error.status) {
          clearWorkoutStorage();
          setResource({ state: "invalid", error });
          return;
        }
        const cached = validCachedWorkout();
        if (cached) setResource({ state: "ready", data: cached });
        else setResource({ state: navigator.onLine ? "invalid" : "offline", error });
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let active = true;
    async function flush() {
      const queued = readJson(QUEUE_KEY, null);
      if (!queued?.payload || !navigator.onLine) return;
      setView("queued");
      try {
        await postCompletion(queued.payload);
        if (!active) return;
        clearWorkoutStorage();
        setView("complete");
      } catch (error) {
        if (!active) return;
        if (error.status) {
          clearWorkoutStorage();
          setResource({ state: "invalid", error });
          setView("invalid");
        }
      }
    }
    const queued = readJson(QUEUE_KEY, null);
    if (queued?.payload) setView("queued");
    void flush();
    window.addEventListener("online", flush);
    return () => {
      active = false;
      window.removeEventListener("online", flush);
    };
  }, []);

  const workout = resource.data?.workout;
  const exercises = useMemo(
    () => workout?.blocks?.flatMap((block) => block.exercises || []) ?? [],
    [workout],
  );

  function toggleExercise(id) {
    setCompleted((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writeJson(RUN_KEY, { ...readJson(RUN_KEY, {}), completed: [...next] });
      return next;
    });
  }

  async function submitFeedback(payload) {
    setSending(true);
    setSubmitError("");
    try {
      await postCompletion(payload);
      clearWorkoutStorage();
      setView("complete");
    } catch (error) {
      if (!error.status) {
        writeJson(QUEUE_KEY, { payload, queuedAt: new Date().toISOString() });
        setView("queued");
      } else if (error.status === 404) {
        clearWorkoutStorage();
        setResource({ state: "invalid", error });
        setView("invalid");
      } else {
        setSubmitError("Kunne ikke lagre nå. Prøv igjen.");
      }
    } finally {
      setSending(false);
    }
  }

  if (resource.state === "loading") {
    return <main className="workout-shell loading"><p className="wordmark">lodd.ai</p><div className="loading-line" /><div className="loading-card" /></main>;
  }
  if (resource.state === "invalid" || resource.state === "offline") {
    return <ErrorState offline={resource.state === "offline"} />;
  }
  if (view === "feedback") return <Feedback sending={sending} error={submitError} onSubmit={submitFeedback} />;
  if (view === "complete") return <Completed />;
  if (view === "queued") return <Completed queued />;
  if (view === "invalid") return <ErrorState />;

  return (
    <main className="workout-shell">
      <header className="workout-header">
        <p className="wordmark">lodd.ai</p>
        <div className="session-meta">
          <span>{workout.localDate}</span>
          {workout.estimate ? <span>{workout.estimate}</span> : null}
        </div>
        <h1>{workout.title}</h1>
        <p className="reason">{workout.reason}</p>
      </header>

      <div className="workout-content">
        {workout.blocks.map((block) => {
          if (block.timer) return <TimerBlock block={block} key={block.id} />;
          if (block.exercises?.length) {
            return (
              <section className="content-section" key={block.id}>
                <div className="section-heading">
                  <span>{block.title}</span>
                  <small>{completed.size} / {exercises.length}</small>
                </div>
                {block.detail ? <p>{block.detail}</p> : null}
                <ExerciseList exercises={block.exercises} completed={completed} onToggle={toggleExercise} />
              </section>
            );
          }
          return (
            <section className={`content-section ${block.kind}`} key={block.id}>
              <div className="section-heading"><span>{block.title}</span></div>
              {block.detail ? <p>{block.detail}</p> : null}
            </section>
          );
        })}
      </div>

      <footer className="workout-footer">
        <button type="button" className="primary-button" onClick={() => setView("feedback")}>
          Fullfør økta <ChevronRight size={18} />
        </button>
        <p>{completed.size}/{exercises.length || "–"} øvelser markert</p>
      </footer>
    </main>
  );
}
