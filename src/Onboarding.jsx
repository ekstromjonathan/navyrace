import React, { useState, useEffect, useRef, useCallback } from "react";
import { ChevronRight, Wind, RotateCcw } from "lucide-react";
import { defaultBrand } from "./state.js";

const GOALS = [
  { kind: "navy_race", label: "Navy Race" },
  { kind: "run_5_10", label: "5–10 km løp" },
  { kind: "strength_obstacle", label: "Styrke & hinder" },
  { kind: "general", label: "Generell form" },
  { kind: "general", label: "Annet", other: true },
];

const LEVELS = [
  { id: "new", label: "Ny" },
  { id: "some", label: "Har trent litt" },
  { id: "solid", label: "Solid base" },
  { id: "other_sport", label: "Annen idrett" },
];

const EQUIP = [
  { id: "bodyweight", label: "Kroppsvekt" },
  { id: "kb", label: "Kettlebell" },
  { id: "plates", label: "Vektplater" },
  { id: "pullup", label: "Pull-up / ringer" },
  { id: "bench", label: "Stol / benk" },
  { id: "outdoor_run", label: "Utendørs løp" },
  { id: "terrain", label: "Terreng" },
  { id: "gym", label: "Treningsstudio" },
];

const WEEKS = [4, 6, 8, 10, 12];
const CORE_TURNS = 4; /* goal, schedule, level, equip — brand is soft intro */

let msgSeq = 0;
function mid() {
  msgSeq += 1;
  return `m${msgSeq}`;
}

/** @returns profile object ready to persist */
export function buildProfileFromDraft(d) {
  const brand = {
    appName: (d.appName || "MAI TRAINER").trim() || "MAI TRAINER",
    coachName: (d.coachName || "MAI").trim() || "MAI",
  };
  return {
    brand,
    goal: {
      kind: d.goalKind || "general",
      label: d.goalLabel || GOALS.find((g) => g.kind === d.goalKind && !g.other)?.label || "Trening",
      date: d.goalDate || null,
      weeks: d.weeks || 10,
    },
    startedAt: Date.now(),
    level: d.level || "some",
    schedule: {
      daysPerWeek: d.daysPerWeek || 4,
      mode: d.mode || "flexible",
    },
    equipment: d.equipment?.length ? d.equipment : ["bodyweight", "outdoor_run"],
    body: d.bodyWeight || d.bodyHeight
      ? { weightKg: d.bodyWeight || null, heightCm: d.bodyHeight || null }
      : null,
    constraints: d.constraints || [],
    coachSummary: [
      brand.coachName,
      d.goalLabel || d.goalKind,
      `${d.weeks || 10} uker`,
      `${d.daysPerWeek || 4} d/uke`,
      d.mode === "calendar" ? "kalender" : "fleksibel",
      d.level,
    ].filter(Boolean).join(" · "),
  };
}

function Chip({ on, children, onClick, disabled }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`ob-chip${on ? " on" : ""}`}
    >
      {children}
    </button>
  );
}

function TypingDots() {
  return (
    <div className="ob-typing" aria-label="Skriver">
      <span /><span /><span />
    </div>
  );
}

function CoachAvatar({ name }) {
  const letter = (name || "M").trim().charAt(0).toUpperCase() || "M";
  return <div className="ob-avatar" aria-hidden>{letter}</div>;
}

export function Welcome({ coachName, appName, cloudEnabled, onStart, onLogin }) {
  const name = coachName || "MAI";
  return (
    <div className="nr-root">
      <div className="nr-noise" />
      <div className="nr-wrap ob-welcome">
        <div className="fade ob-welcome-inner">
          <div className="tag" style={{ justifyContent: "center", marginBottom: 22 }}>
            <Wind size={12} /> {appName || "MAI TRAINER"}
          </div>
          <div className="ob-welcome-preview">
            <div className="ob-row coach">
              <CoachAvatar name={name} />
              <div className="ob-bubble-card coach">
                <div className="ob-who">{name}</div>
                <div className="ob-text">
                  Hei — jeg er {name}. Fortell meg hva du trener mot, så bygger vi et program som faktisk passer deg.
                </div>
              </div>
            </div>
          </div>
          <button className="cta" onClick={onStart} style={{ marginTop: 28 }}>
            Snakk med {name} <ChevronRight size={18} />
          </button>
          {cloudEnabled && (
            <button className="skipbtn" onClick={onLogin} style={{ marginTop: 12 }}>
              Jeg har allerede konto
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Conversational coach — transcript + chip composer.
 * onComplete(profile).
 */
export function Coach({ onComplete }) {
  const [d, setD] = useState({
    appName: "MAI TRAINER",
    coachName: "MAI",
    goalKind: null,
    goalLabel: "",
    otherLabel: "",
    weeks: 10,
    goalDate: "",
    daysPerWeek: 4,
    mode: "flexible",
    level: null,
    equipment: ["bodyweight"],
    bodyWeight: "",
    bodyHeight: "",
    pickingOther: false,
  });
  const [turn, setTurn] = useState("boot");
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef(null);
  const draft = useRef(d);
  const booted = useRef(false);
  draft.current = d;

  const coach = d.coachName || "MAI";
  const set = (patch) => setD((x) => ({ ...x, ...patch }));

  const scrollBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => { scrollBottom(); }, [messages, typing, turn, scrollBottom]);

  const pushCoach = useCallback((text, delay = 520) => new Promise((resolve) => {
    setTyping(true);
    setBusy(true);
    window.setTimeout(() => {
      setTyping(false);
      setMessages((m) => [...m, { id: mid(), role: "coach", text }]);
      setBusy(false);
      resolve();
    }, delay);
  }), []);

  const pushUser = useCallback((text) => {
    setMessages((m) => [...m, { id: mid(), role: "user", text }]);
  }, []);

  /* Boot: opening lines (guard against StrictMode double-mount). */
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      await pushCoach(
        `Hei — jeg er ${draft.current.coachName || "MAI"}. Jeg blir treneren din her. Skal vi beholde navnene, eller vil du endre?`,
        380,
      );
      setTurn("brand");
    })();
  }, [pushCoach]);

  const coreDone = d.goalKind && d.level && d.equipment.length > 0;

  async function afterBrand() {
    const c = draft.current.coachName || "MAI";
    const a = draft.current.appName || "MAI TRAINER";
    pushUser(c === "MAI" && a === "MAI TRAINER" ? "Behold MAI TRAINER / MAI" : `${a} · ${c}`);
    setTurn("wait");
    await pushCoach(
      `Supert — jeg er ${c}. Hva trener du mot, og innen når? Velg mål og varighet.`,
      480,
    );
    setTurn("goal");
  }

  async function afterGoal() {
    const cur = draft.current;
    const label = cur.pickingOther && cur.otherLabel
      ? cur.otherLabel
      : cur.goalLabel || "målet ditt";
    const dateBit = cur.goalDate ? ` · måldato ${cur.goalDate}` : "";
    pushUser(`${label} · ${cur.weeks} uker${dateBit}`);
    setTurn("wait");
    await pushCoach(
      `${label} på ${cur.weeks} uker — notert. Hvor mange dager i uka er realistisk, og vil du følge kalenderen eller ta neste økt når du er klar?`,
      560,
    );
    setTurn("schedule");
  }

  async function afterSchedule() {
    const cur = draft.current;
    const modeLabel = cur.mode === "calendar" ? "kalender (man = man)" : "fleksibelt";
    pushUser(`${cur.daysPerWeek} dager · ${modeLabel}`);
    setTurn("wait");
    await pushCoach(
      `${cur.daysPerWeek} dager, ${modeLabel}. Nivå akkurat nå — helt ærlig?`,
      480,
    );
    setTurn("level");
  }

  async function afterLevel(levelId) {
    const lvl = LEVELS.find((l) => l.id === levelId);
    pushUser(lvl?.label || levelId);
    setTurn("wait");
    const nudge = levelId === "new"
      ? "Da starter vi rolig og bygger opp."
      : levelId === "solid"
        ? "Da kan vi presse litt mer."
        : "Bra — da tilpasser vi dosen etter hvert.";
    await pushCoach(
      `${lvl?.label}. ${nudge} Hva har du tilgang til? Velg alt som gjelder — trykk «Ferdig» når du er klar.`,
      560,
    );
    setTurn("equip");
  }

  async function afterEquip() {
    const cur = draft.current;
    const labels = cur.equipment
      .map((id) => EQUIP.find((e) => e.id === id)?.label)
      .filter(Boolean);
    pushUser(labels.join(" · ") || "Kroppsvekt");
    setTurn("wait");
    await pushCoach(
      "To ting til hvis du vil ha skarpere dose — vekt og høyde. Ellers hopper vi til oppsummering.",
      500,
    );
    setTurn("extras");
  }

  async function goSummary(skipBody) {
    if (!skipBody) {
      const cur = draft.current;
      const bits = [];
      if (cur.bodyWeight) bits.push(`${cur.bodyWeight} kg`);
      if (cur.bodyHeight) bits.push(`${cur.bodyHeight} cm`);
      pushUser(bits.length ? bits.join(" · ") : "Hopp over");
    } else {
      pushUser("Hopp over");
    }
    setTurn("wait");
    const cur = draft.current;
    const goal = cur.pickingOther && cur.otherLabel ? cur.otherLabel : cur.goalLabel;
    const lvl = LEVELS.find((l) => l.id === cur.level)?.label;
    const mode = cur.mode === "calendar" ? "kalender" : "fleksibelt";
    const eq = cur.equipment
      .map((id) => EQUIP.find((e) => e.id === id)?.label)
      .filter(Boolean)
      .slice(0, 4)
      .join(", ");
    await pushCoach(
      `Sånn hørte jeg deg: ${goal} over ${cur.weeks} uker, ${cur.daysPerWeek} dager ${mode}, nivå «${lvl}», med ${eq || "det du har"}. Stemmer det?`,
      640,
    );
    setTurn("summary");
  }

  function finish() {
    const cur = draft.current;
    const profile = buildProfileFromDraft({
      ...cur,
      goalLabel: cur.goalKind === "general" && cur.otherLabel
        ? cur.otherLabel
        : cur.goalLabel || GOALS.find((g) => g.kind === cur.goalKind)?.label,
      bodyWeight: cur.bodyWeight ? Number(cur.bodyWeight) : null,
      bodyHeight: cur.bodyHeight ? Number(cur.bodyHeight) : null,
    });
    onComplete(profile);
  }

  function restart() {
    msgSeq = 0;
    setMessages([]);
    setD({
      appName: "MAI TRAINER",
      coachName: "MAI",
      goalKind: null,
      goalLabel: "",
      otherLabel: "",
      weeks: 10,
      goalDate: "",
      daysPerWeek: 4,
      mode: "flexible",
      level: null,
      equipment: ["bodyweight"],
      bodyWeight: "",
      bodyHeight: "",
      pickingOther: false,
    });
    setTurn("boot");
    setTyping(false);
    setBusy(false);
    window.setTimeout(async () => {
      await pushCoach(
        `Hei — jeg er MAI. Jeg blir treneren din her. Skal vi beholde navnene, eller vil du endre?`,
        380,
      );
      setTurn("brand");
    }, 40);
  }

  const answered = [d.goalKind, d.daysPerWeek && d.mode, d.level, d.equipment.length]
    .filter(Boolean).length;
  const dots = Math.min(answered, CORE_TURNS);

  return (
    <div className="nr-root">
      <div className="nr-noise" />
      <div className="ob-chat">
        <header className="ob-chat-head">
          <div className="ob-chat-head-left">
            <CoachAvatar name={coach} />
            <div>
              <div className="ob-chat-name">{coach}</div>
              <div className="ob-chat-sub mono">Din trener</div>
            </div>
          </div>
          <div className="ob-dots" aria-label={`Steg ${dots} av ${CORE_TURNS}`}>
            {Array.from({ length: CORE_TURNS }, (_, i) => (
              <span key={i} className={i < dots ? "on" : ""} />
            ))}
          </div>
        </header>

        <div className="ob-transcript" ref={scrollRef}>
          {messages.map((m) => (
            <div key={m.id} className={`ob-row ${m.role === "coach" ? "coach" : "user"}`}>
              {m.role === "coach" && <CoachAvatar name={coach} />}
              <div className={`ob-bubble-card ${m.role === "coach" ? "coach" : "user"}`}>
                {m.role === "coach" && <div className="ob-who">{coach}</div>}
                <div className="ob-text">{m.text}</div>
              </div>
            </div>
          ))}
          {typing && (
            <div className="ob-row coach">
              <CoachAvatar name={coach} />
              <div className="ob-bubble-card coach typing">
                <TypingDots />
              </div>
            </div>
          )}
        </div>

        <div className="ob-composer">
          {turn === "brand" && !busy && (
            <>
              <div className="ob-fields">
                <label className="ob-label">App</label>
                <input className="tinput" value={d.appName} onChange={(e) => set({ appName: e.target.value })} />
                <label className="ob-label">Trener</label>
                <input className="tinput" value={d.coachName} onChange={(e) => set({ coachName: e.target.value })} />
              </div>
              <div className="ob-chips">
                <Chip on onClick={afterBrand}>Behold defaults · videre</Chip>
                <Chip on={false} onClick={afterBrand}>Bruk navnene over</Chip>
              </div>
            </>
          )}

          {turn === "goal" && !busy && (
            <>
              <div className="ob-chips">
                {GOALS.map((g) => {
                  const selected = g.other
                    ? d.goalKind === "general" && d.pickingOther
                    : d.goalKind === g.kind && !d.pickingOther;
                  return (
                    <Chip
                      key={g.label}
                      on={selected}
                      onClick={() => {
                        if (g.other) set({ goalKind: "general", goalLabel: "Annet", pickingOther: true });
                        else set({ goalKind: g.kind, goalLabel: g.label, otherLabel: "", pickingOther: false });
                      }}
                    >
                      {g.label}
                    </Chip>
                  );
                })}
              </div>
              {d.pickingOther && (
                <input
                  className="tinput"
                  style={{ marginTop: 10 }}
                  placeholder="F.eks. Triatlon"
                  value={d.otherLabel}
                  onChange={(e) => set({ otherLabel: e.target.value, goalLabel: e.target.value || "Annet" })}
                />
              )}
              <div className="ob-label" style={{ marginTop: 14 }}>Varighet</div>
              <div className="ob-chips">
                {WEEKS.map((w) => (
                  <Chip key={w} on={d.weeks === w} onClick={() => set({ weeks: w })}>{w} uker</Chip>
                ))}
              </div>
              <label className="ob-label">Måldato (valgfritt)</label>
              <input className="tinput" type="date" value={d.goalDate} onChange={(e) => set({ goalDate: e.target.value })} />
              <button
                className="cta ob-composer-cta"
                disabled={!d.goalKind || (d.pickingOther && !d.otherLabel.trim())}
                onClick={afterGoal}
              >
                Send til {coach}
              </button>
            </>
          )}

          {turn === "schedule" && !busy && (
            <>
              <div className="ob-chips">
                {[3, 4, 5, 6].map((n) => (
                  <Chip key={n} on={d.daysPerWeek === n} onClick={() => set({ daysPerWeek: n })}>{n} dager</Chip>
                ))}
              </div>
              <div className="ob-chips" style={{ marginTop: 10 }}>
                <Chip on={d.mode === "calendar"} onClick={() => set({ mode: "calendar" })}>
                  Kalender · man = man
                </Chip>
                <Chip on={d.mode === "flexible"} onClick={() => set({ mode: "flexible" })}>
                  Fleksibel · når du er klar
                </Chip>
              </div>
              <button className="cta ob-composer-cta" onClick={afterSchedule}>
                Send til {coach}
              </button>
            </>
          )}

          {turn === "level" && !busy && (
            <div className="ob-chips">
              {LEVELS.map((l) => (
                <Chip key={l.id} on={d.level === l.id} onClick={() => { set({ level: l.id }); afterLevel(l.id); }}>
                  {l.label}
                </Chip>
              ))}
            </div>
          )}

          {turn === "equip" && !busy && (
            <>
              <div className="ob-chips">
                {EQUIP.map((e) => {
                  const on = d.equipment.includes(e.id);
                  return (
                    <Chip
                      key={e.id}
                      on={on}
                      onClick={() => set({
                        equipment: on
                          ? d.equipment.filter((x) => x !== e.id)
                          : [...d.equipment, e.id],
                      })}
                    >
                      {e.label}
                    </Chip>
                  );
                })}
              </div>
              <button
                className="cta ob-composer-cta"
                disabled={!d.equipment.length}
                onClick={afterEquip}
              >
                Ferdig · videre
              </button>
            </>
          )}

          {turn === "extras" && !busy && (
            <>
              <div className="ob-fields">
                <label className="ob-label">Vekt (kg)</label>
                <input className="tinput" inputMode="decimal" value={d.bodyWeight} onChange={(e) => set({ bodyWeight: e.target.value })} />
                <label className="ob-label">Høyde (cm)</label>
                <input className="tinput" inputMode="decimal" value={d.bodyHeight} onChange={(e) => set({ bodyHeight: e.target.value })} />
              </div>
              <div className="ob-chips">
                <Chip on onClick={() => goSummary(false)}>Send til {coach}</Chip>
                <Chip on={false} onClick={() => goSummary(true)}>Hopp over</Chip>
              </div>
            </>
          )}

          {turn === "summary" && !busy && (
            <div className="ob-chips">
              <Chip on disabled={!coreDone} onClick={finish}>
                Ja — bygg programmet mitt
              </Chip>
              <Chip on={false} onClick={restart}>
                <RotateCcw size={12} style={{ marginRight: 6, verticalAlign: -1 }} />
                Start samtalen på nytt
              </Chip>
            </div>
          )}

          {(turn === "boot" || turn === "wait" || busy) && (
            <div className="ob-composer-idle mono">
              {typing ? `${coach} skriver…` : " "}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export { defaultBrand };
