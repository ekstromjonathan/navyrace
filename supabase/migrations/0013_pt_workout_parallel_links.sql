-- Allow several still-valid messages to open the same planned session.
-- Completion remains deduplicated by the shared journal entry key.

drop index if exists pt.pt_workout_instances_live_identity;

create index if not exists pt_workout_instances_identity
  on pt.workout_instances (user_id, track_id, session_ref, local_date, plan_version)
  where revoked_at is null;
