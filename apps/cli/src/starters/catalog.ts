// ---------------------------------------------------------------------------
// Starter catalog for `sandcaster init`
// ---------------------------------------------------------------------------

export interface StarterDefinition {
	slug: string;
	title: string;
	description: string;
	nextStepCommand: string;
	aliases: string[];
	configJson: Record<string, unknown>;
	readme: string;
	extraFiles?: Record<string, string>;
}

export const ENV_EXAMPLE = `ANTHROPIC_API_KEY=sk-ant-...
E2B_API_KEY=e2b_...
# Optional:
# SANDCASTER_API_KEY=your-secret-token
# ANTHROPIC_BASE_URL=https://openrouter.ai/api
# OPENROUTER_API_KEY=sk-or-...
`;

// ---------------------------------------------------------------------------
// Starter definitions
// ---------------------------------------------------------------------------

const STARTERS: StarterDefinition[] = [
	{
		slug: "general-assistant",
		title: "General Assistant",
		description:
			"General-purpose agent for research, documents, support, ops, and software work.",
		nextStepCommand:
			'sandcaster "Compare Notion, Coda, and Slite for async product teams"',
		aliases: [],
		configJson: {
			systemPrompt:
				"You are a pragmatic general-purpose AI agent running inside an isolated sandbox. Help with research, document analysis, support operations, planning, and software tasks. Use the web when fresh information matters, inspect uploaded files carefully, and return concise outputs that help the user decide what to do next. State assumptions when information is missing instead of pretending certainty.",
			model: "sonnet",
			maxTurns: 15,
			templateSkills: true,
		},
		readme: `# General Assistant

General-purpose starter for research, document work, support operations, and software tasks.

## Run it

\`\`\`bash
sandcaster "Compare Notion, Coda, and Slite for async product teams"
\`\`\`
`,
	},
	{
		slug: "research-brief",
		title: "Research Brief",
		description:
			"Research a topic, compare options, and return a concise decision brief.",
		nextStepCommand:
			'sandcaster "Research Acme\'s competitors, crawl their sites and recent news, and write a one-page branded briefing PDF with sources."',
		aliases: ["competitive-analysis"],
		configJson: {
			systemPrompt:
				"You are a research analyst. Investigate the user's topic using current sources, compare the relevant options, and return a concise brief that supports a decision. Cite concrete evidence from the sources you inspect instead of relying on generic prior knowledge. Call out uncertainty, missing data, and tradeoffs directly.",
			model: "sonnet",
			maxTurns: 20,
			outputFormat: {
				type: "json_schema",
				schema: {
					type: "object",
					properties: {
						summary: { type: "string" },
						scope: { type: "string" },
						keyFindings: {
							type: "array",
							items: { type: "string" },
						},
						recommendations: {
							type: "array",
							items: { type: "string" },
						},
						sources: {
							type: "array",
							items: {
								type: "object",
								properties: {
									title: { type: "string" },
									url: { type: "string" },
									notes: { type: "string" },
								},
								required: ["title", "url"],
							},
						},
					},
					required: ["summary", "keyFindings", "recommendations", "sources"],
				},
			},
		},
		readme: `# Research Brief

Starter for fast research briefs, competitive scans, and vendor comparisons.

## Run it

\`\`\`bash
sandcaster "Research Acme's competitors, crawl their sites and recent news, and write a one-page branded briefing PDF with sources."
\`\`\`
`,
	},
	{
		slug: "document-analyst",
		title: "Document Analyst",
		description:
			"Analyze transcripts, reports, PDFs, or decks and extract decisions and risks.",
		nextStepCommand:
			'sandcaster "Summarize this transcript and extract risks plus next steps" -f /path/to/transcript.txt',
		aliases: [],
		configJson: {
			systemPrompt:
				"You are a document analyst. Review uploaded transcripts, notes, reports, PDFs, or decks and extract the core decisions, risks, open questions, and next actions. When document-processing skills would help, use them instead of guessing from partial text. Keep outputs crisp and directly useful to the person making the next decision.",
			model: "sonnet",
			maxTurns: 15,
			templateSkills: true,
			outputFormat: {
				type: "json_schema",
				schema: {
					type: "object",
					properties: {
						summary: { type: "string" },
						keyPoints: {
							type: "array",
							items: { type: "string" },
						},
						actionItems: {
							type: "array",
							items: { type: "string" },
						},
						risks: {
							type: "array",
							items: { type: "string" },
						},
						openQuestions: {
							type: "array",
							items: { type: "string" },
						},
					},
					required: [
						"summary",
						"keyPoints",
						"actionItems",
						"risks",
						"openQuestions",
					],
				},
			},
		},
		readme: `# Document Analyst

Starter for analyzing transcripts, reports, PDFs, or decks.

## Run it

\`\`\`bash
sandcaster "Summarize this transcript and extract risks plus next steps" -f /path/to/transcript.txt
\`\`\`
`,
	},
	{
		slug: "support-triage",
		title: "Support Triage",
		description:
			"Triage tickets or issue exports into priorities, owners, and next actions.",
		nextStepCommand:
			'sandcaster "Triage these incoming tickets for urgency and next action" -f /path/to/tickets.json',
		aliases: ["issue-triage"],
		configJson: {
			systemPrompt:
				"You are a support operations lead. Review uploaded tickets, issue exports, transcripts, or queue snapshots and triage them into practical next actions. Prioritize clarity over politeness, separate urgent work from routine work, call out duplicates, and identify what is blocked on missing information.",
			model: "sonnet",
			maxTurns: 15,
			allowedTools: ["Read", "Glob", "Grep"],
			outputFormat: {
				type: "json_schema",
				schema: {
					type: "object",
					properties: {
						summary: { type: "string" },
						items: {
							type: "array",
							items: {
								type: "object",
								properties: {
									id: { type: "string" },
									title: { type: "string" },
									priority: {
										type: "string",
										enum: ["critical", "high", "medium", "low"],
									},
									category: {
										type: "string",
										enum: [
											"bug",
											"billing",
											"account",
											"access",
											"question",
											"feature",
										],
									},
									suggestedOwner: { type: "string" },
									nextAction: { type: "string" },
									customerReplyNeeded: { type: "boolean" },
									missingInfo: {
										type: "array",
										items: { type: "string" },
									},
								},
								required: [
									"title",
									"priority",
									"category",
									"nextAction",
									"customerReplyNeeded",
								],
							},
						},
						duplicates: {
							type: "array",
							items: {
								type: "object",
								properties: {
									primaryId: { type: "string" },
									duplicateIds: {
										type: "array",
										items: { type: "string" },
									},
								},
								required: ["primaryId", "duplicateIds"],
							},
						},
					},
					required: ["summary", "items"],
				},
			},
		},
		readme: `# Support Triage

Starter for triaging tickets or issue exports into priorities, owners, and next actions.

## Run it

\`\`\`bash
sandcaster "Triage these incoming tickets for urgency and next action" -f /path/to/tickets.json
\`\`\`
`,
	},
	{
		slug: "api-extractor",
		title: "API Extractor",
		description:
			"Crawl documentation and draft an API summary plus OpenAPI starter spec.",
		nextStepCommand:
			'sandcaster "Turn the docs at https://docs.stripe.com/api/subscriptions into a draft OpenAPI spec"',
		aliases: ["docs-to-openapi"],
		configJson: {
			systemPrompt:
				"You are an API technical writer. When given API docs, crawl them, infer the REST surface area, and generate a draft OpenAPI spec saved to /home/user/output/openapi.yaml. Be explicit about ambiguities and do not fabricate schemas when the docs are unclear. Return a compact summary of the extracted endpoints, auth model, files created, and open questions.",
			model: "sonnet",
			maxTurns: 20,
			outputFormat: {
				type: "json_schema",
				schema: {
					type: "object",
					properties: {
						summary: { type: "string" },
						baseUrl: { type: "string" },
						authScheme: { type: "string" },
						endpoints: {
							type: "array",
							items: {
								type: "object",
								properties: {
									method: { type: "string" },
									path: { type: "string" },
									summary: { type: "string" },
								},
								required: ["method", "path", "summary"],
							},
						},
						filesCreated: {
							type: "array",
							items: { type: "string" },
						},
						openQuestions: {
							type: "array",
							items: { type: "string" },
						},
					},
					required: ["summary", "endpoints", "filesCreated"],
				},
			},
		},
		readme: `# API Extractor

Starter for crawling API documentation and drafting an OpenAPI spec.

## Run it

\`\`\`bash
sandcaster "Turn the docs at https://docs.stripe.com/api/subscriptions into a draft OpenAPI spec"
\`\`\`
`,
	},
	{
		slug: "security-audit",
		title: "Security Audit",
		description:
			"Run a structured security audit with sub-agents and an OWASP skill.",
		nextStepCommand:
			'sandcaster "Run a security audit on this codebase" -f /path/to/requirements.txt -f /path/to/src/auth.py',
		aliases: [],
		configJson: {
			systemPrompt:
				"You are a security team lead. Coordinate your specialized sub-agents to perform a comprehensive security audit of the provided codebase. Delegate dependency scanning, code analysis, and configuration review to the appropriate agents, then synthesize their findings into a unified report with prioritized remediation steps.",
			model: "sonnet",
			maxTurns: 15,
			skillsDir: ".claude/skills",
			allowedTools: ["Read", "Glob", "Grep", "Bash", "Task"],
			agents: {
				"dependency-scanner": {
					description:
						"Checks dependencies for known vulnerabilities and outdated packages",
					prompt:
						"Scan dependency files such as requirements.txt, package.json, Cargo.toml, or go.mod for known CVEs and outdated packages. Run package audit commands where available and report each vulnerability with its CVE, severity, affected package, and recommended fix version.",
					tools: ["Read", "Glob", "Grep", "Bash"],
					model: "sonnet",
				},
				"code-scanner": {
					description:
						"Static analysis for OWASP Top 10 vulnerabilities in source code",
					prompt:
						"Scan source files for security vulnerabilities including injection, cross-site scripting, command injection, path traversal, hardcoded secrets, insecure deserialization, and other OWASP Top 10 issues. For each finding, identify the exact file, line number, vulnerability type, and CWE ID. Provide a code-level remediation suggestion.",
					tools: ["Read", "Glob", "Grep"],
				},
				"config-scanner": {
					description:
						"Audits configuration files for security misconfigurations",
					prompt:
						"Check configuration files such as .env, Dockerfile, docker-compose.yml, CI configs, or web server configs for security misconfigurations: exposed secrets, overly permissive CORS, missing security headers, privileged containers, unencrypted connections, and weak TLS settings. Flag each issue with its risk level.",
					tools: ["Read", "Glob", "Grep"],
					model: "haiku",
				},
			},
			outputFormat: {
				type: "json_schema",
				schema: {
					type: "object",
					properties: {
						riskLevel: {
							type: "string",
							enum: ["critical", "high", "medium", "low", "informational"],
						},
						summary: { type: "string" },
						vulnerabilities: {
							type: "array",
							items: {
								type: "object",
								properties: {
									title: { type: "string" },
									severity: {
										type: "string",
										enum: [
											"critical",
											"high",
											"medium",
											"low",
											"informational",
										],
									},
									category: { type: "string" },
									cwe: { type: "string" },
									file: { type: "string" },
									line: { type: "integer" },
									description: { type: "string" },
									remediation: { type: "string" },
								},
								required: [
									"title",
									"severity",
									"category",
									"description",
									"remediation",
								],
							},
						},
						stats: {
							type: "object",
							properties: {
								filesScanned: { type: "integer" },
								totalVulnerabilities: { type: "integer" },
								criticalCount: { type: "integer" },
								highCount: { type: "integer" },
								mediumCount: { type: "integer" },
								lowCount: { type: "integer" },
							},
							required: [
								"filesScanned",
								"totalVulnerabilities",
								"criticalCount",
								"highCount",
								"mediumCount",
								"lowCount",
							],
						},
					},
					required: ["riskLevel", "summary", "vulnerabilities", "stats"],
				},
			},
		},
		readme: `# Security Audit

Starter for deeper security reviews across code, configuration, and dependencies.

## Run it

\`\`\`bash
sandcaster "Run a security audit on this codebase" -f /path/to/requirements.txt -f /path/to/src/auth.py
\`\`\`
`,
		extraFiles: {
			".claude/skills/owasp-top-10/SKILL.md": `# OWASP Top 10 Review Checklist

Use this checklist when auditing application code, configuration, and deployment surfaces.

## Focus areas

- Broken access control
- Cryptographic failures
- Injection
- Insecure design
- Security misconfiguration
- Vulnerable and outdated components
- Identification and authentication failures
- Software and data integrity failures
- Security logging and monitoring failures
- Server-side request forgery

## Audit guidance

For each relevant category:

1. Identify the vulnerable file, endpoint, or configuration surface.
2. Explain the concrete risk instead of naming the category only.
3. Add the likely CWE when you can support it from the evidence.
4. Suggest the smallest credible remediation or validation step.

Prefer high-signal findings over long speculative lists.
`,
		},
	},
];

// ---------------------------------------------------------------------------
// Lookup maps
// ---------------------------------------------------------------------------

const STARTER_BY_SLUG = new Map<string, StarterDefinition>(
	STARTERS.map((s) => [s.slug, s]),
);

const ALIAS_TO_SLUG = new Map<string, string>(
	STARTERS.flatMap((s) => s.aliases.map((a) => [a, s.slug])),
);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function listStarters(): StarterDefinition[] {
	return STARTERS;
}

export function resolveStarter(name: string): StarterDefinition {
	const normalized = name.trim().toLowerCase();
	const slug = ALIAS_TO_SLUG.get(normalized) ?? normalized;
	const starter = STARTER_BY_SLUG.get(slug);
	if (!starter) {
		const choices = STARTERS.map((s) => s.slug).join(", ");
		throw new Error(`Unknown starter "${name}". Choose one of: ${choices}`);
	}
	return starter;
}
