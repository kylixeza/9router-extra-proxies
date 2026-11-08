'use strict';

const TOOL_ROLES = new Set(['orchestrator', 'worker', 'fixer']);

function checkCandidate(model, requiredRole, needs = {}) {
  if (!model) return { ok: false, reason: 'unknown_id', warnings: [] };
  if (!model.isActive) return { ok: false, reason: 'inactive', warnings: [] };
  if (!model.available) return { ok: false, reason: 'unavailable', warnings: [] };
  if (requiredRole && (!Array.isArray(model.roles) || !model.roles.includes(requiredRole))) {
    return { ok: false, reason: 'role_mismatch', warnings: [] };
  }
  const mustSupportTools = Boolean((requiredRole && TOOL_ROLES.has(requiredRole)) || needs.needsTools);
  if (mustSupportTools && model.capTools === false) {
    return { ok: false, reason: 'no_tools', warnings: [] };
  }
  if (needs.needsVision && model.capVision === false) {
    return { ok: false, reason: 'needs_vision', warnings: [] };
  }
  if (needs.needsPdf && model.capPdf === false) {
    return { ok: false, reason: 'needs_pdf', warnings: [] };
  }

  const warnings = [];
  if (mustSupportTools && model.capTools === null) warnings.push(`cap_tools unknown (?) on ${model.id}`);
  if (needs.needsVision && model.capVision === null) warnings.push(`cap_vision unknown (?) on ${model.id}`);
  if (needs.needsPdf && model.capPdf === null) warnings.push(`cap_pdf unknown (?) on ${model.id}`);
  return { ok: true, reason: null, warnings };
}

function routeRequest(detection, store) {
  const kind = detection && detection.kind;
  const needs = (detection && detection.needs) || { needsVision: false, needsPdf: false, needsTools: false };
  if (!kind || kind === 'PASSTHROUGH') {
    return { routedModel: null, fallbackReason: null, warnings: [], failOpen: false };
  }

  const settings = store.getSettings();

  if (kind === 'ORCH') {
    // 1. Explicit inline orchestrator chosen in `/orch-plan @<model>` (no backup fallback: exact model or fail-open)
    if (detection.requestedOrchestrator) {
      const m = store.getModel(detection.requestedOrchestrator);
      const chk = checkCandidate(m, 'orchestrator', needs);
      if (chk.ok) {
        return { routedModel: m.id, fallbackReason: null, warnings: chk.warnings, failOpen: false };
      }
      if (needs.needsVision || needs.needsPdf) {
        const relChk = checkCandidate(m, 'orchestrator', { ...needs, needsVision: false, needsPdf: false });
        if (relChk.ok) {
          const mediaReason = needs.needsVision && m.capVision === false ? 'needs_vision' : 'needs_pdf';
          return {
            routedModel: m.id,
            fallbackReason: mediaReason,
            warnings: [...relChk.warnings, `orchestrator ${m.id} lacks media cap; adapter will omit media`],
            failOpen: false,
          };
        }
      }
      return {
        routedModel: null,
        fallbackReason: chk.reason || 'unknown_id',
        warnings: [`requested orchestrator ${detection.requestedOrchestrator} rejected (${chk.reason}); failing open`],
        failOpen: true,
      };
    }

    // 2. Client's currently selected model in IDE (`body.model`): if it is an active orchestrator in pool, use it!
    const clientModelId = detection.clientModel;
    if (clientModelId) {
      const cm = store.getModel(clientModelId);
      const chk = checkCandidate(cm, 'orchestrator', needs);
      if (chk.ok) {
        return { routedModel: cm.id, fallbackReason: null, warnings: chk.warnings, failOpen: false };
      }
    }

    // 3. Configured default orchestrator (`orchestrator_model`), else active orchestrator pool
    const activeOrchPool = store.listCachedModels()
      .filter(m => m.isActive && m.available && Array.isArray(m.roles) && m.roles.includes('orchestrator'))
      .map(m => m.id);
    const chain = [
      ...new Set([
        ...(settings.orchestrator_model ? [settings.orchestrator_model] : []),
        ...(Array.isArray(settings.orchestrator_chain) ? settings.orchestrator_chain : []),
        ...activeOrchPool,
      ]),
    ];
    for (const id of chain) {
      const m = store.getModel(id);
      const chk = checkCandidate(m, 'orchestrator', needs);
      if (chk.ok) {
        return { routedModel: m.id, fallbackReason: null, warnings: chk.warnings, failOpen: false };
      }
    }
    // Media-relaxed pass so Adapter omits media placeholder when no vision/pdf orchestrator exists
    if (needs.needsVision || needs.needsPdf) {
      const relaxedNeeds = { ...needs, needsVision: false, needsPdf: false };
      for (const id of chain) {
        const m = store.getModel(id);
        const chk = checkCandidate(m, 'orchestrator', relaxedNeeds);
        if (chk.ok) {
          const mediaReason = needs.needsVision && m.capVision === false ? 'needs_vision' : 'needs_pdf';
          return {
            routedModel: m.id,
            fallbackReason: mediaReason,
            warnings: [...chk.warnings, `no media-capable orchestrator; adapter will omit media on ${m.id}`],
            failOpen: false,
          };
        }
      }
    }
    return {
      routedModel: null,
      fallbackReason: 'no_valid_orchestrator',
      warnings: ['no active orchestrator model in pool; failing open'],
      failOpen: true,
    };
  }

  if (kind === 'SUBAGENT') {
    const marker = detection.marker || {};
    const role = marker.role || 'worker';
    const primaryModel = store.getModel(marker.agent);
    const primaryChk = checkCandidate(primaryModel, role, needs);
    if (primaryChk.ok) {
      return { routedModel: primaryModel.id, fallbackReason: null, warnings: primaryChk.warnings, failOpen: false };
    }

    const primaryFailure = primaryChk.reason || 'unknown_id';
    const rawChain = role === 'fixer' ? settings.fixer_chain : settings.worker_fallback_chain;
    const activeRolePool = store.listCachedModels()
      .filter(m => m.isActive && m.available && Array.isArray(m.roles) && m.roles.includes(role))
      .map(m => m.id);
    const chain = [...new Set([...(Array.isArray(rawChain) ? rawChain : []), ...activeRolePool])];

    for (const id of chain) {
      if (id === marker.agent) continue;
      const m = store.getModel(id);
      const chk = checkCandidate(m, role, needs);
      if (chk.ok) {
        return { routedModel: m.id, fallbackReason: primaryFailure, warnings: chk.warnings, failOpen: false };
      }
    }

    // If failed due to vision/pdf and no media-capable fallback exists in chain, allow base-valid target so Adapter omits media
    if (needs.needsVision || needs.needsPdf) {
      const relaxedNeeds = { ...needs, needsVision: false, needsPdf: false };
      if (primaryModel) {
        const relPrimary = checkCandidate(primaryModel, role, relaxedNeeds);
        if (relPrimary.ok) {
          return {
            routedModel: primaryModel.id,
            fallbackReason: primaryFailure,
            warnings: [...relPrimary.warnings, `no media-capable ${role} fallback; adapter will omit media on ${primaryModel.id}`],
            failOpen: false,
          };
        }
      }
      for (const id of chain) {
        const m = store.getModel(id);
        const relChk = checkCandidate(m, role, relaxedNeeds);
        if (relChk.ok) {
          return {
            routedModel: m.id,
            fallbackReason: primaryFailure,
            warnings: [...relChk.warnings, `no media-capable ${role} fallback; adapter will omit media on ${m.id}`],
            failOpen: false,
          };
        }
      }
    }

    return {
      routedModel: null,
      fallbackReason: primaryFailure,
      warnings: [`no valid fallback in ${role === 'fixer' ? 'fixer_chain' : 'worker_fallback_chain'}; failing open`],
      failOpen: true,
    };
  }

  return { routedModel: null, fallbackReason: null, warnings: [], failOpen: false };
}

module.exports = { checkCandidate, routeRequest };
