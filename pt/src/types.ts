export type TrackKind = "training" | "nutrition" | "habit" | "recovery" | "custom";
export type TrackStatus = "draft" | "active" | "archived";
export type EntrySource = "heuristic" | "llm" | "user";

export type Quantity = { value: number; unit: string };

export type Pending =
  | {
      type: "question";
      field: string;
      trackId?: string;
      askedAt: string;
    }
  | {
      type: "activate_confirm";
      trackId: string;
      summary: string;
      askedAt: string;
    }
  | {
      type: "archive_confirm";
      trackId: string;
      summary: string;
      askedAt: string;
    }
  | {
      type: "reminder_scope";
      hour: number;
      minute: number;
      askedAt: string;
    }
  | {
      /** User sent a link — waiting for clock time before setting reminder. */
      type: "video_reminder_time";
      url: string;
      askedAt: string;
    }
  | {
      /** Ask which calendar day a free-form session log belongs to. */
      type: "log_day";
      note: string;
      quality: string | null;
      claimsPlanned: boolean;
      extra?: boolean;
      askedAt: string;
    }
  | {
      /** After logging a session without effort — wait for lett/passe/brutalt. */
      type: "rpe_followup";
      entryId: string;
      askedAt: string;
    }
  | {
      /** Offered swap vs easy today after stacked days — waiting for bytte / rolig. */
      type: "adapt_choice";
      askedAt: string;
    }
  | {
      /** Owner: admit or deny a waitlisted sender. */
      type: "invite_approve";
      inviteId: string;
      askedAt: string;
    };

export type UserFacts = {
  goal?: string;
  level?: string;
  /** Who they want to become through training (identity-based motivation). */
  identity?: string;
  /** Why the change matters to them personally. */
  why?: string;
  daysPerWeek?: number;
  equipment?: string[];
  weightKg?: number;
  injuries?: string[];
  nutrition?: Record<string, unknown>;
  uiLang?: "nb" | "en" | "sv";
  [k: string]: unknown;
};

export type UserRow = {
  id: string;
  chat_id: string;
  phone_e164: string | null;
  tz: string;
  locale: string;
  display_name: string | null;
  facts: string;
  pending: string | null;
  health_status: string;
  last_contact_card_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TrackRow = {
  id: string;
  user_id: string;
  kind: TrackKind;
  slug: string;
  name: string;
  tags: string;
  status: TrackStatus;
  plan: string | null;
  version: number;
  supersedes_id: string | null;
  archive_reason: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PlanSession = {
  id: string;
  week?: number;
  /** Monday = 0 … Sunday = 6. Session belongs to this weekday, not a queue. */
  day?: number;
  title: string;
  loadKey?: string;
  load?: number;
  unit?: string;
  items?: { name: string; detail?: string; cue?: string; timer?: WorkoutTimerSpec }[];
  est?: string;
  timer?: WorkoutTimerSpec;
};

export type Plan = {
  weeks?: number;
  daysPerWeek?: number;
  /** Local YYYY-MM-DD when the plan was locked. Week 1 starts that week's Monday. */
  startedOn?: string;
  sessions: PlanSession[];
};

export type WorkoutTimerSpec = {
  mode: "countdown" | "intervals" | "tabata";
  workSeconds: number;
  restSeconds: number;
  rounds: number;
  prepareSeconds?: number;
};

export type WorkoutExercise = {
  id: string;
  name: string;
  detail: string | null;
  cue: string | null;
};

export type WorkoutBlock = {
  id: string;
  kind: "instruction" | "sets" | "intervals" | "tabata" | "cooldown";
  title: string;
  detail: string | null;
  exercises: WorkoutExercise[];
  timer: WorkoutTimerSpec | null;
};

export type WorkoutSnapshot = {
  version: 1;
  sessionRef: string;
  localDate: string;
  title: string;
  estimate: string | null;
  reason: string;
  blocks: WorkoutBlock[];
};

export type WorkoutFeedback = {
  quality: "lett" | "passe" | "brutalt";
  body: "good" | "tight" | "pain";
  note?: string;
  clientCompletionId: string;
};

export type WorkoutInstanceRow = {
  id: string;
  user_id: string;
  track_id: string;
  session_ref: string;
  local_date: string;
  plan_version: number;
  snapshot: string;
  token_hash: string;
  expires_at: string;
  opened_at: string | null;
  completed_at: string | null;
  completion_entry_id: string | null;
  client_completion_id: string | null;
  feedback: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InviteStatus = "pending" | "approved" | "denied";

export type InviteRow = {
  id: string;
  phone_e164: string;
  chat_id: string;
  name: string | null;
  first_body: string;
  status: InviteStatus;
  notified_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReminderKind = "train";

export type ReminderRow = {
  id: string;
  user_id: string;
  kind: ReminderKind;
  slug: string;
  title: string;
  hour: number;
  minute: number;
  enabled: number;
  last_fired_on: string | null;
  /** Local YYYY-MM-DD for one-shot; null = daily. */
  once_on: string | null;
  /** Optional link included in the reminder ping. */
  url: string | null;
  created_at: string;
  updated_at: string;
};

export type ReminderFilter = {
  slug?: string;
  hour?: number;
  minute?: number;
};

export type CoachEventKind =
  | "action_proposed"
  | "action_accepted"
  | "action_deferred"
  | "action_declined"
  | "workout_opened"
  | "workout_completed"
  | "reminder_snoozed"
  | "reminder_ignored"
  | "memory_corrected"
  | "privacy_requested"
  | "safety_routed";

export type CoachEventSource = "user" | "coach" | "system" | "integration";

export type CoachEventRow = {
  id: string;
  user_id: string;
  kind: CoachEventKind;
  source: CoachEventSource;
  ref_id: string | null;
  dedupe_key: string | null;
  /** Structured JSON only; never copy raw message bodies here. */
  metadata: string;
  created_at: string;
};

export type ChatTurn = {
  role: "user" | "pt";
  body: string;
  linq_message_id: string | null;
  created_at: string;
};

export type Inbound = {
  eventId: string;
  messageId: string;
  chatId: string;
  phone: string | null;
  body: string;
  direction: string;
  isGroup: boolean;
  healthStatus: string | null;
  service: string | null;
};
