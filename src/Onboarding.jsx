import React, { useState, useEffect, useRef, useCallback } from "react";
import { RotateCcw } from "lucide-react";
import { defaultBrand, weeksFromDate } from "./state.js";
import * as cloud from "./cloud.js";

const COACH_PRESETS = ["MAI", "Kai", "Nora"];

const GOALS = [
  { kind: "navy_race", label: "Hinderløp / OCR" },
  { kind: "run_5_10", label: "5–10 km løp" },
  { kind: "strength_obstacle", label: "Styrke & funksjonelt" },
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

function resolvePeriod(d) {
  if (d.periodMode === "date" && d.goalDate) {
    const weeks = weeksFromDate(d.goalDate) || 10;
    return { date: d.goalDate, weeks, periodMode: "date" };
  }
  return { date: null, weeks: d.weeks || 10, periodMode: "weeks" };
}

function periodLabel(d) {
  const p = resolvePeriod(d);
  if (p.periodMode === "date") return `til ${p.date} (~${p.weeks} uker)`;
  return `${p.weeks} uker`;
}

/** @returns profile object ready to persist */
export function buildProfileFromDraft(d) {
  const coachName = (d.coachName || "MAI").trim() || "MAI";
  const brand = {
    /* App title follows coach name (Nora → NORA TRAINER). */
    appName: `${coachName.toUpperCase()} TRAINER`,
    coachName,
  };
  const period = resolvePeriod(d);
  return {
    brand,
    goal: {
      kind: d.goalKind || "general",
      label: d.goalLabel || GOALS.find((g) => g.kind === d.goalKind && !g.other)?.label || "Trening",
      date: period.date,
      weeks: period.weeks,
      periodMode: period.periodMode,
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
      periodLabel(d),
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
  const letter = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return <div className="ob-avatar" aria-hidden>{letter}</div>;
}

const EMPTY_DRAFT = {
  appName: "MAI TRAINER",
  coachName: "",
  goalKind: null,
  goalLabel: "",
  otherLabel: "",
  periodMode: "weeks",
  weeks: 10,
  goalDate: "",
  daysPerWeek: 4,
  mode: "flexible",
  level: null,
  equipment: ["bodyweight"],
  bodyWeight: "",
  bodyHeight: "",
  pickingOther: false,
  customName: "",
};

/**
 * Conversational coach — transcript + chip composer.
 * First run lands here (no Welcome). Returning users: magic link → onCloudRestore.
 */
export function Coach({
  onProgramReady,
  onEnterApp,
  onComplete,
  user = null,
  cloudEnabled = false,
  onCloudRestore,
}) {
  const [d, setD] = useState(() => ({ ...EMPTY_DRAFT }));
  const [turn, setTurn] = useState("boot");
  const [messages, setMessages] = useState([]);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returnEmail, setReturnEmail] = useState("");
  const [returnErr, setReturnErr] = useState("");
  const [syncEmail, setSyncEmail] = useState("");
  const [syncErr, setSyncErr] = useState("");
  const scrollRef = useRef(null);
  const draft = useRef(d);
  const pendingProfile = useRef(null);
  const booted = useRef(false);
  const restoreTried = useRef(false);
  draft.current = d;

  const coach = d.coachName || "Treneren";
  const set = (patch) => setD((x) => ({ ...x, ...patch }));

  function enterApp() {
    const p = pendingProfile.current;
    if (onEnterApp) onEnterApp(p);
    else if (onComplete && p) onComplete(p);
  }

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

  const OPENING =
    "Hei! La oss sette opp et treningsprogram til deg. Først — hva vil du kalle meg?";

  /* Boot: opening lines (guard against StrictMode double-mount). */
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    (async () => {
      await pushCoach(OPENING, 380);
      setTurn("name");
    })();
  }, [pushCoach]);

  /* Returning user completed magic link — pull plan or fall back to setup. */
  useEffect(() => {
    if (!user || !cloudEnabled) return;
    if (turn !== "returning" && turn !== "returning-sent") return;
    if (restoreTried.current) return;
    restoreTried.current = true;
    let cancelled = false;
    (async () => {
      setBusy(true);
      setTyping(true);
      try {
        const remote = await cloud.pull(user.id);
        if (cancelled) return;
        setTyping(false);
        if (remote?.profile) {
          onCloudRestore?.(remote);
          return;
        }
        setBusy(false);
        await pushCoach(
          "Fant ingen lagret plan på den kontoen. La oss sette opp et nytt — hva vil du kalle meg?",
          420,
        );
        setTurn("name");
      } catch {
        if (cancelled) return;
        setTyping(false);
        setBusy(false);
        setReturnErr("Kunne ikke hente planen. Prøv igjen, eller sett opp på nytt.");
        setTurn("returning");
        restoreTried.current = false;
      }
    })();
    return () => { cancelled = true; };
  }, [user, turn, cloudEnabled, onCloudRestore, pushCoach]);

  /* New user chose to save — magic link opened → enter app. */
  useEffect(() => {
    if (!user || turn !== "sync_email_sent") return;
    let cancelled = false;
    (async () => {
      setBusy(true);
      await pushCoach("Du er inne — planen er trygg. Klar for første økt.", 360);
      if (!cancelled) enterApp();
    })();
    return () => { cancelled = true; };
  }, [user, turn, pushCoach]);

  const coreDone = d.goalKind && d.level && d.equipment.length > 0;

  async function chooseCoachName(name) {
    const c = (name || "").trim() || "MAI";
    set({ coachName: c, customName: "" });
    draft.current = { ...draft.current, coachName: c };
    pushUser(c);
    setTurn("wait");
    await pushCoach(
      `Hyggelig — jeg er ${c}. Hva trener du mot — og innen når? Velg mål, så enten antall uker eller en måldato (ikke begge).`,
      480,
    );
    setTurn("goal");
  }

  async function startReturning() {
    pushUser("Jeg har allerede et program");
    setTurn("wait");
    if (!cloudEnabled) {
      await pushCoach(
        "Sky-synk er ikke satt opp på denne enheten, så jeg kan ikke hente et program via e-post. Sett opp et nytt — hva vil du kalle meg?",
        500,
      );
      setTurn("name");
      return;
    }
    await pushCoach(
      "Flott — skriv e-posten du brukte, så sender jeg en innloggingslenke. Åpne den på denne enheten, så henter jeg programmet ditt.",
      480,
    );
    setReturnEmail("");
    setReturnErr("");
    restoreTried.current = false;
    setTurn("returning");
  }

  async function sendReturnLink(e) {
    e?.preventDefault?.();
    const email = returnEmail.trim();
    if (!email) return;
    setReturnErr("");
    setBusy(true);
    try {
      await cloud.sendMagicLink(email);
      pushUser(email);
      setTurn("wait");
      await pushCoach(
        `Lenke sendt til ${email}. Åpne den på denne enheten — jeg venter her og henter planen når du er inne.`,
        420,
      );
      setTurn("returning-sent");
    } catch (ex) {
      setReturnErr(ex.message || "Kunne ikke sende lenke.");
    } finally {
      setBusy(false);
    }
  }

  async function afterGoal() {
    const cur = draft.current;
    const label = cur.pickingOther && cur.otherLabel
      ? cur.otherLabel
      : cur.goalLabel || "målet ditt";
    const when = periodLabel(cur);
    pushUser(`${label} · ${when}`);
    setTurn("wait");
    await pushCoach(
      `${label} ${when} — notert. Hvor mange dager i uka er realistisk, og vil du følge kalenderen eller ta neste økt når du er klar?`,
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
      `Sånn hørte jeg deg: ${goal} ${periodLabel(cur)}, ${cur.daysPerWeek} dager ${mode}, nivå «${lvl}», med ${eq || "det du har"}. Stemmer det?`,
      640,
    );
    setTurn("summary");
  }

  function buildPendingProfile() {
    const cur = draft.current;
    return buildProfileFromDraft({
      ...cur,
      goalLabel: cur.goalKind === "general" && cur.otherLabel
        ? cur.otherLabel
        : cur.goalLabel || GOALS.find((g) => g.kind === cur.goalKind)?.label,
      bodyWeight: cur.bodyWeight ? Number(cur.bodyWeight) : null,
      bodyHeight: cur.bodyHeight ? Number(cur.bodyHeight) : null,
    });
  }

  async function confirmBuild() {
    const profile = buildPendingProfile();
    pendingProfile.current = profile;
    onProgramReady?.(profile);
    pushUser("Ja — bygg programmet mitt");
    setTurn("wait");
    await pushCoach(
      "Programmet er klart. Vil du bare tracke på denne enheten, eller lagre med e-post så informasjonen ikke forsvinner hvis du bytter telefon?",
      520,
    );
    setTurn("sync_choice");
  }

  async function syncLocalOnly() {
    pushUser("Bare denne enheten");
    setTurn("wait");
    await pushCoach(
      "Greit — planen ligger her lokalt. Du kan slå på lagring senere via sky-ikonet. Klar for første økt.",
      420,
    );
    enterApp();
  }

  async function syncWantSave() {
    pushUser("Lagre med e-post");
    setTurn("wait");
    if (!cloudEnabled) {
      await pushCoach(
        "Lagring via e-post er ikke satt opp på denne enheten ennå. Vi kjører lokalt — du kan prøve sky-ikonet senere. Klar for første økt.",
        480,
      );
      enterApp();
      return;
    }
    if (user) {
      await pushCoach("Du er allerede innlogget — jeg synker planen nå. Klar for første økt.", 400);
      enterApp();
      return;
    }
    await pushCoach(
      "Skriv e-posten din — jeg sender en innloggingslenke. Ingen passord. Åpne lenken på denne enheten.",
      460,
    );
    setSyncEmail("");
    setSyncErr("");
    setTurn("sync_email");
  }

  async function sendSyncLink(e) {
    e?.preventDefault?.();
    const email = syncEmail.trim();
    if (!email) return;
    setSyncErr("");
    setBusy(true);
    try {
      await cloud.sendMagicLink(email);
      pushUser(email);
      setTurn("wait");
      await pushCoach(
        `Lenke sendt til ${email}. Åpne den her — så er planen lagret og klar.`,
        420,
      );
      setTurn("sync_email_sent");
    } catch (ex) {
      setSyncErr(ex.message || "Kunne ikke sende lenke.");
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    msgSeq = 0;
    setMessages([]);
    setD({ ...EMPTY_DRAFT });
    setReturnEmail("");
    setReturnErr("");
    restoreTried.current = false;
    setTurn("boot");
    setTyping(false);
    setBusy(false);
    window.setTimeout(async () => {
      await pushCoach(OPENING, 380);
      setTurn("name");
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
          {turn === "name" && !busy && (
            <>
              <div className="ob-chips">
                {COACH_PRESETS.map((n) => (
                  <Chip key={n} on={false} onClick={() => chooseCoachName(n)}>{n}</Chip>
                ))}
              </div>
              <label className="ob-label">Eller skriv et navn</label>
              <div className="ob-inline">
                <input
                  className="tinput"
                  placeholder="F.eks. Sam"
                  value={d.customName}
                  onChange={(e) => set({ customName: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && d.customName.trim()) chooseCoachName(d.customName);
                  }}
                />
                <button
                  className="cta ob-inline-cta"
                  disabled={!d.customName.trim()}
                  onClick={() => chooseCoachName(d.customName)}
                >
                  Bruk
                </button>
              </div>
              <button className="skipbtn ob-return-link" onClick={startReturning}>
                Jeg har allerede et program
              </button>
            </>
          )}

          {turn === "returning" && !busy && (
            <form onSubmit={sendReturnLink}>
              <label className="ob-label">E-post</label>
              <input
                className="tinput"
                type="email"
                required
                autoComplete="email"
                placeholder="deg@epost.no"
                value={returnEmail}
                onChange={(e) => setReturnEmail(e.target.value)}
              />
              {returnErr && <div className="ob-err">{returnErr}</div>}
              <button className="cta ob-composer-cta" type="submit" disabled={!returnEmail.trim()}>
                Send innloggingslenke
              </button>
              <button
                type="button"
                className="skipbtn"
                style={{ marginTop: 10, width: "100%" }}
                onClick={async () => {
                  pushUser("Sett opp på nytt");
                  setTurn("wait");
                  await pushCoach("Greit — hva vil du kalle meg?", 360);
                  setTurn("name");
                }}
              >
                Sett opp et nytt program i stedet
              </button>
            </form>
          )}

          {turn === "returning-sent" && !busy && (
            <div className="ob-composer-idle mono">
              Venter på at du åpner lenken…
              <button
                type="button"
                className="skipbtn"
                style={{ marginTop: 12, width: "100%", textTransform: "none", letterSpacing: 0 }}
                onClick={() => { restoreTried.current = false; setTurn("returning"); }}
              >
                Send på nytt / annen e-post
              </button>
            </div>
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
              <div className="ob-label" style={{ marginTop: 14 }}>Periode — velg én</div>
              <div className="ob-chips">
                <Chip
                  on={d.periodMode === "weeks"}
                  onClick={() => set({ periodMode: "weeks", goalDate: "" })}
                >
                  Antall uker
                </Chip>
                <Chip
                  on={d.periodMode === "date"}
                  onClick={() => set({ periodMode: "date" })}
                >
                  Måldato
                </Chip>
              </div>
              {d.periodMode === "weeks" ? (
                <div className="ob-chips" style={{ marginTop: 10 }}>
                  {WEEKS.map((w) => (
                    <Chip key={w} on={d.weeks === w} onClick={() => set({ weeks: w, goalDate: "", periodMode: "weeks" })}>
                      {w} uker
                    </Chip>
                  ))}
                </div>
              ) : (
                <>
                  <label className="ob-label">Måldato</label>
                  <input
                    className="tinput"
                    type="date"
                    value={d.goalDate}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => set({ goalDate: e.target.value, periodMode: "date" })}
                  />
                  {d.goalDate && weeksFromDate(d.goalDate) && (
                    <div className="ob-hint mono">≈ {weeksFromDate(d.goalDate)} uker fra i dag</div>
                  )}
                </>
              )}
              <button
                className="cta ob-composer-cta"
                disabled={
                  !d.goalKind
                  || (d.pickingOther && !d.otherLabel.trim())
                  || (d.periodMode === "date" && !weeksFromDate(d.goalDate))
                }
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
              <Chip on disabled={!coreDone} onClick={confirmBuild}>
                Ja — bygg programmet mitt
              </Chip>
              <Chip on={false} onClick={restart}>
                <RotateCcw size={12} style={{ marginRight: 6, verticalAlign: -1 }} />
                Start samtalen på nytt
              </Chip>
            </div>
          )}

          {turn === "sync_choice" && !busy && (
            <div className="ob-chips">
              <Chip on onClick={syncWantSave}>
                Lagre med e-post
              </Chip>
              <Chip on={false} onClick={syncLocalOnly}>
                Bare denne enheten
              </Chip>
            </div>
          )}

          {turn === "sync_email" && !busy && (
            <form onSubmit={sendSyncLink}>
              <label className="ob-label">E-post</label>
              <input
                className="tinput"
                type="email"
                required
                autoComplete="email"
                placeholder="deg@epost.no"
                value={syncEmail}
                onChange={(e) => setSyncEmail(e.target.value)}
              />
              {syncErr && <div className="ob-err">{syncErr}</div>}
              <button className="cta ob-composer-cta" type="submit" disabled={!syncEmail.trim()}>
                Send innloggingslenke
              </button>
              <button
                type="button"
                className="skipbtn"
                style={{ marginTop: 10, width: "100%" }}
                onClick={syncLocalOnly}
              >
                Fortsett bare på denne enheten
              </button>
            </form>
          )}

          {turn === "sync_email_sent" && !busy && (
            <div className="ob-composer-idle mono">
              Venter på at du åpner lenken…
              <button
                type="button"
                className="skipbtn"
                style={{ marginTop: 12, width: "100%", textTransform: "none", letterSpacing: 0 }}
                onClick={() => enterApp()}
              >
                Fortsett uten å vente
              </button>
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
