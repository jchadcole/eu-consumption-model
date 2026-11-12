/*
 * Genesys Cloud Experience Unit (EU) calculation engine - v0.1.0-draft
 * Pure, dependency-free. Works in the browser (window.EUEngine) and Node (require).
 *
 *   const { calculate } = require('./eu-engine.js');
 *   const result = calculate(model, scenario);
 *
 * See MODEL.md for the scenario format and the billing rules this implements.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.EUEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
  const euPerUnit = (rate) => (rate.per ? rate.eu / rate.per : rate.eu);

  function tierMap(model) {
    const m = {};
    model.selfServiceTiers.tiers.forEach((t) => (m[t.id] = t));
    return m;
  }

  /** Highest-ranked tier among those an interaction visits (rule R1). */
  function highestTier(model, tierIds) {
    const tiers = tierMap(model);
    return tierIds
      .map((id) => tiers[id])
      .filter(Boolean)
      .reduce((best, t) => (!best || t.rank > best.rank ? t : best), null);
  }

  /** EUs for ONE interaction on a path. channel: 'voice' | 'digital'. */
  function interactionEU(model, channel, path) {
    const top = highestTier(model, path.tiers || []);
    if (!top) return { tier: null, eu: 0 };
    if (top.id === 'bot') {
      if (channel === 'voice') {
        // A call that reaches a bot is in it for at least one 15-second increment.
        const entered = (path.botMinutes || 0) * 60;
        const secs = Math.max(entered, 15);
        const inc = 15; // per-call rounding up to next 15 s
        const billedMin = (Math.ceil(secs / inc) * inc) / 60;
        return { tier: top.id, eu: billedMin * euPerUnit(top.voice), billedMinutes: billedMin, minimumApplied: entered < 15 };
      }
      const given = path.botSessions == null ? 1 : path.botSessions;
      const sessions = Math.max(given, 1); // reaching a digital bot is at least one session
      return { tier: top.id, eu: sessions * euPerUnit(top.digital), minimumApplied: given < 1 };
    }
    return { tier: top.id, eu: euPerUnit(top) };
  }

  /** Expected EUs for a channel given a mix of paths (dynamic multi-path). */
  function selfServiceEU(model, channel, cfg) {
    if (!cfg || !cfg.interactions) return { eu: 0, paths: [], byTier: {} };
    const totalShare = (cfg.paths || []).reduce((s, p) => s + (p.share || 0), 0) || 1;
    const byTier = {};
    const paths = (cfg.paths || []).map((p) => {
      const count = cfg.interactions * (p.share || 0) / totalShare;
      const per = interactionEU(model, channel, p);
      const eu = count * per.eu;
      const key = per.tier || 'none';
      byTier[key] = (byTier[key] || 0) + eu;
      return { name: p.name, tiers: p.tiers, interactions: round(count, 2), billedTier: per.tier, euPerInteraction: round(per.eu), eu: round(eu, 2), minimumApplied: !!per.minimumApplied };
    });
    const eu = paths.reduce((s, p) => s + p.eu, 0);
    Object.keys(byTier).forEach((k) => (byTier[k] = round(byTier[k], 2)));
    return { eu: round(eu, 2), paths, byTier };
  }

  function allocation(model, scenario) {
    let eu = 0;
    const lines = [];
    model.allocations.forEach((a) => {
      const m = a.appliesTo || {};
      if (m.licenseModel && m.licenseModel !== scenario.licenseModel) return;
      if (m.license && m.license !== scenario.license) return;
      const qty = a.per === 'agent-month' ? scenario.agents || 0 : 1;
      const v = a.eu * qty;
      eu += v;
      lines.push({ id: a.id, name: a.name, eu: v });
    });
    return { eu, lines };
  }

  /**
   * scenario = {
   *   licenseModel: 'named'|'concurrent', license: 'CX3', agents: 100, currency: 'USD', pricePerEU?: number,
   *   fixed:  { '<elementId>': users },
   *   usage:  { '<elementId>': units },          // non-self-service usage elements
   *   selfService: { voice: { interactions, paths:[{name,share,tiers:[...],botMinutes}] },
   *                  digital:{ interactions, paths:[{name,share,tiers:[...],botSessions}] } }
   * }
   */
  function calculate(model, scenario) {
    const lines = [];
    const byId = {};
    model.elements.forEach((e) => (byId[e.id] = e));

    Object.entries(scenario.fixed || {}).forEach(([id, users]) => {
      const e = byId[id];
      if (!e || !users) return;
      lines.push({ id, name: e.name, category: 'fixed', group: e.group, quantity: users, unit: e.rate.unit, eu: round(users * euPerUnit(e.rate), 2), source: e.source });
    });

    const copilotOn = Object.keys(scenario.fixed || {}).some((k) => k.startsWith('agent-copilot') && scenario.fixed[k] > 0);
    Object.entries(scenario.usage || {}).forEach(([id, qty]) => {
      const e = byId[id];
      if (!e || !qty || e.tierRef) return;
      let eu = qty * euPerUnit(e.rate);
      let note;
      if (id === 'ai-summary' && copilotOn && scenario.summaryCoveredByCopilot) { eu = 0; note = 'waived: Agent Copilot enabled'; }
      lines.push({ id, name: e.name, category: 'usage', group: e.group, quantity: qty, unit: e.rate.unit, eu: round(eu, 2), note, source: e.source });
    });

    const ss = scenario.selfService || {};
    const voice = selfServiceEU(model, 'voice', ss.voice);
    const digital = selfServiceEU(model, 'digital', ss.digital);
    if (voice.eu) lines.push({ id: 'self-service-voice', name: 'Self-service (voice) - highest tier', category: 'usage', group: 'self-service', quantity: ss.voice.interactions, unit: 'interaction', eu: voice.eu, source: 'billing-scenarios' });
    if (digital.eu) lines.push({ id: 'self-service-digital', name: 'Self-service (digital) - highest tier', category: 'usage', group: 'self-service', quantity: ss.digital.interactions, unit: 'interaction', eu: digital.eu, source: 'billing-scenarios' });

    const gross = round(lines.reduce((s, l) => s + l.eu, 0), 2);
    const alloc = allocation(model, scenario);
    const net = Math.max(0, round(gross - alloc.eu, 2));
    const currency = scenario.currency || 'USD';
    const price = scenario.pricePerEU != null ? scenario.pricePerEU : model.pricing.pricePerEU[currency];
    const fixedEU = round(lines.filter((l) => l.category === 'fixed').reduce((s, l) => s + l.eu, 0), 2);

    const ivr = ivrFairUse(model, scenario, currency);
    const euCost = round(net * price, 2);

    return {
      modelVersion: model.modelVersion,
      lines,
      selfService: { voice, digital },
      ivr,
      totals: { fixedEU, usageEU: round(gross - fixedEU, 2), grossEU: gross, allocationEU: alloc.eu, netEU: net, unusedAllocationEU: Math.max(0, round(alloc.eu - gross, 2)), currency, pricePerEU: price,
        cost: euCost, ivrOverageCost: ivr ? ivr.overageCost : 0, totalCost: round(euCost + (ivr ? ivr.overageCost : 0), 2) },
      allocation: alloc,
    };
  }

  /**
   * IVR minutes are not EUs (rule R6). They draw down a pooled fair-use allowance
   * (per billable user x license), and minutes past it are billed per minute in currency.
   * All self-service time on a voice call counts: per path ivrMinutes + botMinutes + agentMinutes (VA/AVA time).
   */
  /** Fair-use minutes for one call on a path; minutes only count for tiers the path touches. */
  function fairUseMinutesPerCall(p) {
    const t = p.tiers || [];
    return (t.includes('ivr') ? p.ivrMinutes || 0 : 0)
      + (t.includes('bot') ? p.botMinutes || 0 : 0)
      + (t.includes('va') || t.includes('ava') ? p.agentMinutes || 0 : 0);
  }

  function ivrFairUse(model, scenario, currency) {
    const fu = model.fairUse && model.fairUse.ivrMinutes;
    const v = scenario.selfService && scenario.selfService.voice;
    if (!fu) return null;
    let minutes = 0;
    if (v && v.interactions) {
      const totalShare = (v.paths || []).reduce((s, p) => s + (p.share || 0), 0) || 1;
      (v.paths || []).forEach((p) => { minutes += v.interactions * (p.share || 0) / totalShare * fairUseMinutesPerCall(p); });
    }
    minutes += scenario.extraIvrMinutes || 0;
    const perUser = ((fu.perUserPerMonth[scenario.licenseModel] || {})[scenario.license]) || 0;
    const users = scenario.ivrBillableUsers != null ? scenario.ivrBillableUsers : (scenario.agents || 0);
    const allowance = perUser * users;
    const overageMinutes = Math.max(0, minutes - allowance);
    const rate = scenario.ivrOverageRate != null ? scenario.ivrOverageRate : (fu.overagePerMinute[currency] || 0);
    return { minutes: round(minutes, 0), perUser, users, allowance, overageMinutes: round(overageMinutes, 0),
      usedPct: allowance ? round(minutes / allowance * 100, 1) : null, ratePerMinute: rate, overageCost: round(overageMinutes * rate, 2) };
  }

  return { calculate, interactionEU, highestTier, selfServiceEU, ivrFairUse, fairUseMinutesPerCall, euPerUnit };
});
