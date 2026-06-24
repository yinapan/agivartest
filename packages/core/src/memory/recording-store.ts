import type { DatabaseLike } from './schema.js';
import type {
  RecordingArtifactStatus,
  RecordingContextSnapshot,
  RecordingEvent,
  RecordingKeyframe,
  RecordingRepository,
  RecordingSession,
  RecordingTimeline,
} from '../types/workflow.js';

export type RecordingArtifactKind = 'event' | 'keyframe' | 'context';

export class RecordingStore implements RecordingRepository {
  constructor(private db: DatabaseLike) {}

  async saveSession(session: RecordingSession): Promise<void> {
    this.db.prepare(`
      INSERT INTO recording_sessions (
        id, scope, privacy_mode, status, goal, notes, video_path, artifact_dir,
        started_at, stopped_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      session.id,
      session.scope,
      session.privacyMode,
      session.status,
      session.goal ?? null,
      session.notes ?? null,
      session.videoPath ?? null,
      session.artifactDir,
      session.startedAt ?? null,
      session.stoppedAt ?? null,
      session.createdAt,
      session.updatedAt,
    );
  }

  async getSession(sessionId: string): Promise<RecordingSession | null> {
    const row = this.db
      .prepare('SELECT * FROM recording_sessions WHERE id = ?')
      .get(sessionId) as Record<string, unknown> | undefined;
    return row ? this.rowToSession(row) : null;
  }

  async updateSession(session: RecordingSession): Promise<void> {
    this.db.prepare(`
      UPDATE recording_sessions SET
        scope = ?,
        privacy_mode = ?,
        status = ?,
        goal = ?,
        notes = ?,
        video_path = ?,
        artifact_dir = ?,
        started_at = ?,
        stopped_at = ?,
        created_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      session.scope,
      session.privacyMode,
      session.status,
      session.goal ?? null,
      session.notes ?? null,
      session.videoPath ?? null,
      session.artifactDir,
      session.startedAt ?? null,
      session.stoppedAt ?? null,
      session.createdAt,
      session.updatedAt,
      session.id,
    );
  }

  async saveTimeline(timeline: RecordingTimeline): Promise<void> {
    const tx = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE recording_sessions SET
          goal = ?,
          notes = ?,
          started_at = ?,
          stopped_at = ?,
          updated_at = ?
        WHERE id = ?
      `).run(
        timeline.goal ?? null,
        timeline.notes,
        timeline.startedAt,
        timeline.stoppedAt,
        timeline.stoppedAt,
        timeline.sessionId,
      );

      this.db.prepare('DELETE FROM recording_context_snapshots WHERE session_id = ?').run(timeline.sessionId);
      this.db.prepare('DELETE FROM recording_keyframes WHERE session_id = ?').run(timeline.sessionId);
      this.db.prepare('DELETE FROM recording_events WHERE session_id = ?').run(timeline.sessionId);

      const insertEvent = this.db.prepare(`
        INSERT INTO recording_events (
          id, session_id, timestamp_ms, type, summary, redaction_level,
          raw_payload_json, window_title, process_name, status, deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const event of timeline.events) {
        insertEvent.run(
          event.id,
          event.sessionId,
          event.timestampMs,
          event.type,
          event.summary,
          event.redactionLevel,
          event.rawPayload === undefined ? null : JSON.stringify(event.rawPayload),
          event.windowTitle ?? null,
          event.processName ?? null,
          event.status,
          event.deletedAt ?? null,
        );
      }

      const insertKeyframe = this.db.prepare(`
        INSERT INTO recording_keyframes (
          id, session_id, timestamp_ms, image_path, reason, event_id, redacted,
          status, deleted_at, hash, file_size, mime_type, included_in_provider
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const keyframe of timeline.keyframes) {
        insertKeyframe.run(
          keyframe.id,
          keyframe.sessionId,
          keyframe.timestampMs,
          keyframe.imagePath,
          keyframe.reason,
          keyframe.eventId ?? null,
          keyframe.redacted ? 1 : 0,
          keyframe.status,
          keyframe.deletedAt ?? null,
          keyframe.hash,
          keyframe.fileSize,
          keyframe.mimeType,
          keyframe.includedInProvider ? 1 : 0,
        );
      }

      const insertContext = this.db.prepare(`
        INSERT INTO recording_context_snapshots (
          id, session_id, timestamp_ms, kind, summary_json, source, warning, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const context of timeline.context) {
        insertContext.run(
          context.id,
          context.sessionId,
          context.timestampMs,
          context.kind,
          JSON.stringify(context.summary),
          context.source,
          context.warning ?? null,
          context.status,
        );
      }
    });
    tx();
  }

  async getTimeline(sessionId: string): Promise<RecordingTimeline | null> {
    const session = await this.getSession(sessionId);
    if (!session) return null;

    const events = this.db
      .prepare('SELECT * FROM recording_events WHERE session_id = ? ORDER BY timestamp_ms, id')
      .all(sessionId) as Record<string, unknown>[];
    const keyframes = this.db
      .prepare('SELECT * FROM recording_keyframes WHERE session_id = ? ORDER BY timestamp_ms, id')
      .all(sessionId) as Record<string, unknown>[];
    const context = this.db
      .prepare('SELECT * FROM recording_context_snapshots WHERE session_id = ? ORDER BY timestamp_ms, id')
      .all(sessionId) as Record<string, unknown>[];

    return {
      sessionId: session.id,
      goal: session.goal,
      notes: session.notes ?? '',
      scope: session.scope,
      privacyMode: session.privacyMode,
      startedAt: session.startedAt ?? session.createdAt,
      stoppedAt: session.stoppedAt ?? session.updatedAt,
      keyframes: keyframes.map((row) => this.rowToKeyframe(row)),
      events: events.map((row) => this.rowToEvent(row)),
      context: context.map((row) => this.rowToContext(row)),
      warnings: [],
    };
  }

  async markArtifactStatus(
    sessionId: string,
    kind: RecordingArtifactKind,
    artifactId: string,
    status: RecordingArtifactStatus,
    deletedAt?: string,
  ): Promise<boolean> {
    if (kind === 'event') {
      const result = this.db.prepare(`
        UPDATE recording_events
        SET status = ?, deleted_at = ?
        WHERE session_id = ? AND id = ?
      `).run(status, status === 'deleted' ? deletedAt ?? null : null, sessionId, artifactId);
      return result.changes > 0;
    }

    if (kind === 'keyframe') {
      const result = this.db.prepare(`
        UPDATE recording_keyframes
        SET status = ?, deleted_at = ?, included_in_provider = ?
        WHERE session_id = ? AND id = ?
      `).run(
        status,
        status === 'deleted' ? deletedAt ?? null : null,
        status === 'active' ? 1 : 0,
        sessionId,
        artifactId,
      );
      return result.changes > 0;
    }

    const result = this.db.prepare(`
      UPDATE recording_context_snapshots
      SET status = ?
      WHERE session_id = ? AND id = ?
    `).run(status, sessionId, artifactId);
    return result.changes > 0;
  }

  async saveDraftLink(): Promise<void> {
    throw new Error('recording draft links are implemented in Phase 3E');
  }

  async getDraftLink(): Promise<null> {
    return null;
  }

  private rowToSession(row: Record<string, unknown>): RecordingSession {
    return {
      id: row.id as string,
      scope: row.scope as RecordingSession['scope'],
      privacyMode: row.privacy_mode as RecordingSession['privacyMode'],
      status: row.status as RecordingSession['status'],
      artifactDir: row.artifact_dir as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      ...optionalString('goal', row.goal),
      ...optionalString('notes', row.notes),
      ...optionalString('videoPath', row.video_path),
      ...optionalString('startedAt', row.started_at),
      ...optionalString('stoppedAt', row.stopped_at),
    };
  }

  private rowToEvent(row: Record<string, unknown>): RecordingEvent {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      timestampMs: row.timestamp_ms as number,
      type: row.type as RecordingEvent['type'],
      summary: row.summary as string,
      redactionLevel: row.redaction_level as RecordingEvent['redactionLevel'],
      status: row.status as RecordingEvent['status'],
      ...(row.raw_payload_json
        ? { rawPayload: JSON.parse(row.raw_payload_json as string) as unknown }
        : {}),
      ...optionalString('windowTitle', row.window_title),
      ...optionalString('processName', row.process_name),
      ...optionalString('deletedAt', row.deleted_at),
    };
  }

  private rowToKeyframe(row: Record<string, unknown>): RecordingKeyframe {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      timestampMs: row.timestamp_ms as number,
      imagePath: row.image_path as string,
      reason: row.reason as string,
      redacted: row.redacted === 1,
      status: row.status as RecordingKeyframe['status'],
      hash: row.hash as string,
      fileSize: row.file_size as number,
      mimeType: row.mime_type as string,
      includedInProvider: row.included_in_provider === 1,
      ...optionalString('eventId', row.event_id),
      ...optionalString('deletedAt', row.deleted_at),
    };
  }

  private rowToContext(row: Record<string, unknown>): RecordingContextSnapshot {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      timestampMs: row.timestamp_ms as number,
      kind: row.kind as RecordingContextSnapshot['kind'],
      summary: JSON.parse(row.summary_json as string) as Record<string, unknown>,
      source: row.source as string,
      status: row.status as RecordingContextSnapshot['status'],
      ...optionalString('warning', row.warning),
    };
  }
}

function optionalString<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  return typeof value === 'string' ? { [key]: value } as Record<K, string> : {};
}
