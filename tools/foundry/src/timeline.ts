import { randomUUID } from "node:crypto";

export type TimelineEventType =
  | "session_start"
  | "session_end"
  | "gpt_planned"
  | "plan_approved"
  | "plan_rejected"
  | "worker_started"
  | "worker_finished"
  | "cursor_started"
  | "cursor_finished"
  | "supervisor_redirect"
  | "supervisor_stop"
  | "verify_started"
  | "verify_finished"
  | "conflict_detected"
  | "approval_required"
  | "approval_resolved"
  | "recovery_saved"
  | "recovery_resumed"
  | "rollback"
  | "error"
  | "note";

export interface TimelineEvent {
  id: string;
  ts: string;
  type: TimelineEventType;
  message: string;
  round?: number;
  meta?: Record<string, unknown>;
}

export class Timeline {
  private events: TimelineEvent[] = [];

  add(
    type: TimelineEventType,
    message: string,
    opts?: { round?: number; meta?: Record<string, unknown>; ts?: string },
  ): TimelineEvent {
    const event: TimelineEvent = {
      id: randomUUID(),
      ts: opts?.ts ?? new Date().toISOString(),
      type,
      message,
      round: opts?.round,
      meta: opts?.meta,
    };
    this.events.push(event);
    if (this.events.length > 1000) {
      this.events = this.events.slice(-1000);
    }
    return event;
  }

  all(): TimelineEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.events = [];
  }

  load(events: TimelineEvent[]): void {
    this.events = [...events];
  }

  format(): string[] {
    return this.events.map((e) => {
      const time = e.ts.slice(11, 19);
      return `${time}  ${e.message}`;
    });
  }
}
