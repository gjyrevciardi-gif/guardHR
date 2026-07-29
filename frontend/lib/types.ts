export type ReviewStatus = "No events detected" | "Requires review" | "Review completed" | "Insufficient evidence";
export type EventType = "tab_hidden" | "fullscreen_exit" | "camera_disabled" | "face_not_visible" | "multiple_people" | "phone_detected" | "screen_share_stopped" | "copy_paste" | "connection_interruption" | "window_resized" | "multiple_monitors";

export interface User { id: string; email: string; full_name: string; role: string; retention_days: number }
export interface Candidate { id: string; email: string | null; full_name: string }
export interface IntegrityEvent { id: string; event_type: EventType; started_at: string; ended_at: string | null; duration_seconds: number | null; confidence_score: number | null; metadata: Record<string, unknown> }
export interface Review { id: string; outcome: string; notes: string; created_at: string; updated_at: string }
export interface TestQuestion { id: string; position: number; prompt: string; options: string[] }
export interface Test { id: string; title: string; description: string | null; created_at: string; question_count: number; questions: TestQuestion[] }
export interface TestSubmission { id: string; test_id: string; score: number; total: number; answers: Record<string, number>; submitted_at: string }
export interface InterviewSession {
  id: string; title: string; public_token: string; status: string; review_status: ReviewStatus;
  invite_email_sent: boolean | null; invite_email_error: string | null;
  test: Test | null; test_submission: TestSubmission | null;
  require_screen_share: boolean; candidate: Candidate; expires_at: string; consented_at: string | null;
  started_at: string | null; ended_at: string | null; created_at: string; event_count: number;
  events: IntegrityEvent[]; reviews: Review[];
}
export interface PublicSession { title: string; candidate_name: string; status: string; require_screen_share: boolean; expires_at: string; consented_at: string | null; test: Test | null }
export interface AuditLog { id: string; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown>; ip_address: string | null; created_at: string }
