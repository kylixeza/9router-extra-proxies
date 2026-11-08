'use strict';

function replaceMediaInItems(items, pred, placeholderText) {
  let replaced = 0;
  if (!Array.isArray(items)) return 0;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') continue;
    if (pred(it)) {
      items[i] = { type: 'input_text', text: placeholderText };
      replaced++;
      continue;
    }
    if (Array.isArray(it.content)) {
      for (let j = 0; j < it.content.length; j++) {
        const part = it.content[j];
        if (part && typeof part === 'object' && pred(part)) {
          it.content[j] = { type: 'input_text', text: placeholderText };
          replaced++;
        }
      }
    }
  }
  return replaced;
}

const isImagePart = p => p.type === 'input_image' || p.type === 'image_url';
const isPdfOrFilePart = p => p.type === 'input_file'
  || (typeof p.mime_type === 'string' && p.mime_type.includes('pdf'))
  || (typeof p.filename === 'string' && /\.pdf$/i.test(p.filename));

function adaptRequest(body, targetModel, settings = {}) {
  if (!targetModel || !body || typeof body !== 'object') {
    return { changed: false, bodyMutated: false, changes: [], headers: {}, skippedReason: null };
  }

  // Defensive fail-open when previous_response_id is used (stateful response continuation)
  if (body.previous_response_id) {
    return {
      changed: false,
      bodyMutated: false,
      changes: ['skipped:previous_response_id'],
      headers: {},
      skippedReason: 'previous_response_id',
    };
  }

  const changes = [];
  let bodyMutated = false;

  const maxLimit = typeof targetModel.maxOutput === 'number'
    ? targetModel.maxOutput
    : (typeof targetModel.maxCompletionTokens === 'number' ? targetModel.maxCompletionTokens : null);
  if (typeof body.max_output_tokens === 'number' && maxLimit !== null && body.max_output_tokens > maxLimit) {
    body.max_output_tokens = maxLimit;
    changes.push('clamped_max_output_tokens');
    bodyMutated = true;
  }

  if (targetModel.capReasoning === false && body.reasoning !== undefined) {
    delete body.reasoning;
    changes.push('deleted_reasoning');
    bodyMutated = true;
  } else if (
    targetModel.thinkingEffortSupported === false
    && body.reasoning
    && typeof body.reasoning === 'object'
    && Object.prototype.hasOwnProperty.call(body.reasoning, 'effort')
  ) {
    delete body.reasoning.effort;
    changes.push('deleted_reasoning_effort');
    bodyMutated = true;
  }

  if (targetModel.capVision === false && Array.isArray(body.input)) {
    const n = replaceMediaInItems(body.input, isImagePart, '[image omitted]');
    if (n > 0) {
      changes.push('omitted_input_image');
      bodyMutated = true;
    }
  }

  if (targetModel.capPdf === false && Array.isArray(body.input)) {
    const n = replaceMediaInItems(body.input, isPdfOrFilePart, '[file omitted]');
    if (n > 0) {
      changes.push('omitted_input_file');
      bodyMutated = true;
    }
  }

  const headers = { 'x-orch-model': targetModel.id };
  const ctxWin = targetModel.contextWindow || targetModel.contextLength;
  if (typeof ctxWin === 'number' && ctxWin > 0) {
    headers['x-orch-model-context'] = String(ctxWin);
  }

  if (settings.rewrite_mode === 'header') {
    changes.push('header_only_mode');
  } else {
    if (body.model !== targetModel.id) {
      body.model = targetModel.id;
      bodyMutated = true;
    }
    changes.push('rewrote_body_model');
  }

  return {
    changed: changes.length > 0,
    bodyMutated,
    changes,
    headers,
    skippedReason: null,
  };
}

module.exports = { adaptRequest };
