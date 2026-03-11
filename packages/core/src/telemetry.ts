/**
 * Optional OpenTelemetry integration for Sandcaster.
 *
 * Activated by setting SANDCASTER_TELEMETRY=1. When the env var is unset or
 * the OpenTelemetry packages are not installed, every public function in this
 * module is a safe no-op — zero overhead on the hot path.
 *
 * All OTel imports live inside initTelemetry() so the module is safe to import
 * even when the OTel packages are not installed.
 */

// ── Tracer / Span interfaces ─────────────────────────────────────────────────

export interface SpanLike {
	isRecording(): boolean;
	setAttribute(key: string, value: unknown): void;
	setStatus(status: string, description?: string): void;
	recordException(exception: unknown): void;
}

export interface TracerLike {
	startAsCurrentSpan<T>(name: string, fn: (span: SpanLike) => T): T;
}

// ── No-op fallback classes ───────────────────────────────────────────────────

export class NoOpSpan implements SpanLike {
	isRecording(): boolean {
		return false;
	}

	setAttribute(_key: string, _value: unknown): void {
		// no-op
	}

	setStatus(_status: string, _description?: string): void {
		// no-op
	}

	recordException(_exception: unknown): void {
		// no-op
	}
}

export class NoOpTracer implements TracerLike {
	startAsCurrentSpan<T>(name: string, fn: (span: SpanLike) => T): T;
	startAsCurrentSpan(name: string, fn: (span: SpanLike) => void): void;
	startAsCurrentSpan<T>(_name: string, fn: (span: SpanLike) => T): T {
		return fn(new NoOpSpan());
	}
}

// ── Module state ─────────────────────────────────────────────────────────────

let _enabled = false;
let _tracer: unknown = null;

let _requestCounter: unknown = null;
let _requestDuration: unknown = null;
let _sandboxCreationDuration: unknown = null;
let _agentExecutionDuration: unknown = null;
let _activeSandboxes: unknown = null;
let _errorCounter: unknown = null;
let _queueDropCounter: unknown = null;
let _webhookEventCounter: unknown = null;

function _isEnabled(): boolean {
	return process.env.SANDCASTER_TELEMETRY?.trim() === "1";
}

// Dynamic import wrapper prevents TypeScript from statically resolving
// optional OTel module specifiers (they're not installed as dependencies).
// biome-ignore lint/suspicious/noExplicitAny: dynamic optional imports
async function _optionalImport(specifier: string): Promise<any> {
	return import(specifier);
}

// ── Initialisation ───────────────────────────────────────────────────────────

export async function initTelemetry(): Promise<void> {
	if (_enabled || !_isEnabled()) {
		return;
	}

	let otelCore: {
		metrics: {
			getMeter: (name: string) => unknown;
			setMeterProvider: (p: unknown) => void;
		};
		trace: {
			getTracer: (name: string) => unknown;
			setTracerProvider: (p: unknown) => void;
		};
	};
	let sdkResources: {
		Resource: { create: (attrs: Record<string, string>) => unknown };
	};
	let sdkTrace: {
		TracerProvider: new (opts: {
			resource: unknown;
		}) => {
			addSpanProcessor: (p: unknown) => void;
		};
	};
	let sdkTraceExport: { BatchSpanProcessor: new (exp: unknown) => unknown };
	let sdkMetrics: {
		MeterProvider: new (opts: {
			resource: unknown;
			metricReaders: unknown[];
		}) => unknown;
		PeriodicExportingMetricReader: new (exp: unknown) => unknown;
	};
	let sdkLogs: {
		LoggerProvider: new (opts: {
			resource: unknown;
		}) => {
			addLogRecordProcessor: (p: unknown) => void;
		};
		BatchLogRecordProcessor: new (exp: unknown) => unknown;
	};
	let LoggingHandler: {
		new (opts: { level: number; loggerProvider: unknown }): unknown;
	};

	try {
		otelCore = await _optionalImport("@opentelemetry/api");
		sdkResources = await _optionalImport("@opentelemetry/resources");
		sdkTrace = await _optionalImport("@opentelemetry/sdk-trace-base");
		sdkTraceExport = await _optionalImport("@opentelemetry/sdk-trace-base");
		sdkMetrics = await _optionalImport("@opentelemetry/sdk-metrics");
		sdkLogs = await _optionalImport("@opentelemetry/sdk-logs");
		const logsHandler = await _optionalImport(
			"@opentelemetry/winston-transport",
		);
		LoggingHandler =
			logsHandler.OpenTelemetryTransport ?? logsHandler.LoggingHandler;
	} catch {
		console.warn(
			"SANDCASTER_TELEMETRY=1 but OpenTelemetry packages are not installed. " +
				"Install the OTel SDK packages to enable telemetry.",
		);
		return;
	}

	const resource = sdkResources.Resource.create({
		"service.name": "sandcaster",
	});

	// ── Exporter selection (gRPC default, HTTP/protobuf alt) ─────────────
	const protocol = process.env.OTEL_EXPORTER_OTLP_PROTOCOL ?? "grpc";

	let OTLPSpanExporter: new () => unknown;
	let OTLPMetricExporter: new () => unknown;
	let OTLPLogExporter: new () => unknown;

	if (protocol === "http/protobuf") {
		const traceHttp = await _optionalImport(
			"@opentelemetry/exporter-trace-otlp-http",
		);
		const metricsHttp = await _optionalImport(
			"@opentelemetry/exporter-metrics-otlp-http",
		);
		const logsHttp = await _optionalImport(
			"@opentelemetry/exporter-logs-otlp-http",
		);
		OTLPSpanExporter = traceHttp.OTLPTraceExporter;
		OTLPMetricExporter = metricsHttp.OTLPMetricExporter;
		OTLPLogExporter = logsHttp.OTLPLogExporter;
	} else {
		const traceGrpc = await _optionalImport(
			"@opentelemetry/exporter-trace-otlp-grpc",
		);
		const metricsGrpc = await _optionalImport(
			"@opentelemetry/exporter-metrics-otlp-grpc",
		);
		const logsGrpc = await _optionalImport(
			"@opentelemetry/exporter-logs-otlp-grpc",
		);
		OTLPSpanExporter = traceGrpc.OTLPTraceExporter;
		OTLPMetricExporter = metricsGrpc.OTLPMetricExporter;
		OTLPLogExporter = logsGrpc.OTLPLogExporter;
	}

	// ── Traces ───────────────────────────────────────────────────────────
	const tracerProvider = new sdkTrace.TracerProvider({ resource });
	tracerProvider.addSpanProcessor(
		new sdkTraceExport.BatchSpanProcessor(new OTLPSpanExporter()),
	);
	otelCore.trace.setTracerProvider(tracerProvider);

	// ── Metrics ──────────────────────────────────────────────────────────
	const metricReader = new sdkMetrics.PeriodicExportingMetricReader(
		new OTLPMetricExporter(),
	);
	const meterProvider = new sdkMetrics.MeterProvider({
		resource,
		metricReaders: [metricReader],
	});
	otelCore.metrics.setMeterProvider(meterProvider);

	// ── Logs bridge ──────────────────────────────────────────────────────
	const logProvider = new sdkLogs.LoggerProvider({ resource });
	logProvider.addLogRecordProcessor(
		new sdkLogs.BatchLogRecordProcessor(new OTLPLogExporter()),
	);
	if (LoggingHandler) {
		// Attach to root logger if available
		try {
			// biome-ignore lint/suspicious/noExplicitAny: optional hook
			const handler = new (LoggingHandler as any)({
				level: 0,
				loggerProvider: logProvider,
			});
			// biome-ignore lint/suspicious/noExplicitAny: optional hook
			(console as any).__otelHandler = handler;
		} catch {
			// best-effort
		}
	}

	// ── Create metric instruments ────────────────────────────────────────
	// biome-ignore lint/suspicious/noExplicitAny: dynamic OTel meter
	const meter = (otelCore.metrics as any).getMeter("sandcaster");

	// biome-ignore lint/suspicious/noExplicitAny: OTel meter API
	_requestCounter = (meter as any).createCounter("sandcaster.requests", {
		unit: "1",
		description: "Total query requests",
	});
	// biome-ignore lint/suspicious/noExplicitAny: OTel meter API
	_requestDuration = (meter as any).createHistogram(
		"sandcaster.request.duration",
		{
			unit: "s",
			description: "Query request duration",
		},
	);
	// biome-ignore lint/suspicious/noExplicitAny: OTel meter API
	_sandboxCreationDuration = (meter as any).createHistogram(
		"sandcaster.sandbox.creation.duration",
		{
			unit: "s",
			description: "Sandbox creation duration",
		},
	);
	// biome-ignore lint/suspicious/noExplicitAny: OTel meter API
	_agentExecutionDuration = (meter as any).createHistogram(
		"sandcaster.agent.execution.duration",
		{
			unit: "s",
			description: "Agent execution duration",
		},
	);
	// biome-ignore lint/suspicious/noExplicitAny: OTel meter API
	_activeSandboxes = (meter as any).createUpDownCounter(
		"sandcaster.sandboxes.active",
		{
			unit: "1",
			description: "Currently active sandboxes",
		},
	);
	// biome-ignore lint/suspicious/noExplicitAny: OTel meter API
	_errorCounter = (meter as any).createCounter("sandcaster.errors", {
		unit: "1",
		description: "Total errors",
	});
	// biome-ignore lint/suspicious/noExplicitAny: OTel meter API
	_queueDropCounter = (meter as any).createCounter("sandcaster.queue.drops", {
		unit: "1",
		description: "Messages dropped due to full queue",
	});
	// biome-ignore lint/suspicious/noExplicitAny: OTel meter API
	_webhookEventCounter = (meter as any).createCounter(
		"sandcaster.webhook.events",
		{
			unit: "1",
			description: "E2B webhook events received",
		},
	);

	_enabled = true;
	_tracer = otelCore.trace.getTracer("sandcaster");
	console.info(`OpenTelemetry initialized (protocol=${protocol})`);
}

// ── Tracer accessor ──────────────────────────────────────────────────────────

export function getTracer(): TracerLike {
	if (_tracer !== null) {
		return _tracer as TracerLike;
	}
	return new NoOpTracer();
}

// ── Metric helpers (no-ops when disabled) ────────────────────────────────────

export function recordRequest(opts?: {
	model?: string;
	status?: string;
}): void {
	if (_requestCounter) {
		// biome-ignore lint/suspicious/noExplicitAny: OTel counter API
		(_requestCounter as any).add(1, {
			model: opts?.model ?? "",
			status: opts?.status ?? "ok",
		});
	}
}

export function recordRequestDuration(
	duration: number,
	opts?: { model?: string },
): void {
	if (_requestDuration) {
		// biome-ignore lint/suspicious/noExplicitAny: OTel histogram API
		(_requestDuration as any).record(duration, { model: opts?.model ?? "" });
	}
}

export function recordSandboxCreation(
	duration: number,
	opts?: { template?: string },
): void {
	if (_sandboxCreationDuration) {
		// biome-ignore lint/suspicious/noExplicitAny: OTel histogram API
		(_sandboxCreationDuration as any).record(duration, {
			template: opts?.template ?? "",
		});
	}
}

export function recordAgentExecution(
	duration: number,
	opts?: { model?: string },
): void {
	if (_agentExecutionDuration) {
		// biome-ignore lint/suspicious/noExplicitAny: OTel histogram API
		(_agentExecutionDuration as any).record(duration, {
			model: opts?.model ?? "",
		});
	}
}

export function sandboxStarted(): void {
	if (_activeSandboxes) {
		// biome-ignore lint/suspicious/noExplicitAny: OTel counter API
		(_activeSandboxes as any).add(1);
	}
}

export function sandboxStopped(): void {
	if (_activeSandboxes) {
		// biome-ignore lint/suspicious/noExplicitAny: OTel counter API
		(_activeSandboxes as any).add(-1);
	}
}

export function recordError(opts?: { errorType?: string }): void {
	if (_errorCounter) {
		// biome-ignore lint/suspicious/noExplicitAny: OTel counter API
		(_errorCounter as any).add(1, { error_type: opts?.errorType ?? "" });
	}
}

export function recordQueueDrop(): void {
	if (_queueDropCounter) {
		// biome-ignore lint/suspicious/noExplicitAny: OTel counter API
		(_queueDropCounter as any).add(1);
	}
}

export function recordWebhookEvent(opts?: { eventType?: string }): void {
	if (_webhookEventCounter) {
		// biome-ignore lint/suspicious/noExplicitAny: OTel counter API
		(_webhookEventCounter as any).add(1, {
			"sandcaster.webhook.event_type": opts?.eventType ?? "",
		});
	}
}
