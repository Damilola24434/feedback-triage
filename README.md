# feedback-triage
A feedback triage system that aggregates multi-source product feedback, auto-extracts signal with AI, and ranks issues by urgency and impact using Cloudflare Workers.

Feedback Triage is a lightweight product feedback triaging system built on the Cloudflare Developer Platform. 
It simulates how real-world product teams receive feedback from multiple sources (GitHub, Support, Community),
automatically extracts signal using AI, and surfaces the most urgent and high-impact issues in a ranked dashboard.

The system is designed to reduce noise at ingestion time by converting unstructured feedback into actionable insights
(sentiment, urgency, value impact, and themes), allowing product and engineering teams to focus on what matters most.

## Why Feedback Triage?
Product teams don’t suffer from a lack of feedback — they suffer from fragmented, noisy feedback.
Signals arrive across support tickets, GitHub issues, chat platforms, and community forums, making it
time-consuming to assess urgency, impact, and patterns.

Feedback Triage demonstrates how this problem can be addressed by:
- Aggregating feedback into a single pipeline
- Automatically triaging signal at ingestion time using AI
- Ranking issues to reduce manual sorting and cognitive load

## Built with Cloudflare
- **Cloudflare Workers** – API + frontend hosting
- **D1** – serverless SQL storage for feedback and metadata
- **Workers AI** – automated feedback triage and summarization





