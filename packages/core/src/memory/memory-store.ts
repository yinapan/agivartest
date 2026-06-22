import type { DatabaseLike } from './schema.js';
import type { WorkflowMemory } from '../types/workflow.js';

export interface MemorySearchResult {
  memory: WorkflowMemory;
  score: number;
  matchedFields: string[];
}

/** Matches characters in the CJK Unified Ideographs blocks. */
const CJK_RE = /[一-鿿㐀-䶿]/;

export class MemoryStore {
  constructor(private db: DatabaseLike) {}

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  insert(memory: WorkflowMemory): void {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_memories (
        id, app_name, platform, topic, trigger_examples, summary,
        initial_state, inputs, steps, success_criteria, risk_level,
        source_type, version, search_text, embedding_status,
        created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?
      )
    `);
    stmt.run(
      memory.id,
      memory.appName,
      memory.platform,
      memory.topic,
      JSON.stringify(memory.triggerExamples),
      memory.summary,
      memory.initialState,
      memory.inputs ? JSON.stringify(memory.inputs) : null,
      JSON.stringify(memory.steps),
      memory.successCriteria,
      memory.riskLevel,
      memory.sourceType,
      memory.version,
      memory.searchText,
      memory.embeddingStatus,
      memory.createdAt,
      memory.updatedAt,
    );
  }

  getById(id: string): WorkflowMemory | null {
    const row = this.db
      .prepare('SELECT * FROM workflow_memories WHERE id = ?')
      .get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.rowToMemory(row);
  }

  list(filter?: { appName?: string; topic?: string }): WorkflowMemory[] {
    let sql = 'SELECT * FROM workflow_memories';
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filter?.appName) {
      conditions.push('app_name = ?');
      params.push(filter.appName);
    }
    if (filter?.topic) {
      conditions.push('topic = ?');
      params.push(filter.topic);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => this.rowToMemory(row));
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM workflow_memories WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  search(goal: string): MemorySearchResult[] {
    if (!goal || goal.trim().length === 0) return [];

    const tokens = this.tokenize(goal);
    if (tokens.length === 0) return [];

    const rows = this.db
      .prepare('SELECT * FROM workflow_memories')
      .all() as Record<string, unknown>[];

    const results: MemorySearchResult[] = [];
    for (const row of rows) {
      const memory = this.rowToMemory(row);
      const { score, matchedFields } = this.scoreMatch(tokens, memory);
      if (score > 0) {
        results.push({ memory, score, matchedFields });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 3);
  }

  // ---------------------------------------------------------------------------
  // Tokenization
  // ---------------------------------------------------------------------------

  private tokenize(text: string): string[] {
    // Remove punctuation, keep alphanumeric + CJK + whitespace.
    const cleaned = text.replace(/[^\w一-鿿㐀-䶿\s]/g, ' ');
    const segments = cleaned.split(/\s+/).filter((s) => s.length > 0);

    const tokens: string[] = [];

    for (const segment of segments) {
      const cjkChars: string[] = [];
      const nonCjkParts: string[] = [];
      let buf = '';

      for (const ch of segment) {
        if (CJK_RE.test(ch)) {
          if (buf) {
            nonCjkParts.push(buf.toLowerCase());
            buf = '';
          }
          cjkChars.push(ch);
        } else {
          buf += ch;
        }
      }
      if (buf) {
        nonCjkParts.push(buf.toLowerCase());
      }

      // CJK character bigrams
      for (let i = 0; i < cjkChars.length - 1; i++) {
        tokens.push(cjkChars[i] + cjkChars[i + 1]);
      }
      // Single CJK character falls through as a unigram
      if (cjkChars.length === 1) {
        tokens.push(cjkChars[0]);
      }

      // ASCII words
      for (const word of nonCjkParts) {
        if (word.length > 0) {
          tokens.push(word);
        }
      }
    }

    return [...new Set(tokens)];
  }

  // ---------------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------------

  private static readonly FIELD_WEIGHTS: Record<string, number> = {
    triggerExamples: 3,
    topic: 2,
    summary: 2,
    appName: 1,
    searchText: 1,
  };

  private static readonly TOTAL_WEIGHT = 9; // sum of FIELD_WEIGHTS

  private scoreMatch(
    tokens: string[],
    memory: WorkflowMemory,
  ): { score: number; matchedFields: string[] } {
    const matchedFieldsSet = new Set<string>();
    let matchedWeight = 0;
    const hitTokens = new Set<string>();

    for (const token of tokens) {
      const lower = token.toLowerCase();
      let hit = false;

      for (const [field, weight] of Object.entries(MemoryStore.FIELD_WEIGHTS)) {
        const fieldText = this.getFieldText(memory, field).toLowerCase();
        if (fieldText.includes(lower)) {
          if (!matchedFieldsSet.has(field)) {
            matchedFieldsSet.add(field);
            matchedWeight += weight;
          }
          hit = true;
        }
      }

      if (hit) {
        hitTokens.add(token);
      }
    }

    const fieldScore = matchedWeight / MemoryStore.TOTAL_WEIGHT;
    const coverageScore = hitTokens.size / tokens.length;
    const score = Math.min(1, fieldScore * 0.6 + coverageScore * 0.4);

    const matchedFields = [...matchedFieldsSet].sort(
      (a, b) => MemoryStore.FIELD_WEIGHTS[b] - MemoryStore.FIELD_WEIGHTS[a],
    );

    return { score, matchedFields };
  }

  private getFieldText(memory: WorkflowMemory, field: string): string {
    switch (field) {
      case 'triggerExamples':
        return memory.triggerExamples.join(' ');
      case 'topic':
        return memory.topic;
      case 'summary':
        return memory.summary;
      case 'appName':
        return memory.appName;
      case 'searchText':
        return memory.searchText;
      default:
        return '';
    }
  }

  // ---------------------------------------------------------------------------
  // Row deserialization
  // ---------------------------------------------------------------------------

  private rowToMemory(row: Record<string, unknown>): WorkflowMemory {
    return {
      id: row.id as string,
      appName: row.app_name as string,
      platform: row.platform as WorkflowMemory['platform'],
      topic: row.topic as string,
      triggerExamples: JSON.parse(row.trigger_examples as string) as string[],
      summary: row.summary as string,
      initialState: row.initial_state as string,
      inputs: row.inputs
        ? (JSON.parse(row.inputs as string) as WorkflowMemory['inputs'])
        : undefined,
      steps: JSON.parse(row.steps as string) as WorkflowMemory['steps'],
      successCriteria: (row.success_criteria as string) ?? '',
      riskLevel: row.risk_level as WorkflowMemory['riskLevel'],
      sourceType: row.source_type as WorkflowMemory['sourceType'],
      version: row.version as number,
      searchText: row.search_text as string,
      embeddingStatus: row.embedding_status as WorkflowMemory['embeddingStatus'],
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    };
  }
}
