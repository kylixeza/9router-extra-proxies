'use strict';
const assert = require('node:assert/strict');
const { extractConversationId } = require('../conversation');

// 1. Explicit headers & body precedence
{
  assert.equal(
    extractConversationId({ 'x-conversation-id': 'explicit-hdr-1' }, { messages: [{ role: 'user', content: 'hi' }] }),
    'explicit-hdr-1'
  );
  assert.equal(
    extractConversationId({ 'X-Session-Id': 'sess-case-2' }, { input: [{ role: 'user', content: 'hi' }] }),
    'sess-case-2'
  );
  assert.equal(
    extractConversationId({ 'x-proxy-conversation-id': 'conv_proxy123' }, {}),
    'conv_proxy123'
  );
  assert.equal(
    extractConversationId({}, { conversation_id: 'body-conv-1', messages: [] }),
    'body-conv-1'
  );
  assert.equal(
    extractConversationId({}, { metadata: { session_id: 'meta-sess-1' }, input: [] }),
    'meta-sess-1'
  );
  assert.equal(
    extractConversationId({}, { prompt_cache_key: 'cache-key-9', input: [] }),
    'cache-key-9'
  );
}

// 2. Non-LLM / empty payloads return null
{
  assert.equal(extractConversationId({}, null), null);
  assert.equal(extractConversationId({}, {}), null);
  assert.equal(extractConversationId({}, { model: 'x' }), null);
  assert.equal(extractConversationId({}, { input: [], instructions: '' }), null);
  assert.equal(extractConversationId({}, { messages: [] }), null);
}

// 3. Responses API stability across turns (1 item vs 40 items)
{
  const turn1 = {
    model: 'ag/gemini-4-neon-xhigh',
    instructions: '<system_prompt>You are an Android dev.</system_prompt>',
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: '<ide-context>\nName: 9router-proxy\n</ide-context>\n\nfix conversation_id' }],
      },
    ],
  };
  const turn2 = {
    ...turn1,
    input: [
      ...turn1.input,
      { type: 'function_call', name: 'read_file', call_id: 'c1', arguments: '{}' },
      { type: 'function_call_output', call_id: 'c1', output: 'file contents...' },
      { role: 'user', content: [{ type: 'input_text', text: 'looks good, continue' }] },
    ],
  };
  const id1 = extractConversationId({}, turn1);
  const id2 = extractConversationId({}, turn2);
  assert.match(id1, /^conv_[0-9a-f]{16}$/);
  assert.equal(id1, id2, 'multi-turn Responses API conversation must keep the same ID');
}

// 4. Chat Completions stability
{
  const chat1 = {
    model: 'ag/gemini-3.8-flash-high',
    messages: [
      { role: 'developer', content: 'System prompt v1' },
      { role: 'user', content: [{ type: 'text', text: '<ide-context>\nName: wsafe-app\n</ide-context>\n\nbuild apk' }] },
    ],
  };
  const chat2 = {
    model: 'ag/gemini-3.8-flash-high',
    messages: [
      ...chat1.messages,
      { role: 'assistant', content: 'Running gradle...' },
      { role: 'user', content: 'thanks' },
    ],
  };
  const id1 = extractConversationId({}, chat1);
  const id2 = extractConversationId({}, chat2);
  assert.match(id1, /^conv_[0-9a-f]{16}$/);
  assert.equal(id1, id2, 'multi-turn Chat Completions conversation must keep the same ID');
}

// 5. Long identical <ide-context> prefix (> 600 chars) must NOT collide when user queries differ
{
  const hugeIdeContext = `<ide-context>\nActive document: /proj/app/lib/main.dart\n${'x'.repeat(3000)}\n</ide-context>`;
  const convA = {
    instructions: 'Same system prompt',
    input: [{ role: 'user', content: [{ type: 'input_text', text: `${hugeIdeContext}\n\nImplement login screen` }] }],
  };
  const convB = {
    instructions: 'Same system prompt',
    input: [{ role: 'user', content: [{ type: 'input_text', text: `${hugeIdeContext}\n\nFix crash on logout` }] }],
  };
  const idA = extractConversationId({}, convA);
  const idB = extractConversationId({}, convB);
  assert.notEqual(idA, idB, 'different user queries after </ide-context> must produce distinct IDs');
}

// 6. Different projects with identical prompt must NOT collide
{
  const bodyA = {
    instructions: 'Same system prompt',
    input: [{ role: 'user', content: [{ type: 'input_text', text: '<ide-context>\nName: app-alpha\n</ide-context>\n\nfix build' }] }],
  };
  const bodyB = {
    instructions: 'Same system prompt',
    input: [{ role: 'user', content: [{ type: 'input_text', text: '<ide-context>\nName: app-beta\n</ide-context>\n\nfix build' }] }],
  };
  assert.notEqual(extractConversationId({}, bodyA), extractConversationId({}, bodyB));
}

console.log('PASS: conversation.test.js');
