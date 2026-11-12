# EU Consumption Model

A reusable model of how Genesys Cloud consumes Experience Units (EUs, formerly AI Experience tokens), with a calculator and an interactive modeler.

**Live modeler:** https://jchadcole.github.io/eu-consumption-model/ (once GitHub Pages is on; see below)

## What's here

| Path | What it is |
|---|---|
| [`MODEL.md`](MODEL.md) | The written model: Fixed vs Usage elements, rates, highest-tier billing, IVR fair use, open questions. Every rate cites its Genesys help page. |
| [`eu-model.json`](eu-model.json) | Machine-readable model. Single source of truth for rates and rules. |
| [`eu-model.schema.json`](eu-model.schema.json) | JSON Schema for `eu-model.json`. |
| [`eu-engine.js`](eu-engine.js) | Dependency-free calculator. Browser global `EUEngine`, or `require()` in Node. |
| [`examples/sample-scenario.json`](examples/sample-scenario.json) | Worked 200-agent scenario in the engine's input format. |
| [`ui/template.html`](ui/template.html), [`ui/build.js`](ui/build.js) | Source for the modeler page. |
| [`index.html`](index.html) | The built modeler (generated; don't edit by hand). |

## Using it from another project

```js
const model = require('./eu-model.json');
const { calculate, interactionEU } = require('./eu-engine.js');

// One interaction: IVR -> bot -> VA is billed at the VA tier (0.5 EU)
interactionEU(model, 'voice', { tiers: ['ivr', 'bot', 'va'] });

// A whole month
const result = calculate(model, require('./examples/sample-scenario.json'));
console.log(result.totals); // grossEU, allocationEU, netEU, cost, ivrOverageCost, totalCost
```

In a browser, load `eu-engine.js` with a script tag and `fetch('eu-model.json')`.

## Updating rates

1. Edit `eu-model.json` (and `MODEL.md` if a rule changes).
2. Run `node ui/build.js` to rebuild `index.html`.
3. Commit both.

## GitHub Pages

Settings → Pages → Source: "Deploy from a branch", Branch: `main`, folder `/ (root)`.

Rates as of 2026-11-12. This is a planning model, not a Genesys statement of billing.
