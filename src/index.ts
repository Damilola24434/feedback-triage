/**
 * Feedback AI Agent (MVP) - Cloudflare Worker + D1 + Workers AI
 *
 * Endpoints:
 *  - GET  /api/health                 -> health check
 *  - POST /api/feedback               -> store feedback (source + text) + auto-triage
 *  - GET  /api/feedback?limit=120     -> list feedback (latest first)
 *  - GET  /api/feedback/:id           -> fetch feedback by id
 *  - POST /api/feedback/:id/analyze   -> optional re-triage by id
 *  - POST /api/seed                   -> insert 15 multi-source demo items + auto-triage
 *  - POST /api/assistant              -> Problapary summaries-only Q&A over the dataset
 *
 * Bindings expected:
 *  - D1: env.feedback_db
 *  - AI: env.AI  (Workers AI)
 */

type FeedbackRow = {
	id: number;
	source: string;
	text: string;
	created_at: string;
	sentiment: string | null;
	urgency: string | null;
	value_impact: string | null;
	themes: string | null; // JSON string array
	summary: string | null;
};

type AnalysisResult = {
	sentiment: 'positive' | 'neutral' | 'negative';
	urgency: 'low' | 'medium' | 'high';
	value_impact: 'low' | 'medium' | 'high';
	themes: string[];
	summary: string;
};

function jsonError(message: string, status = 400): Response {
	return Response.json({ ok: false, error: message }, { status });
}

function withCors(res: Response): Response {
	const headers = new Headers(res.headers);
	headers.set('Access-Control-Allow-Origin', '*');
	headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
	headers.set('Access-Control-Allow-Headers', 'Content-Type');
	return new Response(res.body, { status: res.status, headers });
}

function isJsonRequest(request: Request): boolean {
	const ct = request.headers.get('content-type') || '';
	return ct.toLowerCase().includes('application/json');
}

function safeStringify(obj: unknown): string {
	try {
		return JSON.stringify(obj);
	} catch {
		return String(obj);
	}
}

// Try to parse JSON from a model response that might be wrapped in text/code fences.
function extractJsonObject(text: string): any | null {
	const trimmed = text.trim();

	if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
		try {
			return JSON.parse(trimmed);
		} catch {
			// continue
		}
	}

	const start = trimmed.indexOf('{');
	const end = trimmed.lastIndexOf('}');
	if (start !== -1 && end !== -1 && end > start) {
		const candidate = trimmed.slice(start, end + 1);
		try {
			return JSON.parse(candidate);
		} catch {
			return null;
		}
	}

	return null;
}

function normalizeAnalysis(raw: any): AnalysisResult | null {
	if (!raw || typeof raw !== 'object') return null;

	const sentiment = raw.sentiment;
	const urgency = raw.urgency;
	const value_impact = raw.value_impact ?? raw.valueImpact ?? raw.value;

	const themes = raw.themes;
	const summary = raw.summary;

	const allowedSentiments = new Set(['positive', 'neutral', 'negative']);
	const allowedLevels = new Set(['low', 'medium', 'high']);

	if (!allowedSentiments.has(sentiment)) return null;
	if (!allowedLevels.has(urgency)) return null;
	if (!allowedLevels.has(value_impact)) return null;
	if (!Array.isArray(themes) || themes.some((t) => typeof t !== 'string')) return null;
	if (typeof summary !== 'string' || summary.trim().length === 0) return null;

	const cleanedThemes = themes
		.map((t: string) => t.trim())
		.filter(Boolean)
		.slice(0, 6)
		.map((t: string) => (t.length > 40 ? t.slice(0, 40) : t));

	return {
		sentiment,
		urgency,
		value_impact,
		themes: cleanedThemes,
		summary: summary.trim().slice(0, 200),
	};
}

function clampText(s: string, max: number): string {
	const t = (s || '').trim();
	return t.length > max ? t.slice(0, max) : t;
}

function asNonEmptyString(v: any): string {
	return typeof v === 'string' ? v.trim() : '';
}

/**
 * Run Workers AI to extract triage signals
 * Prompt is tuned to avoid "everything is high".
 */
async function runTriageAI(env: Env, source: string, text: string): Promise<AnalysisResult> {
	if (!env.AI) {
		throw new Error(
			`Workers AI binding not found at runtime (env.AI). Available env keys: ${Object.keys(env || {}).join(', ')}`
		);
	}

	const system =
		'You are a product feedback triage assistant. Return ONLY valid JSON (no markdown, no extra text).';

	const user = `Analyze this product feedback and extract:
- sentiment: one of ["positive","neutral","negative"]
- urgency: one of ["low","medium","high"]
  * HIGH only if it blocks core workflow, causes outage/data loss/security issues, or major account/revenue impact.
  * MEDIUM if it significantly harms workflow but has a workaround or affects a subset.
  * LOW if it is cosmetic, minor annoyance, or nice-to-have.
- value_impact: one of ["low","medium","high"] (impact if fixed)
  * HIGH if fixing unlocks major user value, reliability, or revenue.
  * MEDIUM if helpful improvement for many users.
  * LOW if incremental or niche.
- themes: array of 2-6 short theme labels (strings)
- summary: a single sentence summary (<= 200 chars)

Feedback source: ${source}
Feedback text: ${text}

Return JSON with keys: sentiment, urgency, value_impact, themes, summary.`;

	const aiResp: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
		messages: [
			{ role: 'system', content: system },
			{ role: 'user', content: user },
		],
	});

	const modelText =
		aiResp?.response ??
		aiResp?.result ??
		aiResp?.output_text ??
		aiResp?.text ??
		(typeof aiResp === 'string' ? aiResp : safeStringify(aiResp));

	const parsed = extractJsonObject(String(modelText));
	const analysis = normalizeAnalysis(parsed);
	if (!analysis) throw new Error(`AI returned unexpected format: ${String(modelText).slice(0, 600)}`);

	return analysis;
}

async function fetchById(env: Env, id: number): Promise<FeedbackRow | null> {
	return await env.feedback_db
		.prepare(
			`SELECT id, source, text, created_at, sentiment, urgency, value_impact, themes, summary
       FROM feedback WHERE id = ? LIMIT 1;`
		)
		.bind(id)
		.first<FeedbackRow>();
}

async function updateAnalysis(env: Env, id: number, analysis: AnalysisResult): Promise<void> {
	await env.feedback_db
		.prepare(
			`UPDATE feedback
       SET sentiment = ?,
           urgency = ?,
           value_impact = ?,
           themes = ?,
           summary = ?
       WHERE id = ?;`
		)
		.bind(
			analysis.sentiment,
			analysis.urgency,
			analysis.value_impact,
			JSON.stringify(analysis.themes),
			analysis.summary,
			id
		)
		.run();
}

/**
 * Insert feedback and immediately triage + persist results.
 * This keeps the UI signal-only (no unanalyzed rows).
 */
async function insertAndAnalyze(env: Env, source: string, text: string): Promise<{ id: number; analysis: AnalysisResult }> {
	const insert = await env.feedback_db
		.prepare(`INSERT INTO feedback (source, text) VALUES (?, ?);`)
		.bind(source, text)
		.run();

	const id = Number((insert?.meta as any)?.last_row_id);
	if (!id) throw new Error('Failed to get inserted row id');

	const analysis = await runTriageAI(env, source, text);
	await updateAnalysis(env, id, analysis);

	return { id, analysis };
}

async function buildDatasetSummary(env: Env, limit = 120) {
	const { results } = await env.feedback_db
		.prepare(
			`SELECT id, source, text, created_at, sentiment, urgency, value_impact, themes, summary
       FROM feedback
       ORDER BY id DESC
       LIMIT ?;`
		)
		.bind(limit)
		.all<FeedbackRow>();

	const analyzed = results.filter((r) => r.summary && r.urgency && r.value_impact && r.sentiment);

	const counts = {
		total: results.length,
		analyzed: analyzed.length,
		byUrgency: { low: 0, medium: 0, high: 0 } as Record<'low' | 'medium' | 'high', number>,
		bySentiment: { positive: 0, neutral: 0, negative: 0 } as Record<'positive' | 'neutral' | 'negative', number>,
		bySource: {} as Record<string, number>,
		themeCounts: {} as Record<string, number>,
	};

	for (const r of analyzed) {
		counts.byUrgency[r.urgency as 'low' | 'medium' | 'high']++;
		counts.bySentiment[r.sentiment as 'positive' | 'neutral' | 'negative']++;
		counts.bySource[r.source] = (counts.bySource[r.source] || 0) + 1;

		if (r.themes) {
			try {
				const arr = JSON.parse(r.themes);
				if (Array.isArray(arr)) {
					for (const t of arr) {
						if (typeof t === 'string' && t.trim()) {
							const key = t.trim().toLowerCase();
							counts.themeCounts[key] = (counts.themeCounts[key] || 0) + 1;
						}
					}
				}
			} catch {
				// ignore
			}
		}
	}

	const topThemes = Object.entries(counts.themeCounts)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 8)
		.map(([theme, n]) => ({ theme, count: n }));

	return { counts, topThemes };
}

export default {
	async fetch(request, env, ctx): Promise<Response> {
		const url = new URL(request.url);
		const method = request.method.toUpperCase();

		if (method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));

		// GET /api/health
		if (method === 'GET' && url.pathname === '/api/health') {
			return withCors(Response.json({ ok: true, service: 'feedback-ai-agent' }));
		}

		// POST /api/feedback (create + auto-triage)
		if (url.pathname === '/api/feedback' && method === 'POST') {
			if (!isJsonRequest(request)) return withCors(jsonError('Content-Type must be application/json', 415));

			let body: any;
			try {
				body = await request.json();
			} catch {
				return withCors(jsonError('Invalid JSON body', 400));
			}

			const source = clampText(asNonEmptyString(body?.source), 100);
			const text = clampText(asNonEmptyString(body?.text), 5000);

			if (!source) return withCors(jsonError('Missing required field: source', 400));
			if (!text) return withCors(jsonError('Missing required field: text', 400));

			try {
				const { id, analysis } = await insertAndAnalyze(env, source, text);
				return withCors(Response.json({ ok: true, id, analysis, message: 'Feedback stored and triaged' }));
			} catch (err: any) {
				return withCors(jsonError(`Create+triage failed: ${err?.message || String(err)}`, 500));
			}
		}

		// GET /api/feedback
		if (url.pathname === '/api/feedback' && method === 'GET') {
			const limitParam = url.searchParams.get('limit');
			const limit = Math.max(1, Math.min(200, Number(limitParam || 50) || 50));

			try {
				const { results } = await env.feedback_db
					.prepare(
						`SELECT id, source, text, created_at, sentiment, urgency, value_impact, themes, summary
             FROM feedback
             ORDER BY id DESC
             LIMIT ?;`
					)
					.bind(limit)
					.all<FeedbackRow>();

				return withCors(Response.json({ ok: true, count: results.length, results }));
			} catch (err: any) {
				return withCors(jsonError(`Database query failed: ${err?.message || String(err)}`, 500));
			}
		}

		// GET /api/feedback/:id
		const getByIdMatch = url.pathname.match(/^\/api\/feedback\/(\d+)$/);
		if (getByIdMatch && method === 'GET') {
			const id = Number(getByIdMatch[1]);
			try {
				const row = await fetchById(env, id);
				if (!row) return withCors(jsonError(`No feedback found for id ${id}`, 404));
				return withCors(Response.json({ ok: true, result: row }));
			} catch (err: any) {
				return withCors(jsonError(`Database query failed: ${err?.message || String(err)}`, 500));
			}
		}

		// POST /api/feedback/:id/analyze (optional re-triage)
		const analyzeMatch = url.pathname.match(/^\/api\/feedback\/(\d+)\/analyze$/);
		if (analyzeMatch && method === 'POST') {
			const id = Number(analyzeMatch[1]);
			try {
				const row = await fetchById(env, id);
				if (!row) return withCors(jsonError(`No feedback found for id ${id}`, 404));

				const analysis = await runTriageAI(env, row.source, row.text);
				await updateAnalysis(env, id, analysis);

				return withCors(Response.json({ ok: true, id, analysis }));
			} catch (err: any) {
				return withCors(jsonError(`Re-triage failed: ${err?.message || String(err)}`, 500));
			}
		}

		// POST /api/seed -> insert 15 demo items + auto-triage
		if (url.pathname === '/api/seed' && method === 'POST') {
			const demo: Array<{ source: string; text: string }> = [
				// GitHub
				{ source: 'GitHub', text: 'Login returns 500 for most users after the latest deploy. Blocks core access.' },
				{ source: 'GitHub', text: 'API requests intermittently time out during peak traffic. Reproducible in us-east.' },
				{ source: 'GitHub', text: 'Rate limit error is vague—doesn’t explain limits or when to retry.' },
				{ source: 'GitHub', text: 'Feature request: allow saving dashboard filters for triage workflows.' },
				{ source: 'GitHub', text: 'Small UI polish: spacing misaligned in settings panel on smaller screens.' },

				// Discord
				{ source: 'Discord', text: 'Seeing 5xx when logging in—anyone else? It’s blocking us right now.' },
				{ source: 'Discord', text: 'D1 setup on Windows took longer than expected—docs could be more step-by-step.' },
				{ source: 'Discord', text: 'Dashboard feels a bit slow on mobile. Not a blocker, but noticeable.' },
				{ source: 'Discord', text: 'Love the product—setup was smooth. Would love more examples for common workflows.' },
				{ source: 'Discord', text: 'Nice-to-have: keyboard shortcuts for faster navigation in the dashboard.' },

				// Support
				{ source: 'Support', text: 'Customer cannot access account due to persistent server error. Business impact.' },
				{ source: 'Support', text: 'Customer reports duplicate billing charge for an invoice. Needs investigation.' },
				{ source: 'Support', text: 'Confusing upgrade path: which plan includes Workers AI and where to enable it?' },
				{ source: 'Support', text: 'Docs request: simpler getting started guide with a full working example.' },
				{ source: 'Support', text: 'UI preference: request a dark mode toggle for the dashboard.' },
			];

			try {
				// Check if data already exists to avoid re-seeding
				const countResult = await env.feedback_db
					.prepare('SELECT COUNT(*) as cnt FROM feedback')
					.first<{ cnt: number }>();
				
				const existingCount = countResult?.cnt ?? 0;
				if (existingCount > 0) {
					// Data already exists, skip seeding
					return withCors(Response.json({ ok: true, inserted: 0, skipped: true, existing: existingCount }));
				}

				let inserted = 0;
				for (const item of demo) {
					await insertAndAnalyze(env, item.source, item.text);
					inserted++;
				}
				return withCors(Response.json({ ok: true, inserted }));
			} catch (err: any) {
				return withCors(jsonError(`Seed failed: ${err?.message || String(err)}`, 500));
			}
		}

		// POST /api/assistant -> Problapary summaries-only answer
		if (url.pathname === '/api/assistant' && method === 'POST') {
			if (!isJsonRequest(request)) return withCors(jsonError('Content-Type must be application/json', 415));

			let body: any;
			try {
				body = await request.json();
			} catch {
				return withCors(jsonError('Invalid JSON body', 400));
			}

			const question = clampText(asNonEmptyString(body?.question), 1200);
			if (!question) return withCors(jsonError('Missing required field: question', 400));

			try {
				const ds = await buildDatasetSummary(env, 120);

				const system =
					'You are Problapary, an assistant for summarizing triaged product feedback. ' +
					'Answer with summaries ONLY. Do not include item IDs, links, or quoting full user text. ' +
					'Be concise, structured, and actionable.';

				const user =
					`Triaged dataset summary:\n` +
					`- total items: ${ds.counts.total}\n` +
					`- analyzed items: ${ds.counts.analyzed}\n` +
					`- urgency counts: ${safeStringify(ds.counts.byUrgency)}\n` +
					`- sentiment counts: ${safeStringify(ds.counts.bySentiment)}\n` +
					`- source counts: ${safeStringify(ds.counts.bySource)}\n` +
					`- top themes: ${safeStringify(ds.topThemes)}\n\n` +
					`Question: ${question}\n\n` +
					`Return a short answer with bullet points when helpful. Summaries only.`;

				const aiResp: any = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
					messages: [
						{ role: 'system', content: system },
						{ role: 'user', content: user },
					],
				});

				const text =
					aiResp?.response ??
					aiResp?.result ??
					aiResp?.output_text ??
					aiResp?.text ??
					(typeof aiResp === 'string' ? aiResp : safeStringify(aiResp));

				return withCors(Response.json({ ok: true, answer: String(text).trim() }));
			} catch (err: any) {
				return withCors(jsonError(`Assistant failed: ${err?.message || String(err)}`, 500));
			}
		}

		return withCors(jsonError('Not Found', 404));
	},
} satisfies ExportedHandler<Env>;
