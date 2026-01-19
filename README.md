# Feedback Triage

Feedback Triage is a lightweight product feedback triaging system built on the Cloudflare Developer Platform.  
It simulates how real-world product teams receive feedback from multiple sources, automatically extracts signal using AI, and surfaces the most urgent and high-impact issues in a ranked dashboard.

The goal is to reduce noise at ingestion time by converting unstructured feedback into actionable insights — allowing teams to focus on what matters most.

---

## Problem

Product feedback arrives fragmented across many channels:
- Support tickets
- GitHub issues
- Community forums
- Chat platforms

While feedback volume is high, extracting **urgency**, **impact**, **sentiment**, and **themes** is manual and time-consuming.  
Teams often spend more time triaging feedback than acting on it.

**The problem is not lack of feedback — it is lack of signal.**

---

## User Story

**As a product manager or support lead**,  
I want feedback from multiple sources to be automatically triaged and ranked by urgency and value,  
so that I can quickly identify what needs attention without manually reading every message.

---

## Solution Overview

Feedback Triage addresses this by:

- Simulating multi-source feedback ingestion at the backend
- Normalizing all feedback into a single pipeline
- Automatically analyzing feedback at ingestion time using AI
- Ranking issues by urgency, value impact, and sentiment
- Providing a clean dashboard focused on signal, not raw noise

All feedback shown in the UI is already triaged — there are no “analyze” buttons or manual steps.

---

## Demo

**Live demo:**  
👉 https://feedbak-ai-agent.damil-feedback.workers.dev/

### How to use the demo
1. Open the demo link
2. Click **“Seed demo dataset”**  
   - This simulates a realistic day of feedback across GitHub, Support, and Community sources
   - Each item is auto-analyzed at ingestion time
3. View the ranked feedback feed
4. Use filters (urgency, sentiment) or search
5. Ask **Problapary** (AI assistant) questions like:
   - “What are the most urgent issues?”
   - “What themes appear across multiple sources?”

---

## Problapary (AI Assistant)

Problapary is an AI assistant designed to summarize patterns across the triaged dataset.

**Key characteristics:**
- Summaries only (no links, no IDs)
- Focused on trends and priorities
- Built to reduce cognitive load, not replace the dashboard

Example questions:
- “What are the top recurring themes?”
- “Which problems are blocking users?”
- “What feedback appears most urgent this week?”

---

## Architecture

Feedback Triage is built entirely on the Cloudflare Developer Platform:

### Cloudflare Products Used

- **Cloudflare Workers**
  - Hosts the API and frontend
  - Enables fast, globally available ingestion and triage

- **D1 (Serverless SQL Database)**
  - Stores raw feedback and AI-generated metadata
  - Chosen for simplicity and tight Workers integration

- **Workers AI**
  - Extracts sentiment, urgency, value impact, themes, and summaries
  - Enables auto-triage at ingestion time

Together, these services allow feedback to be ingested, analyzed, and ranked without external infrastructure.

---

## Mock Data & Simulation Strategy

This prototype uses mock data to simulate real-world feedback ingestion:

- Separate backend ingestion paths simulate different sources (GitHub, Support, Community)
- Each source produces different types of feedback text
- All feedback is normalized into a common schema before analysis
- The entire aggregation and triage pipeline is real — only the event origin is simulated

This approach allows the system to demonstrate realistic behavior without live third-party integrations.

---

## What This Prototype Demonstrates

- Product thinking focused on signal over noise
- Auto-triage as a design decision (not a UI feature)
- Intentional minimalism in the dashboard
- Practical use of Cloudflare Workers, D1, and Workers AI
- Ability to critique and reason about developer platform UX

---

## Assignment Context

This project was built as part of the **Cloudflare Product Manager Intern assignment**.  
The focus is on product thinking, tradeoffs, and feedback on the Cloudflare Developer Platform — not on building a production-ready system.

---

## Repository Structure

