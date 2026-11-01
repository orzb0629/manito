export type ActivityDay = { day: number; date: string; title: string; description: string; open: boolean };
export type MissionLog = { day: number; done: boolean; text: string; mood: string };
// Deliberately not the demo Game shape: no roster, codes, all assignments or other journals.
export type StudentSnapshot = {
 className: string; student: { id: string; name: string }; pledged: boolean;
 mate: { name: string } | null; revealed: boolean;
 days: ActivityDay[]; logs: MissionLog[];
 // The property itself is absent before teacher confirmation, not merely null.
 caredBy?: { name: string } | null;
};
export type AssignmentVersions={rosterVersion:number;settingsVersion:number};
export type AssignmentPreview = AssignmentVersions & { draftId: string; pairs: { giver: string; receiver: string }[]; confirmation: string; state:TeacherSnapshot };
export type RevealConfirmation = { confirmation: string; expiresIn: number };
export type TeacherClass = {id:string;name:string;status:'setup'|'locked'|'revealed'};
export type DaySettings = Omit<ActivityDay,'open'>;
export type TeacherStudent = {id:string;name:string;hasCode:boolean;pledged:boolean;completedDays:number[]};
export type TeacherSnapshot = TeacherClass & {rosterVersion:number;settingsVersion:number;students:TeacherStudent[];days:DaySettings[]};
export interface StudentRepository {
 login(code: string): Promise<{ ok: true }>;
 logout(): Promise<{ ok: true }>;
 snapshot(): Promise<StudentSnapshot>;
 pledge(): Promise<{ ok: true }>;
 saveLog(input: MissionLog): Promise<{ ok: true }>;
}
