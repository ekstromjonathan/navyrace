import React, { useState } from "react";
import { ChevronRight, Wind } from "lucide-react";
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

function Chip({ on, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="ob-chip"
      style={on ? { background: "var(--flare)", color: "#1a0a06", borderColor: "var(--flare)" } : undefined}
    >
      {children}
    </button>
  );
}

function Bubble({ who, children }) {
  return (
    <div className={`ob-bubble ${who}`}>
      {who === "mai" && <div className="ob-who">MAI</div>}
      <div className="ob-text">{children}</div>
    </div>
  );
}

export function Welcome({ coachName, appName, cloudEnabled, onStart, onLogin }) {
  return (
    <div className="nr-root">
      <div className="nr-noise" />
      <div className="nr-wrap" style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "100dvh" }}>
        <div className="fade" style={{ textAlign: "center", padding: "24px 0 40px" }}>
          <div className="tag" style={{ justifyContent: "center", marginBottom: 18 }}>
            <Wind size={12} /> {appName || "MAI TRAINER"}
          </div>
          <div className="htitle" style={{ fontSize: 34, marginBottom: 12 }}>
            Hei, jeg er {coachName || "MAI"}
          </div>
          <p style={{ color: "var(--muted)", fontSize: 15, lineHeight: 1.5, maxWidth: 320, margin: "0 auto 28px" }}>
            Vi bygger et program til <em style={{ color: "var(--bone)", fontStyle: "normal" }}>deg</em> —
            mål, tid og utstyr. Ingen konto kreves for å starte.
          </p>
          <button className="cta" onClick={onStart} style={{ marginTop: 0 }}>
            Start med {coachName || "MAI"} <ChevronRight size={18} />
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
 * Chip-based coach flow. onComplete(profile).
 * Steps: brand → goal+timeline → days+mode → level → equipment → optional body → summary
 */
export function Coach({ onComplete }) {
  const [step, setStep] = useState(0);
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
    wantExtras: null,
    pickingOther: false,
  });

  const coach = d.coachName || "MAI";
  const set = (patch) => setD((x) => ({ ...x, ...patch }));

  function finish() {
    const profile = buildProfileFromDraft({
      ...d,
      goalLabel: d.goalKind === "general" && d.otherLabel
        ? d.otherLabel
        : d.goalLabel || GOALS.find((g) => g.kind === d.goalKind)?.label,
      bodyWeight: d.bodyWeight ? Number(d.bodyWeight) : null,
      bodyHeight: d.bodyHeight ? Number(d.bodyHeight) : null,
    });
    onComplete(profile);
  }

  const coreDone = d.goalKind && d.level && d.equipment.length > 0;

  return (
    <div className="nr-root">
      <div className="nr-noise" />
      <div className="nr-wrap ob-wrap">
        <div className="ob-progress mono">
          {coach} · steg {Math.min(step + 1, 5)} / 5
        </div>

        {step === 0 && (
          <div className="fade">
            <Bubble who="mai">
              Først — hva skal appen og jeg hete? Du kan beholde defaultene.
            </Bubble>
            <label className="ob-label">App</label>
            <input className="tinput" value={d.appName} onChange={(e) => set({ appName: e.target.value })} />
            <label className="ob-label">Trener</label>
            <input className="tinput" value={d.coachName} onChange={(e) => set({ coachName: e.target.value })} />
            <button className="cta" style={{ marginTop: 18 }} onClick={() => setStep(1)}>
              Videre
            </button>
          </div>
        )}

        {step === 1 && (
          <div className="fade">
            <Bubble who="mai">Hva trener du mot — og innen når?</Bubble>
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
            <div className="ob-label" style={{ marginTop: 18 }}>Varighet</div>
            <div className="ob-chips">
              {WEEKS.map((w) => (
                <Chip key={w} on={d.weeks === w} onClick={() => set({ weeks: w })}>{w} uker</Chip>
              ))}
            </div>
            <label className="ob-label">Måldato (valgfritt)</label>
            <input className="tinput" type="date" value={d.goalDate} onChange={(e) => set({ goalDate: e.target.value })} />
            <button className="cta" style={{ marginTop: 18 }} disabled={!d.goalKind} onClick={() => setStep(2)}>
              Videre
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="fade">
            <Bubble who="mai">
              Hvor mange dager i uka er realistisk — og vil du følge kalenderen?
            </Bubble>
            <div className="ob-chips">
              {[3, 4, 5, 6].map((n) => (
                <Chip key={n} on={d.daysPerWeek === n} onClick={() => set({ daysPerWeek: n })}>{n} dager</Chip>
              ))}
            </div>
            <div className="ob-label" style={{ marginTop: 16 }}>Modus</div>
            <div className="ob-chips">
              <Chip on={d.mode === "calendar"} onClick={() => set({ mode: "calendar" })}>
                Kalender · man = man
              </Chip>
              <Chip on={d.mode === "flexible"} onClick={() => set({ mode: "flexible" })}>
                Fleksibel · neste når du er klar
              </Chip>
            </div>
            <button className="cta" style={{ marginTop: 18 }} onClick={() => setStep(3)}>Videre</button>
          </div>
        )}

        {step === 3 && (
          <div className="fade">
            <Bubble who="mai">Nivå akkurat nå?</Bubble>
            <div className="ob-chips">
              {LEVELS.map((l) => (
                <Chip key={l.id} on={d.level === l.id} onClick={() => set({ level: l.id })}>{l.label}</Chip>
              ))}
            </div>
            <button className="cta" style={{ marginTop: 18 }} disabled={!d.level} onClick={() => setStep(4)}>
              Videre
            </button>
          </div>
        )}

        {step === 4 && (
          <div className="fade">
            <Bubble who="mai">Hva har du tilgang til? (velg flere)</Bubble>
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
              className="cta"
              style={{ marginTop: 18 }}
              disabled={!d.equipment.length}
              onClick={() => setStep(5)}
            >
              Videre
            </button>
          </div>
        )}

        {step === 5 && d.wantExtras === null && (
          <div className="fade">
            <Bubble who="mai">
              To ting til hvis du vil ha en skarpere plan — eller vi hopper rett til oppsummering.
            </Bubble>
            <button className="cta" onClick={() => set({ wantExtras: true })}>Legg til vekt / høyde</button>
            <button className="skipbtn" onClick={() => setStep(6)}>Hopp over · oppsummer</button>
          </div>
        )}

        {step === 5 && d.wantExtras === true && (
          <div className="fade">
            <Bubble who="mai">Vekt og høyde (valgfritt) — brukes bare til dose-forslag.</Bubble>
            <label className="ob-label">Vekt (kg)</label>
            <input className="tinput" inputMode="decimal" value={d.bodyWeight} onChange={(e) => set({ bodyWeight: e.target.value })} />
            <label className="ob-label">Høyde (cm)</label>
            <input className="tinput" inputMode="decimal" value={d.bodyHeight} onChange={(e) => set({ bodyHeight: e.target.value })} />
            <button className="cta" style={{ marginTop: 18 }} onClick={() => setStep(6)}>Oppsummer</button>
          </div>
        )}

        {step === 6 && (
          <div className="fade">
            <Bubble who="mai">Sånn hørte jeg deg — stemmer dette?</Bubble>
            <div className="hero" style={{ marginTop: 12 }}>
              <div className="metric" style={{ marginBottom: 10 }}>
                <div className="k">App / trener</div>
                <div className="v" style={{ fontSize: 16 }}>{d.appName} · {d.coachName}</div>
              </div>
              <div className="hmeta" style={{ borderTop: 0, paddingTop: 0, marginTop: 0, flexWrap: "wrap" }}>
                <div className="metric"><div className="k">Mål</div><div className="v" style={{ fontSize: 15 }}>{d.otherLabel || d.goalLabel}</div></div>
                <div className="metric"><div className="k">Tid</div><div className="v" style={{ fontSize: 15 }}>{d.weeks} uker</div></div>
                <div className="metric"><div className="k">Uke</div><div className="v" style={{ fontSize: 15 }}>{d.daysPerWeek}d · {d.mode === "calendar" ? "kalender" : "fleksibel"}</div></div>
                <div className="metric"><div className="k">Nivå</div><div className="v" style={{ fontSize: 15 }}>{LEVELS.find((l) => l.id === d.level)?.label}</div></div>
              </div>
              <div style={{ marginTop: 12, fontSize: 12.5, color: "var(--muted)" }}>
                Utstyr: {d.equipment.map((id) => EQUIP.find((e) => e.id === id)?.label).join(" · ")}
              </div>
            </div>
            <button className="cta" disabled={!coreDone} onClick={finish}>
              Bygg programmet mitt
            </button>
            <button className="skipbtn" onClick={() => setStep(1)}>Endre svar</button>
          </div>
        )}
      </div>
    </div>
  );
}

export { defaultBrand };
