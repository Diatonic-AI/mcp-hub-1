/**
 * ML Telemetry Ingestor
 * - Buffers tool execution and ML events, batches flushes to Postgres (ml_events)
 *   and Mongo (ml_raw_telemetry)
 * - Enforces tenant isolation and redacts secrets
 * - Supports DL/ML metadata: approach, networkType, datasetRefs, hyperparameters
 * - Backpressure + retry with exponential backoff
 */

import logger from '../../utils/logger.js';
import { ValidationError, ServerError } from '../../utils/errors.js';
import { getDatabase } from '../../utils/database.js';
import { getMLCollectionsManager } from '../../db/mongo/ml-collections.js';
import { getTenantContextManager } from '../../utils/tenant-context.js';
import crypto from 'crypto';

/**
 * Secret redaction utility
 */
function redactSecrets(obj, maxSize = 2048) {
  try {
    const json = JSON.stringify(obj);
    if (json.length > maxSize) {
      // Return only sizes and selected safe keys
      return { _redacted: true, length: json.length };
    }
    // Mask common secret-looking fields
    const maskKeys = [/token/i, /secret/i, /api[_-]?key/i, /authorization/i, /password/i];
    const clone = JSON.parse(json);
    const recurse = (o) => {
      if (Array.isArray(o)) {
        return o.map(recurse);
      }
      if (o && typeof o === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(o)) {
          if (maskKeys.some((rx) => rx.test(k))) {
            out[k] = '***REDACTED***';
          } else {
            out[k] = recurse(v);
          }
        }
        return out;
      }
      return o;
    };
    return recurse(clone);
  } catch {
    return { _redacted: true };
  }
}

function sha256Hex(data) {
  const buf = typeof data === 'string' ? Buffer.from(data) : Buffer.from(JSON.stringify(data));
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export class MLTelemetryIngestor {
  constructor(options = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? 2000;
    this.maxBatchSize = options.maxBatchSize ?? 500;
    this.maxQueueSize = options.maxQueueSize ?? 5000;
    this.retry = { maxAttempts: 3, baseDelayMs: 500 };

    this.queue = [];
    this.inFlight = false;
    this.timer = null;

    this.pg = getDatabase();
    this.mongoManager = getMLCollectionsManager();
    this.tenants = getTenantContextManager();

    this.enabled = true;
    this._setupTimer();
  }

  _setupTimer() {
    if (this.timer) this.timer.unref?.();
    this.timer = setInterval(() => this.flush().catch(() => {}), this.flushIntervalMs);
    this.timer.unref?.();
  }

  /**
   * Begin an operation – returns opId
   * ctx: { tenant, toolId, serverName, runId?, modelVersionId?, approach?, networkType? }
   */
  startOperation(ctx = {}) {
    const tenant = this.tenants.resolveTenant({ explicit: ctx.tenant, allowDefault: false });
    const opId = crypto.randomUUID();
    const now = Date.now();

    const event = {
      id: opId,
      tenant,
      eventType: 'OPERATION_STARTED',
      toolId: ctx.toolId || null,
      serverName: ctx.serverName || null,
      runId: ctx.runId || null,
      modelVersionId: ctx.modelVersionId || null,
      timings: { start: now },
      sizes: {},
      outcome: null,
      errorCode: null,
      payload: redactSecrets({ approach: ctx.approach, networkType: ctx.networkType, meta: ctx.meta }),
      ts: new Date(now)
    };

    this._enqueue(event);
    return opId;
  }

  /**
   * Mark operation success
   */
  endOperation(opId, result = {}) {
    if (!opId) throw new ValidationError('opId required');
    const now = Date.now();
    const tenant = this.tenants.getTenant();

    const payload = redactSecrets({
      resultSummary: result.summary,
      metrics: result.metrics,
      // Limit any raw outputs to sizes only
    });

    const sizes = {
      resultSummaryLen: JSON.stringify(result.summary || {}).length
    };

    this._enqueue({
      id: opId,
      tenant,
      eventType: 'OPERATION_COMPLETED',
      toolId: result.toolId || null,
      serverName: result.serverName || null,
      runId: result.runId || null,
      modelVersionId: result.modelVersionId || null,
      timings: { end: now, durationMs: result.startedAt ? (now - result.startedAt) : null },
      sizes,
      outcome: 'success',
      errorCode: null,
      payload,
      ts: new Date(now)
    });
  }

  /**
   * Mark operation error
   */
  errorOperation(opId, err = {}) {
    if (!opId) throw new ValidationError('opId required');
    const now = Date.now();
    const tenant = this.tenants.getTenant();

    const payload = redactSecrets({ message: err.message, data: err.data });

    this._enqueue({
      id: opId,
      tenant,
      eventType: 'OPERATION_FAILED',
      toolId: err.toolId || null,
      serverName: err.serverName || null,
      runId: err.runId || null,
      modelVersionId: err.modelVersionId || null,
      timings: { end: now },
      sizes: {},
      outcome: 'error',
      errorCode: err.code || err.errorCode || 'UNKNOWN',
      payload,
      ts: new Date(now)
    });
  }

  /**
   * Ingest generic ML event (DL/ML aware)
   * event: { eventType, toolId?, serverName?, runId?, modelVersionId?, approach?, networkType?, timings?, sizes?, payload? }
   */
  ingest(event = {}) {
    const tenant = this.tenants.resolveTenant({ explicit: event.tenant, allowDefault: false });
    const safe = {
      id: crypto.randomUUID(),
      tenant,
      eventType: event.eventType,
      toolId: event.toolId || null,
      serverName: event.serverName || null,
      runId: event.runId || null,
      modelVersionId: event.modelVersionId || null,
      timings: event.timings || {},
      sizes: event.sizes || {},
      outcome: event.outcome || null,
      errorCode: event.errorCode || null,
      payload: redactSecrets({
        approach: event.approach,
        networkType: event.networkType,
        hyperparameters: event.hyperparameters,
        datasetRefs: event.datasetRefs,
        note: event.note
      }),
      ts: new Date()
    };
    this._enqueue(safe);
  }

  _enqueue(evt) {
    if (!this.enabled) return;
    if (this.queue.length >= this.maxQueueSize) {
      // Backpressure: drop oldest
      const dropped = this.queue.shift();
      logger.warn('telemetry_queue_backpressure', { droppedId: dropped?.id, queue: this.queue.length });
    }
    this.queue.push(evt);
  }

  async flush() {
    if (this.inFlight || this.queue.length === 0) return;
    this.inFlight = true;
    const batch = this.queue.splice(0, this.maxBatchSize);

    try {
      await this._flushPostgres(batch);
    } catch (err) {
      logger.error('PG_FLUSH_ERROR', 'Failed flushing telemetry to Postgres', { error: err.message, batch: batch.length }, false);
      await this._retry(() => this._flushPostgres(batch));
    }

    try {
      await this._flushMongo(batch);
    } catch (err) {
      logger.error('MONGO_FLUSH_ERROR', 'Failed flushing telemetry to Mongo', { error: err.message, batch: batch.length }, false);
      await this._retry(() => this._flushMongo(batch));
    }

    this.inFlight = false;
  }

  async _retry(fn) {
    let attempt = 0;
    while (attempt < this.retry.maxAttempts) {
      attempt++;
      try {
        await fn();
        return;
      } catch (e) {
        const delay = this.retry.baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    throw new ServerError('Max retry attempts exceeded');
  }

  async _flushPostgres(batch) {
    const client = await this.pg.connect();
    try {
      // Set tenant per-row via VALUES and cast
      await client.query('BEGIN');
      const text = `
        INSERT INTO ml_events (
          tenant_id, event_type, tool_id, server_name, run_id, model_version_id, timings, sizes, outcome, error_code, payload, ts
        )
        SELECT * FROM UNNEST (
          $1::text[], $2::text[], $3::text[], $4::text[], $5::uuid[], $6::uuid[], $7::jsonb[], $8::jsonb[], $9::text[], $10::text[], $11::jsonb[], $12::timestamptz[]
        )`;
      const arrays = transposeForPg(batch);
      await client.query(text, arrays);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async _flushMongo(batch) {
    const db = this.mongoManager.db;
    if (!db) return; // not connected yet
    const col = db.collection('ml_raw_telemetry');
    const docs = batch.map((e) => ({
      _id: e.id,
      tenant: e.tenant,
      eventType: e.eventType,
      payload: e.payload,
      ts: e.ts,
    }));
    if (docs.length) {
      await col.insertMany(docs, { ordered: false });
    }
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.enabled = false;
  }
}

function transposeForPg(batch) {
  const toUuids = (arr) => arr.map((v) => (v ? v : null));
  return [
    batch.map((e) => e.tenant),
    batch.map((e) => e.eventType),
    batch.map((e) => e.toolId),
    batch.map((e) => e.serverName),
    toUuids(batch.map((e) => e.runId)),
    toUuids(batch.map((e) => e.modelVersionId)),
    batch.map((e) => JSON.stringify(e.timings || {})),
    batch.map((e) => JSON.stringify(e.sizes || {})),
    batch.map((e) => e.outcome),
    batch.map((e) => e.errorCode),
    batch.map((e) => JSON.stringify(e.payload || {})),
    batch.map((e) => e.ts.toISOString()),
  ];
}

