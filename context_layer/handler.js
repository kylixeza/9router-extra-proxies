'use strict';
const { CFG, PAUSE_MARKER, transport, agent, sessionDecisions, stats } = require('./config');
const { getConversationId, checkAndCleanChatConfirmation, rememberDecision, promptMacUserConfirmation, sendSyntheticAssistantReply, usageFromJson, usageFromSseTail } = require('./conversation');
const { calibrateModel } = require('./tokens');
const { shapeRequest } = require('./gating');
const { sendJson, readBody, collect, repairResponse } = require('./transport');

async function handle(req, res) {
  const p = req.url.split('?')[0];
  if (p === '/dashboard' || p === '/dashboard/' || p.startsWith('/dashboard/assets/') || p.startsWith('/api/')) {
    try { const { handleApi } = require('./dashboard'); await handleApi(req, res); } catch (e) { return sendJson(res, 500, { error: e.message }); }
    return;
  }
  if (p === '/context-health') return sendJson(res, 200, { ok: true, uptimeSec: Math.round(process.uptime()) });
  if (p === '/context-stats') return sendJson(res, 200, stats);

  // Forward GET /v1/models directly to server proxy so model discovery works
  if (req.method === 'GET' && p === '/v1/models') {
    const upstreamUrl = new URL(req.url, CFG.target);
    const headers = { ...req.headers };
    delete headers.host; delete headers.connection; delete headers['keep-alive']; delete headers['transfer-encoding'];

    const upReq = transport.request(upstreamUrl, { method: 'GET', headers, agent }, async upRes => {
      try {
        const buf = await collect(upRes);
        res.writeHead(upRes.statusCode, upRes.headers);
        res.end(buf);
      } catch (err) { sendJson(res, 502, { error: { message: err.message, type: 'context_proxy_error' } }); }
    });
    upReq.on('error', err => sendJson(res, 502, { error: { message: err.message, type: 'context_proxy_error' } }));
    return upReq.end();
  }

  stats.requests++;
  let raw;
  try { raw = await readBody(req, CFG.maxBodyBytes); }
  catch (err) { return sendJson(res, err.status || 400, { error: { message: err.message, type: 'context_proxy_error' } }); }

  const isJsonPost = req.method === 'POST' && (req.headers['content-type'] || '').includes('application/json');
  let bodyObj = null;
  let convId = null;
  let reqMeta = { model: null, isStream: false, rawPromptChars: 0, estTokens: 0, effectiveTokens: 0, msgCount: 0, budget: 0, pct: 0 };

  if (isJsonPost && raw.length) {
    try {
      bodyObj = JSON.parse(raw.toString('utf8'));
      if (bodyObj && typeof bodyObj === 'object' && !Array.isArray(bodyObj)) {
        convId = getConversationId(bodyObj, req);
        checkAndCleanChatConfirmation(bodyObj, convId);
        reqMeta = shapeRequest(bodyObj, p, convId);

        const currentDecision = sessionDecisions.get(convId);

        if (currentDecision === 'stop') {
          return sendSyntheticAssistantReply(
            res,
            bodyObj,
            `🛑 **Conversation Stopped:** This conversation exceeded ${CFG.tokenAlertThreshold.toLocaleString('en-US')} input tokens and was stopped.`
          );
        }

        if (reqMeta.effectiveTokens > CFG.tokenAlertThreshold && currentDecision !== 'continue') {
          stats.tokenAlertsTriggered++;
          const choice = await promptMacUserConfirmation(convId, reqMeta.model, reqMeta.effectiveTokens, reqMeta.msgCount);

          if (choice === 'continue') {
            rememberDecision(convId, 'continue');
            stats.conversationsContinued++;
          } else if (choice === 'stop') {
            rememberDecision(convId, 'stop');
            stats.conversationsStopped++;
            return sendSyntheticAssistantReply(
              res,
              bodyObj,
              `🛑 **Conversation Stopped:** Input context reached **${reqMeta.effectiveTokens.toLocaleString('en-US')} tokens** and you chose Stop.`
            );
          } else {
            rememberDecision(convId, 'awaiting_chat');
            return sendSyntheticAssistantReply(
              res,
              bodyObj,
              `⏸️ **Conversation Paused** ${PAUSE_MARKER}\nInput context reached **${reqMeta.effectiveTokens.toLocaleString('en-US')} tokens** (>${CFG.tokenAlertThreshold.toLocaleString('en-US')}).\n\n- Reply **continue** to proceed.\n- Reply **stop** to end.`
            );
          }
        }
      } else {
        bodyObj = null;
      }
    } catch (_) {}
  }

  const payload = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : raw;
  const headers = { ...req.headers };
  delete headers.host; delete headers.connection; delete headers['keep-alive']; delete headers['transfer-encoding'];
  headers['accept-encoding'] = 'identity';
  if (payload && payload.length) headers['content-length'] = payload.length; else delete headers['content-length'];

  const upstreamUrl = new URL(req.url, CFG.target);
  const contextHeaders = reqMeta.estTokens ? {
    'x-context-tokens-est': String(reqMeta.estTokens),
    'x-context-budget': String(reqMeta.budget),
    'x-context-utilization-pct': String(reqMeta.pct),
  } : {};
  if (convId) contextHeaders['x-conversation-id'] = convId;
  if (reqMeta.changes) {
    const c = reqMeta.changes;
    if (reqMeta.unloaded && reqMeta.unloaded.length) contextHeaders['x-context-tools-unloaded'] = reqMeta.unloaded.join(',');
    if (reqMeta.profile && reqMeta.profile !== 'default') contextHeaders['x-context-profile'] = reqMeta.profile;
    if (c.deduped || c.offloaded || c.huge || c.folded || c.toolsRemoved || c.skillsRemoved) {
      contextHeaders['x-context-changes'] = `dedup=${c.deduped};offload=${c.offloaded};huge=${c.huge};fold=${c.folded}`;
      console.log(`[context] ~${reqMeta.estTokens} tokens sent (client sent ~${reqMeta.rawTokens}); dedup=${c.deduped} offload=${c.offloaded} huge=${c.huge} fold=${c.folded} toolsRemoved=${c.toolsRemoved || 0} skillsRemoved=${c.skillsRemoved || 0} profile=${reqMeta.profile}`);
    }
    if (reqMeta.overBudget) {
      contextHeaders['x-context-over-budget'] = '1';
      console.warn(`[context] request is over budget (${reqMeta.estTokens} > ${reqMeta.budget}); nothing was deleted`);
    }
  }

  let clientGone = false;
  let upReq = null;
  res.on('close', () => { if (!res.writableEnded) { clientGone = true; if (upReq) upReq.destroy(); } });

  const handleUpstream = async upRes => {
    try {
      const ct = String(upRes.headers['content-type'] || '');
      const isSSE = ct.includes('text/event-stream');
      const buffered = !reqMeta.isStream && !isSSE && /json/.test(ct);

      if (buffered) {
        let buf = await collect(upRes);
        if (upRes.statusCode === 200) {
          if (CFG.repairToolCalls) buf = repairResponse(buf);
          try {
            const u = usageFromJson(JSON.parse(buf.toString('utf8')));
            if (u && u.prompt) calibrateModel(reqMeta.model, reqMeta.rawPromptChars, reqMeta.estTokens, u.prompt);
          } catch (_) {}
        }
        const outHeaders = { ...upRes.headers, ...contextHeaders };
        delete outHeaders['transfer-encoding']; delete outHeaders['connection'];
        outHeaders['content-length'] = buf.length;
        res.writeHead(upRes.statusCode, outHeaders);
        return res.end(buf);
      }

      let tail = '';
      upRes.on('data', c => { tail = (tail + c.toString('utf8')).slice(-16384); });
      upRes.on('end', () => {
        try {
          const u = usageFromSseTail(tail);
          if (u && u.prompt) calibrateModel(reqMeta.model, reqMeta.rawPromptChars, reqMeta.estTokens, u.prompt);
        } catch (_) {}
      });
      // If the upstream dies mid-stream, close the client connection right away so the agent fails fast instead of hanging.
      upRes.on('error', () => res.destroy());
      upRes.on('aborted', () => res.destroy());

      res.writeHead(upRes.statusCode, { ...upRes.headers, ...contextHeaders });
      if (res.flushHeaders) res.flushHeaders();
      upRes.pipe(res);
    } catch (err) {
      console.error('[context-proxy] upstream response error:', err.message);
      sendJson(res, 502, { error: { message: err.message, type: 'context_proxy_error' } });
    }
  };

  const MAX_CONNECT_RETRIES = 2;
  const attempt = n => {
    let responded = false;
    upReq = transport.request(upstreamUrl, { method: req.method, headers, agent }, upRes => { responded = true; handleUpstream(upRes); });
    upReq.on('error', err => {
      if (res.headersSent) { res.destroy(); return; }
      const resetLike = /ECONNRESET|EPIPE|socket hang up/i.test(`${err.code} ${err.message}`);
      if (!responded && !clientGone && resetLike && n < MAX_CONNECT_RETRIES) {
        console.warn(`[context-proxy] connection reset before response, retry ${n + 1}/${MAX_CONNECT_RETRIES}`);
        return void setTimeout(() => attempt(n + 1), 150 * (n + 1));
      }
      sendJson(res, 502, { error: { message: err.message, type: 'context_proxy_error' } });
    });
    upReq.end(payload || undefined);
  };
  attempt(0);
}

module.exports = { handle };
