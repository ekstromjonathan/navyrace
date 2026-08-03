import React, { useState, useEffect, useRef } from "react";
import {
  Footprints, Timer, Dumbbell, Activity, Waves, Anchor, Mountain,
  Flame, Move, Check, RotateCcw, ChevronRight, Zap, Target, Hand, X,
  Utensils, ShoppingCart, Apple, Play, Pause, SkipForward, Wind,
  Cloud, CloudOff, RefreshCw, Mail
} from "lucide-react";
import * as cloud from "./cloud.js";

/* ----------------------------- storage shim ----------------------------- */
/* Claude artifact storage when available, else localStorage, else memory.   */
const mem = {};

/* Resolved once. localStorage can exist but throw on write (Safari private   */
/* browsing, blocked third-party storage), so probe with a real write.        */
let lsCache;
function ls() {
  if (lsCache !== undefined) return lsCache;
  lsCache = null;
  try {
    const s = typeof window !== "undefined" && window.localStorage;
    if (s) {
      const probe = "navyrace:probe";
      s.setItem(probe, "1");
      s.removeItem(probe);
      lsCache = s;
    }
  } catch (e) { /* unavailable — stay on in-memory fallback */ }
  return lsCache;
}

const store = {
  async get(k) {
    try {
      if (typeof window !== "undefined" && window.storage) {
        const r = await window.storage.get(k);
        return r ? r.value : null;
      }
    } catch (e) { /* key missing or unavailable */ }
    const s = ls();
    if (s) {
      try { return s.getItem(k); } catch (e) { /* fall through */ }
    }
    return mem[k] ?? null;
  },
  async set(k, v) {
    try {
      if (typeof window !== "undefined" && window.storage) {
        await window.storage.set(k, v);
        return;
      }
    } catch (e) { /* fall through */ }
    const s = ls();
    if (s) {
      try { s.setItem(k, v); return; } catch (e) { /* quota — fall through */ }
    }
    mem[k] = v;
  },
};
const KEY = "navyrace:v1";

/* ----------------------------- program data ----------------------------- */
const PHASES = (w) =>
  w <= 3 ? "Base" : w <= 6 ? "Bygg" : w <= 9 ? "Spesifikk topp" : "Nedtrapping";

// per-week parameters (index 0 = uke 1)
const WK = [
  { runEasy: 30, long: 5,   int: "6 × 1 min hardt / 2 min rolig", str: 3, brick: 0 },
  { runEasy: 35, long: 6,   int: "8 × 1 min / 2 min",            str: 3, brick: 0 },
  { runEasy: 35, long: 7,   int: "5 × 2 min / 2 min",            str: 3, brick: 0 },
  { runEasy: 40, long: 7,   int: "Bakkedrag 8 × 30 s / gå ned",  str: 4, brick: 4 },
  { runEasy: 40, long: 8,   int: "6 × 3 min terskel / 90 s",     str: 4, brick: 5 },
  { runEasy: 45, long: 9,   int: "Bakkedrag 10 × 30 s",          str: 4, brick: 6 },
  { runEasy: 40, long: 9.5, int: "5 × 4 min terskel / 2 min",    str: 4, brick: 7 },
  { runEasy: 40, long: 8,   int: "8 × 45 s bakke",               str: 4, brick: 8 },
  { runEasy: 35, long: 6,   int: "6 × 2 min race-fart",          str: 4, brick: 7 },
  { runEasy: 25, long: 4,   int: "4 × 1 min løst, så hvil",      str: 2, brick: 4 },
];

const DAYS = ["MAN", "TIR", "ONS", "TOR", "FRE", "LØR", "SØN"];

function ex(name, icon, detail, cue) { return { name, icon, detail, cue }; }

function buildDay(w, d, p = WK[w - 1]) {
  const phase = PHASES(w);
  const base = { week: w, day: d, phase };

  if (d === 0) return { ...base, type: "easyrun", title: "Rolig løp + grep",
    icon: Footprints, est: `~${p.runEasy + 10} min`, loadKey: "easyrun",
    load: p.runEasy, unit: "min",
    items: [
      ex("Rolig løp · sone 2", Footprints, `${p.runEasy} min`, "Snakketempo. Skal føles for lett."),
      ex("Dødheng", Hand, "3 × maks tid", "Rett etter løpet. Bygger grep."),
    ] };

  if (d === 1) return { ...base, type: "strA", title: "Styrke A · trekk + bæring",
    icon: Dumbbell, est: "~40 min", loadKey: "strA", load: p.str, unit: "runder",
    items: [
      ex("Pull-ups", Activity, `${p.str} × maks`, "Strikk som hjelp ved behov."),
      ex("Ring-rows", Activity, `${p.str} × 12`, "Juster vinkel for vanskelighet."),
      ex("Vektplate-bæring 10 kg", Anchor, `${p.str} × 40 m`, "Mot bryst. Rett rygg."),
      ex("KB swing 16 kg", Zap, "4 × 15", "Eksplosiv hofte → over vegger."),
      ex("Hollow hold", Move, "3 × 30 s", "Stram kjerne."),
    ] };

  if (d === 2) return { ...base, type: "intervals", title: "Intervaller",
    icon: Timer, est: "~35 min", loadKey: "intervals", load: null, unit: "",
    items: [
      ex("Oppvarming", Footprints, "10 min rolig", "Gradvis opp i puls."),
      ex("Hovedøkt", Flame, p.int, "Hardt = du klarer ikke prate."),
      ex("Nedjogg", Footprints, "5 min løst", "Rist ut beina."),
    ] };

  if (d === 3) return { ...base, type: "mobility", title: "Mobilitet + core (valgfri)",
    icon: Move, est: "~25 min", loadKey: "mobility", load: null, unit: "",
    items: [
      ex("Mobilitet hofte / ankel", Move, "10 min", "Roterende, kontrollert."),
      ex("Strikk face-pulls", Activity, "3 × 15", "Skulderhelse for all hengingen."),
      ex("Planke", Target, "3 × 40 s", "Lett dag — ikke mas på."),
    ] };

  if (d === 4) return { ...base, type: "strB", title: "Styrke B · press + krabb + grep",
    icon: Dumbbell, est: "~40 min", loadKey: "strB", load: p.str, unit: "runder",
    items: [
      ex("Dips på stol", Dumbbell, `${p.str} × maks`, "Press deg over kanten."),
      ex("Push-ups · føtter på stol", Activity, `${p.str} × 12–20`, "Tyngre med føtter hevet."),
      ex("Bulgarsk utfall", Mountain, "3 × 10 / bein", "Bakfot på stol."),
      ex("Step-ups m/KB 16 kg", Mountain, "3 × 10 / bein", "Kontrollert ned."),
      ex("Bjørnekrabb", Move, "4 × 20 m", "Race-spesifikk. Lav, jevn."),
      ex("Heng-utholdenhet", Hand, "3 × 45–60 s", "Til failure på siste."),
    ] };

  if (d === 5) {
    if (p.brick > 0) return { ...base, type: "brick", title: "Brick · løp + hinder",
      icon: Waves, est: `~${p.brick * 12} min`, loadKey: "brick", load: p.brick, unit: "runder",
      items: [
        ex("Format", Flame, `Løp 1 km → stasjon · ${p.brick} runder`, "Hinder i tretthet — som race-dag."),
        ex("Stasjon: trekk", Activity, "5 pull-ups + 30 s heng", null),
        ex("Stasjon: bæring", Anchor, "40 m vektplate 10 kg", null),
        ex("Stasjon: kraft", Zap, "15 KB swing + 10 goblet squat", null),
        ex("Stasjon: krabb", Move, "20 m bjørnekrabb + 10 burpees", null),
        ex("Stasjon: grep", Hand, "Stige / ringer hånd-over-hånd", null),
      ] };
    return { ...base, type: "skills", title: "Grep + teknikk",
      icon: Hand, est: "~35 min", loadKey: "skills", load: p.str, unit: "runder",
      items: [
        ex("Grepsutholdenhet", Hand, "4 × maks heng", "Aktiv + passiv heng."),
        ex("Traversering", Activity, "3–5 runder", "Stige / ringer hånd-over-hånd."),
        ex("Vegg-overgang", Mountain, `${p.str} × teknikk`, "Pull → dip → over."),
        ex("Burpees", Flame, "4 × 10", "Tempo, ikke maks."),
      ] };
  }

  return { ...base, type: "longrun", title: "Langtur",
    icon: Footprints, est: `~${Math.round(p.long * 6)} min`, loadKey: "longrun",
    load: p.long, unit: "km",
    items: [
      ex("Langt rolig løp · sone 2", Footprints, `${p.long} km`, "Bygg motoren. Lavt tempo."),
      ex("Underlag", Mountain, "Terreng / sand om mulig", "Løypa er ikke flat asfalt."),
    ] };
}

const SESSIONS = [];
for (let w = 1; w <= 10; w++) for (let d = 0; d < 7; d++) {
  const s = buildDay(w, d);
  s.id = `w${w}d${d}`;
  SESSIONS.push(s);
}

/* Rebuild a session with the adapted load written into items/est, so the
   exercise list shows the same dose as the hero metric. Display-only —
   SESSIONS and log identity are untouched. */
const LOAD_FIELD = {
  easyrun: "runEasy", strA: "str", strB: "str",
  skills: "str", brick: "brick", longrun: "long",
};
function withLoad(session, load) {
  if (load == null || load === session.load) return session;
  const field = LOAD_FIELD[session.loadKey];
  if (!field) return session;
  const p = { ...WK[session.week - 1], [field]: load };
  return { ...buildDay(session.week, session.day, p), id: session.id };
}

/* --------------------------- exercise library --------------------------- */
/* how = slik gjør du · focus = tenk på · rest = pause mellom sett          */
const LIB = {
  "Rolig løp · sone 2": { how: "Løp i et tempo der du kan føre en samtale i hele setninger. Lav, jevn puls hele veien.", focus: "Roen er poenget — ikke jag tempoet.", rest: null },
  "Dødheng": { how: "Heng i strak arm fra stang eller ringer, skuldrene lett aktivert. Heng til grepet svikter.", focus: "Pust rolig. Ikke sleng i skuldrene.", rest: "60–90 s" },
  "Pull-ups": { how: "Heng i strak arm, dra haka over stanga, senk kontrollert. Strikk under føttene hvis du ikke når reps.", focus: "Full strekk i bunn, ingen sleng.", rest: "90–120 s" },
  "Ring-rows": { how: "Heng under ringene med rett kropp, dra brystet mot hendene, senk rolig. Mer horisontal = tyngre.", focus: "Klem skulderbladene sammen.", rest: "60–75 s" },
  "Vektplate-bæring 10 kg": { how: "Hold vektplata mot brystet, gå 40 m i jevnt tempo, snu og gå tilbake.", focus: "Rett rygg, stram kjerne, korte steg.", rest: "Gå tilbake ≈ pause (~45 s)" },
  "KB swing 16 kg": { how: "Hofta driver bevegelsen — sving kettlebellen til skulderhøyde med eksplosiv hoftestøt, ikke med armene.", focus: "Kraften kommer fra hofta, ikke skuldrene.", rest: "60–75 s" },
  "Hollow hold": { how: "Ligg på rygg, press korsryggen i gulvet, løft skuldre og bein til en grunn skål. Hold.", focus: "Korsrygg presset ned hele tiden.", rest: "30–45 s" },
  "Oppvarming": { how: "Start svært rolig, øk gradvis til du er lett andpusten og varm.", focus: "Forbered kroppen, ikke slit den ut.", rest: null },
  "Hovedøkt": { how: "Kjør intervallene som beskrevet. Hardt-periodene skal være ekte harde, restperiodene ekte rolige.", focus: "Hold jevn innsats over alle dragene.", rest: "Som angitt i økta" },
  "Nedjogg": { how: "Løp svært løst noen minutter for å roe ned pulsen.", focus: "La pusten falle til ro.", rest: null },
  "Mobilitet hofte / ankel": { how: "Kontrollerte bevegelser for hofte og ankel — utfall med rotasjon, ankelbøy mot vegg.", focus: "Sakte og kontrollert, ingen rykk.", rest: null },
  "Strikk face-pulls": { how: "Fest strikken i ansiktshøyde, dra mot ansiktet med albuene høyt, klem skulderbladene.", focus: "Holder skuldrene friske til all hengingen.", rest: "45–60 s" },
  "Planke": { how: "Albuer under skuldrene, rett linje fra hode til hæl. Hold uten å synke i korsryggen.", focus: "Stram rumpe og mage — ikke heng.", rest: "30–45 s" },
  "Dips på stol": { how: "Hender på stolkanten, senk til albuene er ~90°, press opp. Bøy beina for å lette.", focus: "Skuldrene ned og bak, ikke opp mot ørene.", rest: "90–120 s" },
  "Push-ups · føtter på stol": { how: "Føttene på stolen, hendene i gulvet. Senk brystet kontrollert, press opp i rett linje.", focus: "Kroppen som en planke hele veien.", rest: "60–75 s" },
  "Bulgarsk utfall": { how: "Bakre fot på stolen, senk bakkneet mot gulvet, press opp gjennom fremre hæl.", focus: "Vekt på fremre hæl, overkropp oppreist.", rest: "60–75 s / bein" },
  "Step-ups m/KB 16 kg": { how: "Hold kettlebellen, sett hele foten på stol/stige, press opp uten å sparke fra bakfoten. Senk rolig.", focus: "Driv fra hælen på toppfoten.", rest: "60–75 s / bein" },
  "Bjørnekrabb": { how: "På hender og tær, knærne like over gulvet. Kryp framover med motsatt arm og bein.", focus: "Hold hofta lav og rolig — ikke vugg.", rest: "45–60 s" },
  "Heng-utholdenhet": { how: "Heng i strak arm så lenge du klarer. Siste runde: til grepet gir helt etter.", focus: "Dette er det som faller deg av traverser i løypa.", rest: "60–90 s" },
  "Format": { how: "Slik er økta bygd opp. Følg rekkefølgen, hold deg i bevegelse mellom stasjonene.", focus: "Lavt opphold mellom stasjoner — det er hele poenget.", rest: null },
  "Stasjon: trekk": { how: "Ved stasjonen: 5 pull-ups, så 30 sekunders heng. Videre.", focus: "Tren grep i tretthet.", rest: "Minimalt" },
  "Stasjon: bæring": { how: "Bær vektplata 40 m og tilbake i ett strekk.", focus: "Rett rygg selv når du er sliten.", rest: "Minimalt" },
  "Stasjon: kraft": { how: "15 KB swings rett over i 10 goblet squats uten pause.", focus: "Eksplosivt på swing, dypt på knebøy.", rest: "Minimalt" },
  "Stasjon: krabb": { how: "20 m bjørnekrabb rett over i 10 burpees.", focus: "Hold tempo gjennom ubehaget.", rest: "Minimalt" },
  "Stasjon: grep": { how: "Traverser stige eller ringer hånd-over-hånd så langt du kommer.", focus: "Slipp før du river — beskytt hendene.", rest: "Minimalt" },
  "Grepsutholdenhet": { how: "Veksle mellom aktiv heng (skuldre aktivert) og passiv heng. Maks tid hver runde.", focus: "Bygg seige underarmer.", rest: "60–90 s" },
  "Traversering": { how: "Beveg deg sidelengs på stige eller ringer, hånd-over-hånd, 3–5 runder.", focus: "Rolige, kontrollerte tak.", rest: "60–90 s" },
  "Vegg-overgang": { how: "Øv på å dra deg opp til brysthøyde (pull) og presse over kanten (dip), som over en klatrevegg.", focus: "Eksplosivt opp, rull over hofta.", rest: "90–120 s" },
  "Burpees": { how: "Fra stående: ned i planke, evt. push-up, hopp inn og opp. Jevnt tempo.", focus: "Tempo, ikke maks — pust jevnt.", rest: "45–60 s" },
  "Langt rolig løp · sone 2": { how: "Ukas lengste økt, holdt i rolig snakketempo hele veien.", focus: "Bygger motoren. Tål å løpe sakte.", rest: null },
  "Underlag": { how: "Legg gjerne deler av turen på terreng, grus eller sand.", focus: "Løypa i Horten er ikke flat asfalt.", rest: null },
};

/* reusable expandable exercise row */
function ExerciseRow({ item }) {
  const [open, setOpen] = useState(false);
  const Ico = item.icon;
  const info = LIB[item.name] || {};
  return (
    <div>
      <div className="row" onClick={() => setOpen((o) => !o)}>
        <div className="rico"><Ico size={16} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="rname">{item.name}</div>
          {item.cue && <div className="rcue">{item.cue}</div>}
        </div>
        <div className="rdetail">{item.detail}</div>
        <ChevronRight size={16} className={`row-chev ${open ? "open" : ""}`} />
      </div>
      {open && (
        <div className="exp"><div className="exp-in">
          {info.how && (
            <div className="exp-block">
              <div className="exp-k">Slik gjør du</div>
              <div className="exp-v">{info.how}</div>
            </div>
          )}
          {(info.focus || item.cue) && (
            <div className="exp-block">
              <div className="exp-k">Tenk på</div>
              <div className="exp-v">{info.focus || item.cue}</div>
            </div>
          )}
          <div className="exp-meta">
            <div><div className="k">Dose</div><div className="v">{item.detail}</div></div>
            {info.rest && <div><div className="k">Pause / sett</div><div className="v">{info.rest}</div></div>}
          </div>
        </div></div>
      )}
    </div>
  );
}

/* --------------------------- adaptation engine --------------------------- */
const RPE = {
  lett:    { mult: 1.08, color: "var(--go)",   label: "Lett",    msg: "Forrige føltes lett — skrur opp litt." },
  passe:   { mult: 1.0,  color: "var(--hold)", label: "Passe",   msg: "Holder planen." },
  brutalt: { mult: 0.9,  color: "var(--hard)", label: "Brutalt", msg: "Forrige var hard — letter litt." },
};

/* log value for a session that was skipped instead of completed */
const SKIPPED = "hoppet";

function adapt(session, index, logs) {
  if (session.load == null) return { load: null, note: null };
  let prev = null;
  for (let i = index - 1; i >= 0; i--) {
    const s = SESSIONS[i];
    if (s.loadKey === session.loadKey && RPE[logs[s.id]]) { prev = logs[s.id]; break; }
  }
  if (!prev) return { load: session.load, note: null };
  const r = RPE[prev];
  let v = session.load * r.mult;
  v = session.unit === "km" ? Math.round(v * 2) / 2 : Math.round(v);
  const note = v !== session.load ? r.msg : null;
  return { load: v, note, dir: v > session.load ? "up" : v < session.load ? "down" : "flat" };
}

/* -------------------------------- styles -------------------------------- */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@500;600;700&family=Saira:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
:root{
  --ink:#0B0E11; --panel:#13181D; --panel2:#192026; --line:rgba(236,232,224,.10);
  --bone:#ECE8E0; --muted:#828C98; --flare:#FF5436;
  --go:#5FD08A; --hold:#E8B23A; --hard:#FF5436;
  --disp:'Saira Condensed',sans-serif; --body:'Saira',sans-serif; --mono:'IBM Plex Mono',monospace;
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.nr-root{min-height:100vh;background:var(--ink);color:var(--bone);font-family:var(--body);
  position:relative;overflow-x:hidden}
.nr-root::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;
  background:
    radial-gradient(120% 60% at 50% -10%, rgba(255,84,54,.10), transparent 60%),
    repeating-linear-gradient(0deg, rgba(236,232,224,.025) 0 1px, transparent 1px 30px),
    repeating-linear-gradient(90deg, rgba(236,232,224,.02) 0 1px, transparent 1px 30px);}
.nr-noise{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.035;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");}
.nr-wrap{position:relative;z-index:1;max-width:460px;margin:0 auto;
  padding:22px 18px calc(96px + env(safe-area-inset-bottom,0px));min-height:100vh}
.mono{font-family:var(--mono);font-variant-numeric:tabular-nums}
.disp{font-family:var(--disp);text-transform:uppercase;letter-spacing:.04em}

/* header */
.hd{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:6px}
.hd-title{font-family:var(--disp);font-weight:700;font-size:22px;letter-spacing:.06em;line-height:1}
.hd-sub{font-family:var(--mono);font-size:11px;color:var(--muted);letter-spacing:.14em;margin-top:7px;text-transform:uppercase}
.iconbtn{width:34px;height:34px;border:1px solid var(--line);border-radius:9px;background:var(--panel);
  display:grid;place-items:center;color:var(--muted);cursor:pointer}
.iconbtn:active{transform:scale(.94)}
.prog{height:3px;background:rgba(236,232,224,.08);border-radius:3px;margin:16px 0 22px;overflow:hidden}
.prog>i{display:block;height:100%;background:var(--flare);border-radius:3px;transition:width .5s cubic-bezier(.2,.8,.2,1)}

/* tag */
.tag{display:inline-flex;align-items:center;gap:7px;font-family:var(--mono);font-size:10.5px;
  letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.dot{width:6px;height:6px;border-radius:50%}

/* hero */
.hero{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);
  border-radius:18px;padding:20px 18px;position:relative;overflow:hidden}
.hero::after{content:"";position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(236,232,224,.25),transparent)}
.hero-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
.hicon{width:42px;height:42px;border-radius:11px;background:rgba(255,84,54,.12);
  border:1px solid rgba(255,84,54,.3);display:grid;place-items:center;color:var(--flare)}
.htitle{font-family:var(--disp);font-weight:700;font-size:27px;line-height:.98;margin:2px 0 4px}
.hmeta{display:flex;gap:16px;margin-top:14px;padding-top:14px;border-top:1px solid var(--line)}
.metric .k{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase}
.metric .v{font-family:var(--mono);font-weight:600;font-size:20px;margin-top:3px}
.metric .v small{font-size:12px;color:var(--muted);margin-left:2px}

/* adapt banner */
.adapt{display:flex;align-items:center;gap:9px;margin-top:14px;padding:10px 12px;border-radius:11px;
  background:rgba(236,232,224,.04);border:1px solid var(--line);font-size:12.5px;color:var(--bone)}
.adapt .ai{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;flex:0 0 auto}

/* exercises */
.list{margin-top:18px;display:flex;flex-direction:column;gap:2px}
.row{display:flex;align-items:center;gap:13px;padding:13px 4px;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.rico{width:34px;height:34px;border-radius:9px;background:var(--panel2);border:1px solid var(--line);
  display:grid;place-items:center;color:var(--bone);flex:0 0 auto}
.rname{font-weight:600;font-size:14.5px;line-height:1.15}
.rcue{font-size:11.5px;color:var(--muted);margin-top:3px;line-height:1.3}
.rdetail{font-family:var(--mono);font-size:12.5px;font-weight:500;color:var(--flare);
  white-space:nowrap;text-align:right;flex:0 0 auto}

/* cta */
.cta{margin-top:22px;width:100%;border:0;border-radius:14px;background:var(--flare);color:#1a0a06;
  font-family:var(--disp);font-weight:700;font-size:16px;letter-spacing:.06em;padding:17px;
  display:flex;align-items:center;justify-content:center;gap:9px;cursor:pointer}
.cta:active{transform:scale(.985)}
.cta:disabled{opacity:.6;cursor:default}
.skipbtn{margin-top:10px;width:100%;border:1px solid var(--line);border-radius:12px;background:transparent;
  color:var(--muted);font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;
  padding:12px;cursor:pointer}
.skipbtn:active{transform:scale(.985)}
.done-banner{margin-top:22px;border:1px solid var(--line);border-radius:14px;padding:16px;
  text-align:center;background:var(--panel);color:var(--muted);font-size:13px}

/* sync */
.tinput{width:100%;box-sizing:border-box;border:1px solid var(--line);border-radius:12px;
  background:var(--panel2);color:var(--bone);font-family:var(--body);font-size:15px;padding:14px 15px}
.tinput:focus{outline:none;border-color:var(--flare)}
.spin{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}

/* week strip */
.wk{margin-top:30px}
.wk-h{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;color:var(--muted);
  text-transform:uppercase;margin-bottom:12px}
.wk-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:7px}
.cell{aspect-ratio:1;border:1px solid var(--line);border-radius:11px;background:var(--panel);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;position:relative}
.cell .d{font-family:var(--mono);font-size:8.5px;letter-spacing:.08em;color:var(--muted)}
.cell.done{background:rgba(95,208,138,.08);border-color:rgba(95,208,138,.3)}
.cell.done svg{color:var(--go)}
.cell.skip{opacity:.55}
.cell.skip svg{color:var(--muted)}
.cell.today{border-color:var(--flare);background:rgba(255,84,54,.08)}
.cell.today svg{color:var(--flare)}
.cell svg{color:var(--muted)}

/* footer race marker */
.race{margin-top:26px;display:flex;align-items:center;gap:12px;padding:15px 16px;border-radius:14px;
  border:1px dashed var(--line);background:transparent}
.race .f{font-family:var(--disp);font-weight:700;font-size:15px;letter-spacing:.05em}
.race .s{font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:2px;letter-spacing:.1em}

/* sheet */
.scrim{position:fixed;inset:0;background:rgba(5,7,9,.66);z-index:20;backdrop-filter:blur(3px);
  display:flex;align-items:flex-end;justify-content:center}
.sheet{width:100%;max-width:460px;background:var(--panel);border:1px solid var(--line);
  border-radius:22px 22px 0 0;padding:22px 18px calc(30px + env(safe-area-inset-bottom,0px));
  animation:up .32s cubic-bezier(.2,.85,.2,1)}
.sheet-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.sheet-t{font-family:var(--disp);font-weight:700;font-size:21px}
.sheet-sub{font-size:12.5px;color:var(--muted);margin-bottom:18px}
.opts{display:flex;flex-direction:column;gap:10px}
.opt{display:flex;align-items:center;gap:13px;padding:15px 16px;border-radius:13px;
  border:1px solid var(--line);background:var(--panel2);cursor:pointer;text-align:left}
.opt:active{transform:scale(.99)}
.opt .ob{width:11px;height:11px;border-radius:50%;flex:0 0 auto}
.opt .ot{font-family:var(--disp);font-weight:600;font-size:16px}
.opt .od{font-size:11.5px;color:var(--muted);margin-top:2px}
.opt .chev{margin-left:auto;color:var(--muted)}

/* toast */
.toast{position:fixed;left:50%;bottom:calc(26px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:40;
  max-width:420px;width:calc(100% - 36px);background:var(--panel2);border:1px solid var(--line);
  border-radius:13px;padding:13px 15px;display:flex;align-items:center;gap:11px;
  box-shadow:0 12px 40px rgba(0,0,0,.5);animation:up .3s ease}
.toast .ti{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;flex:0 0 auto}
.toast .tt{font-size:13px;line-height:1.3}
.toast .tundo{margin-left:auto;flex:0 0 auto;border:1px solid var(--line);background:transparent;
  color:var(--bone);font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;
  padding:7px 10px;border-radius:8px;cursor:pointer}
.toast .tundo:active{transform:scale(.95)}

@keyframes up{from{transform:translateY(22px);opacity:0}to{transform:translateY(0);opacity:1}}
.fade{animation:fu .5s cubic-bezier(.2,.8,.2,1) both}
@keyframes fu{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}

/* exercise expand */
.row{cursor:pointer;user-select:none}
.list > div:last-child .row{border-bottom:0}
.row-chev{color:var(--muted);flex:0 0 auto;transition:transform .25s ease}
.row-chev.open{transform:rotate(90deg);color:var(--flare)}
.exp{overflow:hidden;animation:exp .26s ease}
@keyframes exp{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}
.exp-in{padding:2px 4px 16px 47px}
.exp-block{margin-bottom:11px}
.exp-k{font-family:var(--mono);font-size:9.5px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase;margin-bottom:5px}
.exp-v{font-size:13px;line-height:1.45;color:var(--bone)}
.exp-meta{display:flex;gap:22px;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
.exp-meta .k{font-family:var(--mono);font-size:9px;letter-spacing:.14em;color:var(--muted);text-transform:uppercase}
.exp-meta .v{font-family:var(--mono);font-size:13px;font-weight:600;margin-top:3px;color:var(--bone)}
.hint{margin-top:11px;font-family:var(--mono);font-size:10px;color:var(--muted);letter-spacing:.08em;text-align:center;text-transform:uppercase}

/* week nav */
.wk-nav{display:flex;align-items:center;justify-content:space-between;margin-bottom:13px}
.wk-nav .lbl{font-family:var(--mono);font-size:10.5px;letter-spacing:.14em;color:var(--muted);text-transform:uppercase}
.navb{width:30px;height:30px;border:1px solid var(--line);border-radius:8px;background:var(--panel);
  display:grid;place-items:center;color:var(--bone);cursor:pointer}
.navb:active{transform:scale(.92)}
.navb:disabled{opacity:.28;cursor:default}
.cell.future{opacity:.8}

/* provisional / status banner in preview */
.prov{display:flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;
  text-transform:uppercase;color:var(--hold);background:rgba(232,178,58,.1);
  border:1px solid rgba(232,178,58,.25);padding:9px 12px;border-radius:10px;margin-bottom:16px}
.prov.go{color:var(--go);background:rgba(95,208,138,.1);border-color:rgba(95,208,138,.25)}
.prov.flare{color:var(--flare);background:rgba(255,84,54,.1);border-color:rgba(255,84,54,.25)}

/* fuel chip */
.fuel{display:flex;align-items:flex-start;gap:9px;margin-top:12px;padding:11px 12px;border-radius:11px;
  background:rgba(95,208,138,.06);border:1px solid rgba(95,208,138,.18);font-size:12.5px;line-height:1.4;color:var(--bone)}
.fuel svg{color:var(--go);flex:0 0 auto;margin-top:1px}
.fuel b{font-weight:600}

/* food view */
.fhero{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);
  border-radius:18px;padding:18px;position:relative;overflow:hidden;margin-bottom:14px}
.fhero::after{content:"";position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(236,232,224,.25),transparent)}
.fhero-grid{display:flex;gap:26px;margin:15px 0}
.fhero-p{font-size:13px;line-height:1.5;color:var(--muted);margin:0}
.fcard{border:1px solid var(--line);border-radius:14px;background:var(--panel);margin-bottom:10px;overflow:hidden}
.fcard-h{display:flex;align-items:center;gap:12px;padding:15px 14px;cursor:pointer;user-select:none}
.fcard-t{flex:1;font-family:var(--disp);font-weight:600;font-size:16px;letter-spacing:.02em;text-transform:uppercase}
.fcard-b{padding:0 16px 16px 16px;animation:exp .26s ease}
.fp{font-size:13px;line-height:1.5;color:var(--bone);margin:0 0 4px}
.fp b{font-weight:600}
.ftriple{display:flex;flex-direction:column;gap:13px;margin-top:4px}
.flist{margin:0;padding-left:20px;display:flex;flex-direction:column;gap:8px}
.flist li{font-size:13px;line-height:1.45;color:var(--bone)}

/* bottom tab bar */
.tabbar{position:fixed;left:50%;bottom:calc(16px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:15;
  width:calc(100% - 36px);max-width:300px;display:flex;gap:5px;padding:5px;
  background:rgba(20,25,30,.92);backdrop-filter:blur(10px);border:1px solid var(--line);
  border-radius:16px;box-shadow:0 10px 36px rgba(0,0,0,.45)}
.tabbtn{flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;border:0;
  border-radius:12px;background:transparent;color:var(--muted);font-family:var(--disp);font-weight:600;
  font-size:14px;letter-spacing:.04em;text-transform:uppercase;cursor:pointer}
.tabbtn.on{background:var(--flare);color:#1a0a06}
.tabbtn:not(.on):active{background:rgba(236,232,224,.06)}

/* stretch routine */
.st-hero{background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line);
  border-radius:18px;padding:22px 18px;text-align:center;position:relative;overflow:hidden}
.st-hero::after{content:"";position:absolute;top:0;left:0;right:0;height:1px;
  background:linear-gradient(90deg,transparent,rgba(236,232,224,.25),transparent)}
.st-count{font-family:var(--mono);font-weight:600;font-size:64px;line-height:1;margin:10px 0 2px;
  font-variant-numeric:tabular-nums}
.st-move{font-family:var(--disp);font-weight:700;font-size:24px;letter-spacing:.03em;text-transform:uppercase;margin-top:6px}
.st-idx{font-family:var(--mono);font-size:10.5px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase}
.st-desc{font-size:13.5px;line-height:1.5;color:var(--bone);margin:12px auto 0;max-width:330px;text-align:left}
.st-focus{font-size:12px;color:var(--muted);margin:8px auto 0;max-width:330px;text-align:left}
.st-uncert{display:inline-flex;align-items:center;gap:6px;margin-top:10px;font-family:var(--mono);
  font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--hold);
  background:rgba(232,178,58,.1);border:1px solid rgba(232,178,58,.25);padding:5px 9px;border-radius:8px}
.st-bar{height:4px;background:rgba(236,232,224,.08);border-radius:4px;margin-top:16px;overflow:hidden}
.st-bar>i{display:block;height:100%;background:var(--go);border-radius:4px;transition:width 1s linear}
.st-ctrl{display:flex;gap:10px;margin-top:16px;justify-content:center}
.st-btn{width:56px;height:56px;border-radius:16px;border:1px solid var(--line);background:var(--panel2);
  display:grid;place-items:center;color:var(--bone);cursor:pointer}
.st-btn.main{width:76px;background:var(--flare);border-color:var(--flare);color:#1a0a06}
.st-btn:active{transform:scale(.94)}
.st-next{margin-top:16px;display:flex;flex-direction:column;gap:2px}
.st-row{display:flex;align-items:center;gap:12px;padding:11px 4px;border-bottom:1px solid var(--line)}
.st-row:last-child{border-bottom:0}
.st-row.done .st-nm{color:var(--muted);text-decoration:line-through}
.st-row.now .st-nm{color:var(--flare)}
.st-num{font-family:var(--mono);font-size:11px;color:var(--muted);width:20px;flex:0 0 auto}
.st-nm{font-weight:600;font-size:13.5px}
.st-sec{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--muted)}
`;

/* ------------------------- 5-min stretch routine ------------------------ */
/* Kilde: trevorsinstinct (Instagram). 10 øvelser × 30 s.
   uncertain: true = influencer-eget navn; beskrivelsen er en tolkning —
   se videoen for eksakt utførelse. */
const STRETCH = [
  { name: "Bouncing twists", desc: "Stå med løse armer. Roter overkroppen side til side i lett, sprettende rytme — armene slenger med.", focus: "Løst og ledig, ikke tving rotasjonen." },
  { name: "Arm circles", desc: "Store armsirkler — 15 sek framover, 15 sek bakover.", focus: "Full sirkel, hold skuldrene senket." },
  { name: "Aura farmers", desc: "Vekselvis strekk én arm på skrå opp og ut mens motsatt side lenes med — som å «male» en stor bue rundt kroppen.", focus: "Lang side, pust inn i strekken.", uncertain: true },
  { name: "Chiropractors", desc: "Stående rotasjon: armene i kryss over brystet eller ut, roter ryggsøylen rolig maksimalt til hver side.", focus: "Roter fra brystryggen, hoftene pekende fram.", uncertain: true },
  { name: "McGregors", desc: "Løse pendel-svinger: sving beina og hoftene løst side til side / fram og tilbake, à la McGregors oppvarming.", focus: "Hoftene skal slippe helt spenning.", uncertain: true },
  { name: "Side bends", desc: "Stå bredt, én arm over hodet, len deg rolig rett til siden. Bytt side halvveis.", focus: "Bøy rett til siden, ikke framover." },
  { name: "Body waves", desc: "Bølg gjennom ryggsøylen: start fra hodet og rull ned ledd for ledd, reverser opp — stående katt/ku.", focus: "Jevn bølge, hvert ledd med.", uncertain: true },
  { name: "Yogi lunges", desc: "Dypt utfall, bakbeinet strakt. Senk hoften, løft evt. innerste arm mot taket. Bytt side halvveis.", focus: "Kjenn strekken foran på hofta." },
  { name: "Hindu squats", desc: "Knebøy ned på tå mens armene svinger bak, opp igjen med armsving fram. Jevn, flytende rytme.", focus: "Flyt, ikke tyngde — dette er bevegelighet." },
  { name: "Deep squat rotations", desc: "Sitt i dyp knebøy, hælene i gulvet om mulig. Roter én arm mot taket, følg med blikket. Veksle sider.", focus: "Åpne brystet mot taket for hver rotasjon." },
];
const ST_SECONDS = 30;

function StretchView() {
  const [idx, setIdx] = useState(0);
  const [left, setLeft] = useState(ST_SECONDS);
  const [running, setRunning] = useState(false);
  const [doneAll, setDoneAll] = useState(false);
  const deadline = useRef(null);
  /* mirrors idx so the interval can advance without an impure state updater
     (StrictMode double-invokes updaters) */
  const idxRef = useRef(0);
  const setIdxBoth = (v) => { idxRef.current = v; setIdx(v); };

  /* Remaining time is derived from the clock, not counted in ticks —
     setInterval is throttled hard in background tabs and locked phones. */
  useEffect(() => {
    if (!running) return;
    deadline.current = Date.now() + left * 1000;
    const t = setInterval(() => {
      const now = Date.now();
      const rem = Math.ceil((deadline.current - now) / 1000);
      if (rem > 0) { setLeft(rem); return; }
      try { navigator.vibrate && navigator.vibrate(30); } catch (e) {}
      // catch up: a throttled tab can wake up several exercises late
      let ni = idxRef.current, d = deadline.current;
      while (d <= now && ni + 1 < STRETCH.length) { ni += 1; d += ST_SECONDS * 1000; }
      if (d <= now) { setIdxBoth(ni); setRunning(false); setDoneAll(true); setLeft(0); return; }
      deadline.current = d;
      setIdxBoth(ni);
      setLeft(Math.ceil((d - now) / 1000));
    }, 250);
    return () => clearInterval(t);
  }, [running]);

  /* Keep the screen awake while the routine runs. The OS releases the lock
     when the page is hidden, so re-request when it becomes visible again. */
  useEffect(() => {
    if (!running || typeof navigator === "undefined" || !navigator.wakeLock) return;
    let lock = null, active = true;
    const acquire = async () => {
      try {
        const l = await navigator.wakeLock.request("screen");
        if (!active) { l.release(); return; }
        lock = l;
      } catch (e) { /* denied — timer still runs on the clock */ }
    };
    acquire();
    const onVis = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onVis);
      try { lock && lock.release(); } catch (e) {}
    };
  }, [running]);

  function toggle() {
    if (doneAll) { setIdxBoth(0); setLeft(ST_SECONDS); setDoneAll(false); setRunning(true); return; }
    setRunning((r) => !r);
  }
  function skip() {
    if (idx + 1 >= STRETCH.length) { setRunning(false); setDoneAll(true); return; }
    deadline.current = Date.now() + ST_SECONDS * 1000;
    setIdxBoth(idx + 1); setLeft(ST_SECONDS);
  }
  function restart() { deadline.current = null; setIdxBoth(0); setLeft(ST_SECONDS); setDoneAll(false); setRunning(false); }

  const cur = STRETCH[idx];
  const totalDone = idx * ST_SECONDS + (ST_SECONDS - left);
  const totalPct = doneAll ? 100 : Math.round((totalDone / (STRETCH.length * ST_SECONDS)) * 100);

  return (
    <div className="fade">
      <div className="st-hero">
        <div className="tag" style={{ justifyContent: "center" }}>
          <Wind size={12} /> 5 min daglig rutine · {STRETCH.length} øvelser × 30 s
        </div>
        {doneAll ? (
          <>
            <div className="st-count" style={{ color: "var(--go)" }}>✓</div>
            <div className="st-move">Rutine fullført</div>
            <p className="st-desc" style={{ textAlign: "center" }}>5 minutter i boks. Samme tid i morgen.</p>
          </>
        ) : (
          <>
            <div className="st-idx">Øvelse {idx + 1} / {STRETCH.length}</div>
            <div className="st-count" style={{ color: left <= 5 && running ? "var(--flare)" : "var(--bone)" }}>{left}</div>
            <div className="st-move">{cur.name}</div>
            <p className="st-desc">{cur.desc}</p>
            <p className="st-focus">Tenk på: {cur.focus}</p>
            {cur.uncertain && (
              <div className="st-uncert">Tolket navn — se videoen for eksakt utførelse</div>
            )}
          </>
        )}
        <div className="st-bar"><i style={{ width: `${totalPct}%` }} /></div>
        <div className="st-ctrl">
          <button className="st-btn" onClick={restart} aria-label="Start på nytt"><RotateCcw size={19} /></button>
          <button className="st-btn main" onClick={toggle} aria-label={running ? "Pause" : "Start"}>
            {doneAll ? <RotateCcw size={23} /> : running ? <Pause size={23} /> : <Play size={23} />}
          </button>
          <button className="st-btn" onClick={skip} aria-label="Neste øvelse" disabled={doneAll}><SkipForward size={19} /></button>
        </div>
      </div>

      <div className="st-next">
        {STRETCH.map((m, i) => (
          <div className={`st-row ${i < idx || doneAll ? "done" : ""} ${i === idx && !doneAll ? "now" : ""}`} key={m.name}>
            <div className="st-num">{i + 1}</div>
            <div className="st-nm">{m.name}</div>
            <div className="st-sec">30 s</div>
          </div>
        ))}
      </div>
    </div>
  );
}
const TYPE_LABEL = {
  easyrun: "Utholdenhet", strA: "Styrke", strB: "Styrke", intervals: "Fart",
  mobility: "Restitusjon", brick: "Spesifikk", skills: "Ferdighet", longrun: "Utholdenhet",
};

/* contextual fuel cue per session type */
const FUEL = {
  brick:     { t: "Tank opp", d: "Ekstra karbo i dag — ris, pasta, potet eller brød etter økta." },
  intervals: { t: "Tank opp", d: "Litt ekstra karbo, og protein etter økta." },
  longrun:   { t: "Tank opp", d: "Ukas lengste økt — ekstra karbo før og etter." },
  strA:      { t: "Bygg", d: "Protein ved hvert måltid — muskelen bygges etter denne." },
  strB:      { t: "Bygg", d: "Protein ved hvert måltid — muskelen bygges etter denne." },
  skills:    { t: "Bygg", d: "Protein ved hvert måltid for restitusjon." },
  easyrun:   { t: "Vanlig", d: "Vanlig mat. Protein ved hvert måltid." },
  mobility:  { t: "Lett dag", d: "Vanlig mat — ikke kutt protein selv om det er rolig." },
};

/* collapsible card for the food reference */
function FoodSection({ icon: Ico, title, children, defOpen = false }) {
  const [open, setOpen] = useState(defOpen);
  return (
    <div className="fcard">
      <div className="fcard-h" onClick={() => setOpen((o) => !o)}>
        <div className="rico"><Ico size={16} /></div>
        <div className="fcard-t">{title}</div>
        <ChevronRight size={16} className={`row-chev ${open ? "open" : ""}`} />
      </div>
      {open && <div className="fcard-b">{children}</div>}
    </div>
  );
}

function FoodView() {
  return (
    <div className="fade">
      <div className="fhero">
        <div className="tag"><span className="dot" style={{ background: "var(--flare)" }} /> Din drivstoffplan</div>
        <div className="fhero-grid">
          <div className="metric"><div className="k">Protein / dag</div><div className="v">130–150<small>g</small></div></div>
          <div className="metric"><div className="k">Mål</div><div className="v" style={{ fontSize: 15 }}>Vokse, ikke kutte</div></div>
        </div>
        <p className="fhero-p">Du er allerede slank — spis i et lite overskudd. Vekta skal ikke falle mens du trener hardt. Protein ved hvert måltid betyr mest.</p>
      </div>

      <FoodSection icon={Target} title="Formelen" defOpen>
        <p className="fp"><b>Hver middag = 1 protein + 1 karbo + grønt.</b> Det er hele systemet.</p>
        <div className="ftriple">
          <div><div className="exp-k">Protein</div><div className="fp">Kylling · kjøttdeig · biff · fisk · egg</div></div>
          <div><div className="exp-k">Karbo</div><div className="fp">Ris · pasta · poteter · brød · havre</div></div>
          <div><div className="exp-k">Grønt</div><div className="fp">Brokkoli · gulrot · paprika · salat · mais · erter</div></div>
        </div>
      </FoodSection>

      <FoodSection icon={Utensils} title="7 middager som går igjen">
        <ol className="flist">
          <li>Kylling, ris, brokkoli</li>
          <li>Spaghetti med kjøttdeigsaus (riv gulrot i sausen)</li>
          <li>Poteter, kjøtt, dampet grønt</li>
          <li>Pasta med skinke, ost og erter</li>
          <li>Fisk, poteter, gulrot</li>
          <li>Tacofredag — kjøttdeig, mais, paprika, salat</li>
          <li>«Rydde-kjøleskapet» — stekt ris med egg, kylling og grønt</li>
        </ol>
      </FoodSection>

      <FoodSection icon={Flame} title="5 regler for en travel uke">
        <ol className="flist">
          <li>Lag alltid dobbel porsjon — lunsj neste dag er gratis.</li>
          <li>Forhåndssteik én proteinkilde i helga, bruk i tre retter.</li>
          <li>Frossen grønnsak teller fullt ut.</li>
          <li>Formel-middag når alt skjærer seg: protein + karbo + frossen grønt på 15 min.</li>
          <li>Handle til formelen, ikke til oppskrifter.</li>
        </ol>
      </FoodSection>

      <FoodSection icon={ShoppingCart} title="Handleliste (basis)">
        <div className="ftriple">
          <div><div className="exp-k">Protein</div><div className="fp">Kylling · kjøttdeig · biff · fisk · egg · bacon · skinke · salami</div></div>
          <div><div className="exp-k">Karbo</div><div className="fp">Grovt brød · pasta · ris · poteter · havregryn</div></div>
          <div><div className="exp-k">Grønt / frukt</div><div className="fp">Brokkoli · gulrot · paprika · agurk · salat · mais · erter · løk · tomat · frukt</div></div>
          <div><div className="exp-k">Meieri / annet</div><div className="fp">Smør · ost · yoghurt · melk · olje · krydder</div></div>
        </div>
      </FoodSection>
    </div>
  );
}

function SyncSheet({ user, sync, onClose }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("form");   // form | sending | sent | error
  const [err, setErr] = useState("");

  async function submit(e) {
    e.preventDefault();
    if (!email.trim()) return;
    setState("sending");
    try { await cloud.sendMagicLink(email.trim()); setState("sent"); }
    catch (ex) { setErr(ex.message || "Ukjent feil"); setState("error"); }
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <div className="sheet-t">{user ? "Synk på tvers av enheter" : "Slå på synk"}</div>
          <button className="iconbtn" onClick={onClose}><X size={16} /></button>
        </div>

        {user ? (
          <>
            <div className="sheet-sub">
              Innlogget som {user.email}.{" "}
              {sync === "error"
                ? "Siste synk feilet — fremdriften ligger trygt lokalt og sendes ved neste økt."
                : "Fremdriften lagres lokalt og speiles til skyen."}
            </div>
            <button className="cta" onClick={async () => { await cloud.signOut(); onClose(); }}>
              Logg ut
            </button>
          </>
        ) : state === "sent" ? (
          <div className="sheet-sub">
            Sjekk e-posten din — vi sendte en lenke til {email}. Åpne den på denne enheten,
            så er du logget inn.
          </div>
        ) : (
          <>
            <div className="sheet-sub">
              Uten innlogging lagres fremdriften kun på denne enheten. Logg inn med e-post
              for å dele den mellom telefon og laptop. Ingen passord — du får en lenke.
            </div>
            <form onSubmit={submit}>
              <input
                className="tinput"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="din@epost.no"
                autoComplete="email"
              />
              {state === "error" && (
                <div className="sheet-sub" style={{ color: "var(--hard)", marginTop: 10 }}>{err}</div>
              )}
              <button className="cta" type="submit" disabled={state === "sending"} style={{ marginTop: 14 }}>
                <Mail size={18} /> {state === "sending" ? "Sender …" : "Send innloggingslenke"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [logs, setLogs] = useState({});
  const [sheet, setSheet] = useState(false);
  const [preview, setPreview] = useState(null);
  const [viewWeek, setViewWeek] = useState(1);
  const [tab, setTab] = useState("train");
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const lastAction = useRef(null);
  const [user, setUser] = useState(null);
  const [sync, setSync] = useState("idle");   // idle | syncing | ok | error
  const [authSheet, setAuthSheet] = useState(false);
  const localAt = useRef(0);                  // updatedAt of what's on screen

  const finished = index >= SESSIONS.length;
  const session = finished ? null : SESSIONS[index];
  const w = session ? session.week : 10;

  useEffect(() => { setViewWeek(w); }, [w]);

  useEffect(() => {
    (async () => {
      const raw = await store.get(KEY);
      if (raw) {
        try {
          const s = JSON.parse(raw);
          setIndex(s.index || 0); setLogs(s.logs || {}); localAt.current = s.updatedAt || 0;
        } catch (e) {}
      }
      setLoaded(true);
    })();
  }, []);

  /* Cloud sync is additive: the app above never waits on it, and every path
     here is skipped entirely when the env vars are absent. */
  useEffect(() => {
    if (!cloud.enabled) return;
    cloud.getUser().then(setUser).catch(() => {});
    return cloud.onAuthChange(setUser);
  }, []);

  /* On login (and on load when already logged in): reconcile once, both ways. */
  useEffect(() => {
    if (!cloud.enabled || !user || !loaded) return;
    let cancelled = false;
    (async () => {
      setSync("syncing");
      try {
        const local = { index, logs, updatedAt: localAt.current };
        const remote = await cloud.pull(user.id);
        if (cancelled) return;
        const winner = cloud.newer(local, remote);
        if (winner === remote) {
          setIndex(remote.index); setLogs(remote.logs); localAt.current = remote.updatedAt;
          await store.set(KEY, JSON.stringify(remote));
          showToast("Hentet fremdrift fra skyen.", "var(--go)");
        } else if (!remote || winner.updatedAt > (remote.updatedAt ?? 0)) {
          await cloud.push(user.id, local);
        }
        if (!cancelled) setSync("ok");
      } catch (e) {
        if (!cancelled) setSync("error");
      }
    })();
    return () => { cancelled = true; };
  }, [user, loaded]);

  const persist = (i, l) => {
    const state = { index: i, logs: l, updatedAt: Date.now() };
    localAt.current = state.updatedAt;
    store.set(KEY, JSON.stringify(state));
    /* Fire and forget — a failed push must never block logging a session.
       The next successful sync carries it, since updatedAt still wins. */
    if (cloud.enabled && user) {
      setSync("syncing");
      cloud.push(user.id, state).then(() => setSync("ok"), () => setSync("error"));
    }
  };

  const a = session ? adapt(session, index, logs) : null;
  /* what the hero + list render: the session with the adapted dose applied */
  const shown = session && a ? withLoad(session, a.load) : session;

  function complete(rpeKey) {
    lastAction.current = { index, logs };
    const newLogs = { ...logs, [session.id]: rpeKey };
    const newIndex = index + 1;
    setLogs(newLogs); setIndex(newIndex); setSheet(false);
    persist(newIndex, newLogs);
    // preview next adaptation
    const next = SESSIONS[newIndex];
    let msg = "Økt logget.";
    if (next && next.load != null) {
      const na = adapt(next, newIndex, newLogs);
      msg = na.note ? na.note : "Neste økt: planen holder.";
    }
    showToast(msg, RPE[rpeKey].color, true);
  }

  function skipSession() {
    lastAction.current = { index, logs };
    const newLogs = { ...logs, [session.id]: SKIPPED };
    const newIndex = index + 1;
    setLogs(newLogs); setIndex(newIndex); setSheet(false);
    persist(newIndex, newLogs);
    showToast("Økt hoppet over — programmet går videre.", "var(--muted)", true);
  }

  function undo() {
    const prev = lastAction.current;
    if (!prev) return;
    lastAction.current = null;
    setIndex(prev.index); setLogs(prev.logs);
    persist(prev.index, prev.logs);
    showToast("Angret — økten er åpen igjen.", "var(--muted)");
  }

  function showToast(msg, color, undoable = false) {
    setToast({ msg, color, undoable });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), undoable ? 6000 : 3200);
  }

  function reset() {
    if (!window.confirm("Nullstille all fremdrift?")) return;
    setIndex(0); setLogs({}); persist(0, {});
    showToast("Fremdrift nullstilt.", "var(--muted)");
  }

  if (!loaded) {
    return (
      <div className="nr-root">
        <style>{CSS}</style>
        <div className="nr-wrap" style={{ display: "grid", placeItems: "center" }}>
          <div className="mono" style={{ color: "var(--muted)", letterSpacing: ".2em", fontSize: 12 }}>
            LASTER…
          </div>
        </div>
      </div>
    );
  }

  const phase = session ? session.phase : "Fullført";
  const pct = Math.round((index / SESSIONS.length) * 100);
  const vWeekStart = (viewWeek - 1) * 7;
  const cells = SESSIONS.slice(vWeekStart, vWeekStart + 7);

  return (
    <div className="nr-root">
      <style>{CSS}</style>
      <div className="nr-noise" />
      <div className="nr-wrap">

        {/* header */}
        <div className="hd fade">
          <div>
            <div className="hd-title">NAVY RACE<span style={{ color: "var(--flare)" }}>·</span>10</div>
            <div className="hd-sub">Uke {w} / 10 &nbsp;·&nbsp; {phase}</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {cloud.enabled && (
              <button
                className="iconbtn"
                onClick={() => setAuthSheet(true)}
                aria-label={user ? "Sky-synk på" : "Slå på sky-synk"}
                title={user ? `Synk: ${user.email}` : "Ikke innlogget"}
                style={sync === "error" ? { color: "var(--hard)" } : user ? { color: "var(--go)" } : undefined}
              >
                {sync === "syncing"
                  ? <RefreshCw size={15} className="spin" />
                  : user ? <Cloud size={15} /> : <CloudOff size={15} />}
              </button>
            )}
            <button className="iconbtn" onClick={reset} aria-label="Nullstill"><RotateCcw size={15} /></button>
          </div>
        </div>
        <div className="prog fade"><i style={{ width: `${pct}%` }} /></div>

        {tab === "train" && (<>
        {finished ? (
          <div className="hero fade">
            <div className="htitle">Blokk fullført</div>
            <p style={{ color: "var(--muted)", fontSize: 14, lineHeight: 1.5, marginTop: 8 }}>
              10 uker i boks. Hvil, spis, sov — du blir ikke sterkere de siste dagene, bare sliten.
              Vi sees på startstreken på Karljohansvern.
            </p>
            <button className="cta" onClick={reset} style={{ marginTop: 20 }}>
              <RotateCcw size={18} /> Start på nytt
            </button>
          </div>
        ) : (
          <>
            {/* hero — today's session */}
            <div className="hero fade" style={{ animationDelay: ".05s" }}>
              <div className="hero-top">
                <div className="tag">
                  <span className="dot" style={{ background: "var(--flare)" }} />
                  Dagens økt · {DAYS[session.day]}
                </div>
                <div className="tag mono">{TYPE_LABEL[session.type]}</div>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div className="hicon"><session.icon size={22} /></div>
                <div>
                  <div className="htitle">{session.title}</div>
                </div>
              </div>

              <div className="hmeta">
                <div className="metric">
                  <div className="k">Varighet</div>
                  <div className="v">{shown.est}</div>
                </div>
                {a && a.load != null && (
                  <div className="metric">
                    <div className="k">Dose</div>
                    <div className="v" style={{ color: a.note ? (a.dir === "down" ? "var(--hold)" : "var(--go)") : "var(--bone)" }}>
                      {a.load}<small>{session.unit}</small>
                    </div>
                  </div>
                )}
                <div className="metric">
                  <div className="k">Øvelser</div>
                  <div className="v">{shown.items.length}</div>
                </div>
              </div>

              {a && a.note && (
                <div className="adapt">
                  <div className="ai" style={{ background: a.dir === "down" ? "rgba(232,178,58,.15)" : "rgba(95,208,138,.15)" }}>
                    <Activity size={14} style={{ color: a.dir === "down" ? "var(--hold)" : "var(--go)" }} />
                  </div>
                  <span>{a.note}</span>
                </div>
              )}

              {FUEL[session.type] && (
                <div className="fuel">
                  <Utensils size={13} />
                  <span><b>{FUEL[session.type].t}.</b> {FUEL[session.type].d}</span>
                </div>
              )}
            </div>

            {/* exercise list */}
            <div className="list fade" style={{ animationDelay: ".12s" }}>
              {shown.items.map((it, i) => <ExerciseRow item={it} key={i} />)}
            </div>
            <div className="hint">Trykk en øvelse for teknikk + pause</div>

            <button className="cta fade" style={{ animationDelay: ".18s" }} onClick={() => setSheet(true)}>
              <Check size={19} /> Fullfør økt
            </button>
            <button className="skipbtn fade" style={{ animationDelay: ".2s" }} onClick={skipSession}>
              Hopp over økt · hvile / ikke gjort
            </button>
          </>
        )}

        {/* week browser */}
        <div className="wk fade" style={{ animationDelay: ".24s" }}>
          <div className="wk-nav">
            <button className="navb" disabled={viewWeek <= 1} onClick={() => setViewWeek((v) => Math.max(1, v - 1))} aria-label="Forrige uke">
              <ChevronRight size={15} style={{ transform: "rotate(180deg)" }} />
            </button>
            <div className="lbl">Uke {viewWeek} · {PHASES(viewWeek)}{viewWeek === w ? " · nå" : ""}</div>
            <button className="navb" disabled={viewWeek >= 10} onClick={() => setViewWeek((v) => Math.min(10, v + 1))} aria-label="Neste uke">
              <ChevronRight size={15} />
            </button>
          </div>
          <div className="wk-grid">
            {cells.map((c, i) => {
              const gIdx = vWeekStart + i;
              const skipped = logs[c.id] === SKIPPED;
              const done = !!logs[c.id] && !skipped;
              const isToday = gIdx === index;
              const future = gIdx > index;
              const Ico = c.icon;
              return (
                <div
                  className={`cell ${done ? "done" : ""} ${skipped ? "skip" : ""} ${isToday ? "today" : ""} ${future ? "future" : ""}`}
                  key={c.id}
                  onClick={() => setPreview(c)}
                >
                  <div className="d">{DAYS[c.day]}</div>
                  {done ? <Check size={15} /> : skipped ? <X size={15} /> : <Ico size={15} />}
                </div>
              );
            })}
          </div>
          <div className="hint">Bla mellom uker · trykk en dag for å se økten</div>
        </div>

        {/* race marker */}
        <div className="race fade" style={{ animationDelay: ".3s" }}>
          <Anchor size={20} style={{ color: "var(--flare)", flex: "0 0 auto" }} />
          <div>
            <div className="f">NAVY RACE · HORTEN</div>
            <div className="s">8 KM · 30 HINDRE · KARLJOHANSVERN</div>
          </div>
        </div>
        </>)}

        {tab === "food" && <FoodView />}

        {/* kept mounted so the running timer survives tab switches */}
        <div style={{ display: tab === "stretch" ? undefined : "none" }}>
          <StretchView />
        </div>

        {/* bottom tab bar */}
        <div className="tabbar" style={{ maxWidth: 380 }}>
          <button className={`tabbtn ${tab === "train" ? "on" : ""}`} onClick={() => setTab("train")}>
            <Footprints size={18} /><span>I dag</span>
          </button>
          <button className={`tabbtn ${tab === "food" ? "on" : ""}`} onClick={() => setTab("food")}>
            <Utensils size={18} /><span>Mat</span>
          </button>
          <button className={`tabbtn ${tab === "stretch" ? "on" : ""}`} onClick={() => setTab("stretch")}>
            <Wind size={18} /><span>Rutine</span>
          </button>
        </div>
      </div>

      {/* sync sheet */}
      {authSheet && (
        <SyncSheet user={user} sync={sync} onClose={() => setAuthSheet(false)} />
      )}

      {/* check-in sheet */}
      {sheet && (
        <div className="scrim" onClick={() => setSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-h">
              <div className="sheet-t">Hvordan føltes økten?</div>
              <button className="iconbtn" onClick={() => setSheet(false)}><X size={16} /></button>
            </div>
            <div className="sheet-sub">Svaret justerer neste lignende økt automatisk.</div>
            <div className="opts">
              {[
                ["lett", "Hadde mer å gå på", "Neste skrus opp ~8 %"],
                ["passe", "Akkurat passe hardt", "Planen holder"],
                ["brutalt", "Måtte grave dypt", "Neste lettes ~10 %"],
              ].map(([k, t, d]) => (
                <button className="opt" key={k} onClick={() => complete(k)}>
                  <span className="ob" style={{ background: RPE[k].color }} />
                  <div>
                    <div className="ot">{t}</div>
                    <div className="od">{d}</div>
                  </div>
                  <ChevronRight size={18} className="chev" />
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* day preview sheet */}
      {preview && (() => {
        const pIdx = SESSIONS.indexOf(preview);
        const isSkipped = logs[preview.id] === SKIPPED;
        const isDone = !!logs[preview.id] && !isSkipped;
        const isToday = pIdx === index;
        const isFuture = pIdx > index;
        return (
          <div className="scrim" onClick={() => setPreview(null)}>
            <div className="sheet" onClick={(e) => e.stopPropagation()} style={{ maxHeight: "82vh", overflowY: "auto" }}>
              <div className="sheet-h">
                <div className="sheet-t">{preview.title}</div>
                <button className="iconbtn" onClick={() => setPreview(null)}><X size={16} /></button>
              </div>
              <div className="sheet-sub">Uke {preview.week} · {DAYS[preview.day]} · {preview.est}</div>
              {isDone && (
                <div className="prov go"><Check size={13} /> Fullført · du svarte «{RPE[logs[preview.id]].label}»</div>
              )}
              {isSkipped && (
                <div className="prov"><X size={13} /> Hoppet over</div>
              )}
              {isToday && (
                <div className="prov flare"><Target size={13} /> Dette er dagens økt</div>
              )}
              {isFuture && (
                <div className="prov"><Activity size={13} /> Forslag · tallene justeres etter hvordan ukene dine går</div>
              )}
              <div className="list">
                {preview.items.map((it, i) => <ExerciseRow item={it} key={i} />)}
              </div>
              <div className="hint">Trykk en øvelse for teknikk + pause</div>
            </div>
          </div>
        );
      })()}

      {/* toast */}
      {toast && (
        <div className="toast">
          <div className="ti" style={{ background: "rgba(236,232,224,.06)" }}>
            <Activity size={15} style={{ color: toast.color }} />
          </div>
          <div className="tt">{toast.msg}</div>
          {toast.undoable && (
            <button className="tundo" onClick={undo}>Angre</button>
          )}
        </div>
      )}
    </div>
  );
}
