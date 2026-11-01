// Phase 1 schema contract. Regenerate with Supabase CLI after applying migrations.
type Table<Row, Required extends keyof Row = never> = {
 Row: Row; Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
 Update: Partial<Row>; Relationships: [];
};
type ClassRow = { id:string; teacher_id:string; name:string; status:'setup'|'locked'|'revealed'; roster_version:number; settings_version:number; locked_at:string|null; revealed_at:string|null; active:boolean; created_at:string };
type DayRow = { class_id:string; day:number; scheduled_date:string };
type StudentRow = { id:string; class_id:string; name:string; credential_version:number; created_at:string };
type AssignmentRow = { class_id:string; giver_id:string; receiver_id:string };
type MissionRow = { class_id:string; day:number; title:string; description:string };
type LogRow = { class_id:string; student_id:string; day:number; done:boolean; body:string; mood:string; updated_at:string };
type PledgeRow = { class_id:string; student_id:string; pledged_at:string };
type CredentialRow = { student_id:string; code_hash:string; version:number; expires_at:string; created_at:string };
export type Database = {
 public: {
  Tables: {
   classes:Table<ClassRow,'teacher_id'|'name'>;
   activity_days:Table<DayRow,keyof DayRow>;
   students:Table<StudentRow,'class_id'|'name'>;
   assignments:Table<AssignmentRow,keyof AssignmentRow>;
   missions:Table<MissionRow,keyof MissionRow>;
   mission_logs:Table<LogRow,'class_id'|'student_id'|'day'|'mood'>;
   pledges:Table<PledgeRow,'class_id'|'student_id'>;
   access_credentials:Table<CredentialRow,'student_id'|'code_hash'|'version'|'expires_at'>;
  };
  Views: Record<string,never>;
  // Server RPCs intentionally omitted from browser client contract.
  Functions: Record<string,never>;
  Enums: Record<string,never>;
  CompositeTypes: Record<string,never>;
 };
};
