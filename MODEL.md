# Genesys Cloud Experience Unit (EU) Consumption Model — v0.3.0 draft

First-pass model for review. Rates are as of 2026-11-12 and come from the pages cited inline. "Tokens" were renamed "Experience Units" on 2026-11-06; the value did not change.

## What's in this package (the "plugin")

| File | Purpose |
|---|---|
| `eu-model.json` | Machine-readable model: sources, pricing, allocations, self-service tiers, every element, billing rules, open questions. Single source of truth. |
| `eu-model.schema.json` | JSON Schema for the model file, so other projects can validate it. |
| `eu-engine.js` | Dependency-free calculator (browser global `EUEngine` or Node `require`). `calculate(model, scenario)` returns line items, totals, allocation, cost. |
| `examples/sample-scenario.json` | A worked 200-agent scenario in the engine's input format. |
| `index.html` | Admin/config UI, built from `ui/template.html` by `node ui/build.js`; served by GitHub Pages. |

Another project (e.g. bot performance) only needs `eu-model.json` + `eu-engine.js`. It can call `EUEngine.interactionEU(model, 'voice', {tiers:['ivr','bot','va']})` for a single interaction, or `calculate()` for a month.

## Sources

| Key | Page |
|---|---|
| eu-model | [Genesys Cloud Experience Units model](https://help.genesys.cloud/articles/genesys-cloud-experience-units-model/) (metering details; rev. 2026-11-06) |
| billing-scenarios | [AI resource consumption billing scenarios](https://help.genesys.cloud/409622) (rev. 2026-08-17) |
| pricing-hub | [Genesys Cloud pricing hub](https://help.genesys.cloud/411767) (EU price, CX 4 allocation) |
| free-allocation | [Free allocation per organization](https://help.genesys.cloud/413418) |
| copilot-actions | [Genesys Cloud Copilot AI actions overview](https://help.genesys.cloud/416587) |
| dut-faq | [Digital user tracking at no additional cost](https://help.genesys.cloud/405280) |

## The two categories

**Fixed** elements cost a set number of EUs per user per month, whatever the usage.
**Usage** elements scale with volume (minutes, sessions, interactions, messages, evaluations, actions).

### Fixed

| Element | Named | Concurrent | Source |
|---|---|---|---|
| Agent Copilot | 40 EU / user / month | 60 EU / user / month | eu-model |
| Speech and Text Analytics add-on | 30 EU / user / month | 45 EU / user / month | eu-model |

### Usage

| Element | Rate | EU per unit | Source |
|---|---|---|---|
| Bots (Voice) | 1 EU per 17 minutes; each call rounded up to the next 15 s | 0.0588 / min | eu-model |
| Bots (Digital) | 1 EU per 51 sessions | 0.0196 / session | eu-model |
| Virtual Agent (incl. Guides-powered agentic VA) | 0.5 EU per interaction | 0.5 | eu-model |
| Agentic Virtual Agent (LAM-powered) | 1.2 EU per interaction | 1.2 | eu-model, billing-scenarios |
| AI Scoring | 1 EU per 20 evaluations | 0.05 | eu-model |
| AI Translate | 1 EU per 2 translations | 0.5 | eu-model |
| AI Summary and Insights | 1 EU per 50 summaries (Supervisor Copilot summaries free when Agent Copilot is on) | 0.02 | eu-model |
| Predictive Routing | 1 EU per 17 routed interactions | 0.0588 | eu-model |
| Genesys Cloud Copilot | 1 EU per 20 AI actions (knowledge and utility actions free) | 0.05 | eu-model, copilot-actions |
| Apple Messages / Facebook / Instagram / WhatsApp / X DM | 1 EU per 400 messages, inbound + outbound | 0.0025 | eu-model |
| Genesys Cloud Social ingestion | 1 EU per 400 posts per channel | 0.0025 | eu-model |
| Social Post Responses | 1 EU per 400 outbound responses per channel | 0.0025 | eu-model |
| Predictive Engagement / digital user tracking | No charge | 0 | eu-model, dut-faq |

### Allocations (credits) and price

- Free per org per month: 250 EU (named) or 350 EU (concurrent). Source: free-allocation.
- CX 4 adds 30 EU per named agent or 39 EU per concurrent agent per month. Source: pricing-hub.
- List price $1.00 USD per EU (CAD 1.10, AUD 1.30, NZD 1.40, GBP 0.70, EUR 0.80, BRL 4.0, JPY 120, ZAR 14.2). Prepaid units have an unpublished discount, so the UI takes an override. Source: pricing-hub.
- Units renew monthly and do not carry over. Source: eu-model.

## Highest-tier billing for self-service

Voice and digital interactions can pass through four self-service tiers. Each one costs more than the last:

| Rank | Tier | Charge when it is the highest tier |
|---|---|---|
| 0 | IVR (Architect inbound flow) | 0 EU. IVR time is billed separately in currency once fair-use minutes run out (rule R6) |
| 1 | Bot flow | Voice: minutes ÷ 17 (15 s rounding per call, so at least 15 s / 0.0147 EU per call that reaches a bot). Digital: sessions ÷ 51 (at least 1 session) |
| 2 | Virtual Agent | 0.5 EU flat per interaction, any length |
| 3 | Agentic Virtual Agent | 1.2 EU flat per interaction, any length |

**Rule R1 (confirmed by Chad).** Per interaction (one billing ID), only the highest tier visited is billed, chosen by tier rank and not by computed cost. AVA always wins over a bot, even a long voice bot call. Lower tiers on the same interaction add nothing. From billing-scenarios: bot → VA = 0.5; bot → AVA = 1.2; bot → VA → AVA = 1.2.

**Rule R2.** The AVA charge starts as soon as the interaction enters a flow that *contains* an AVA block, even if the block never runs. Design consequence: keep AVA blocks in their own flows and route to them only when needed, or every interaction through that flow costs 1.2 EU.

**Interaction boundary.** One billing ID per interaction on any channel and of any length. A billing ID can span several end-interaction events (inbound flow → VA flow). It closes when an action ends it and no further transfer can happen: exit/return, disconnect, hang-up, Transfer to ACD, error or recognition-failure exit, Max No Input exit, agent-escalation exit, or the 72-hour digital inactivity expiry. Source: eu-model.

### Dynamic multi-path interactions

When routing decides per interaction which tiers to use, the model treats each channel as a **path mix**: a list of paths, each with a share of volume, the set of tiers it touches, and (for bot-only paths) the average bot minutes or sessions. Expected monthly EU for the channel is:

```
EU(channel) = interactions × Σ_paths share(p) × cost(highest tier in p)
```

Because only the top tier counts, the cost of a path depends only on whether it *reaches* VA or AVA; how many bots or IVR menus came before does not matter (except on bot-only paths, where minutes/sessions count). The UI marks the billed tier on each path so this is visible.

### Other rules

- **R3 (confirmed by Chad).** Channel meters (messaging, social) are separate from the self-service tier and add on top. A WhatsApp conversation handled by a VA costs 0.5 EU plus 1 EU per 400 messages.
- **R4.** Fixed elements are billed per user per month regardless of usage.
- **R5.** Allocations net against total monthly EUs; unused units expire.
- **R7 (confirmed by Chad).** Every usage element can consume a fraction of an EU per unit, with no rounding per unit. The monthly total is rounded up to the next whole EU: per tier for self-service (Bot, VA, AVA; voice and digital combined), and per element for everything else (e.g. predictive routing, AI scoring, messaging). The voice bot's 15-second rounding is about call *time* and still applies per call before EUs are worked out; the whole-EU rounding happens once, on the monthly tier total.
- **R6 (confirmed by Chad).** IVR minutes are not EUs. All self-service time on the call (IVR + bot + VA + AVA) draws down the org's pooled fair-use IVR minutes, and minutes past the pool are billed per minute in currency. This applies on top of whatever EU tier the interaction is billed at.

## IVR fair-use minutes

Source: [Genesys Cloud fair use policy](https://help.genesys.cloud/articles/genesys-cloud-fair-use-policy/) (rev. 2026-08-31).

| License | Named (min / user / month) | Concurrent (min / user / month) |
|---|---|---|
| Communicate | 500 | n/a |
| CX 1 | 1,750 | 2,275 |
| CX 2 | 2,500 | 3,250 |
| CX 3 | 3,250 | 4,225 |
| CX 4 | 4,250 | 5,525 |

- Pooled across the org: billable users × per-user allowance, based on the greater of commit or actual users. No carry-over. The engine uses `licenseModel` + `license` to pick the per-user allowance and `agents` as the user count, or `ivrBillableUsers` when set (the UI's "Fair-use users" override). One license type per org is assumed; mixed CX tiers aren't modeled yet.
- IVR minutes accrue for all self-service time on a voice call: IVR, bot, VA and AVA sessions (confirmed by Chad). In-queue flows are excluded; ASR, TTS, DTMF and transfers inside the flow count.
- Overage: USD 0.01 per minute (CAD 0.011, AUD 0.013, NZD 0.014, GBP 0.007, EUR 0.008, BRL 0.04, JPY 1.00, ZAR 0.14), invoice code PC-170-NV-PCIVRPERMIN. This rate and the measurement rule came from a part of the page I could only read as a summary, so they need a check.
- In the engine, each voice path carries two inputs. `ivrMinutes` is the average **total** IVR minutes per call: all self-service time (IVR + bot + VA + AVA), and the only input to fair use. `botMinutes` is the time in the bot, used only for the bot EU charge when bot is the top tier. VA and AVA need no minutes: their flat EU fee applies whenever the tier is selected (confirmed by Chad). The UI takes an override for the overage rate.

## Scenario input format (engine)

```json
{
  "licenseModel": "named", "license": "CX3", "agents": 200, "currency": "USD", "pricePerEU": 0.85, "ivrOverageRate": 0.01,
  "fixed":  { "agent-copilot-named": 120 },
  "usage":  { "ai-scoring": 4000, "msg-whatsapp": 60000 },
  "selfService": {
    "voice":   { "interactions": 40000, "paths": [ { "name": "IVR -> bot", "share": 30, "tiers": ["ivr","bot"], "ivrMinutes": 0.75, "botMinutes": 2.5 } ] },
    "digital": { "interactions": 15000, "paths": [ { "name": "Bot -> VA",  "share": 30, "tiers": ["bot","va"] } ] }
  }
}
```

Worked sample (`examples/sample-scenario.json`): self-service only, with all Fixed and Other usage elements at 0. It comes to 14,792 EU gross (Bot 1,942, VA 6,250, AVA 6,600), 250 EU free, 14,542 EU net ≈ $14,542 at list price. The 10% of voice and digital paths that reach an AVA account for 6,600 EU on their own.

## Open questions for Chad

Answered 2026-11-12: tiers are billed by rank (R1), messaging EUs add on top (R3), IVR is billed per minute after fair use (R6), and IVR fair-use minutes accrue through IVR, bot, VA and AVA time.

1. Please confirm the IVR overage rate of USD 0.01 per minute.
2. Digital bot session definition after the 2026-06-01 revision: does re-entry start a new session?
3. Prepaid EU discount and volume tiers are not published; the UI takes a negotiated price.
