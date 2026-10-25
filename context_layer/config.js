'use strict';
const http = require('http');
const https = require('https');
const pathMod = require('path');

const CFG = {
  target: 'http://127.0.0.1:20129',
  port: 20130,
  maxBodyBytes: 25 * 1024 * 1024,

  tokenAlertThreshold: 150000,
  dialogTimeoutSec: 90,

  // Policy: LOSSLESS FIRST. The conversation is never deleted or summarized.
  maxContextTokens: 200000,
  modelContextTokens: {},
  longContextModel: '',
  foldMessages: false,
  trimTargetRatio: 0.85,
  keepLastMessages: 14,

  dedupOldTools: true,
  dedupMinChars: 400,

  offloadOldTools: true,
  offloadStartRatio: 0.5,
  offloadMinTokens: 2500,
  offloadKeepTokens: 1200,
  recentToolWindow: 12,
  offloadStep: 10,

  hugeToolTokens: 30000,
  hugeKeepTokens: 8000,

  spillToDisk: true,
  spillDir: pathMod.join(__dirname, '..', 'spilled'),
  spillKeepFiles: 5000,
  spillMinAgeMs: 14 * 86400000,

  losslessCleanup: true,
  collapseRepeatedLines: true,
  minifyJson: false,
  normalizeLineEndings: false,

  toolGating: true,
  autoMcpGroups: true,
  alwaysLoadGroups: ['memory'],
  toolGroups: [],
  groupKeywords: {
    figma: ['design', 'screenshot', 'diagram', 'mockup', 'wireframe', 'node-id', 'frame', 'prototype'],
    github: ['pull request', 'pr', 'issue', 'repo', 'repository', 'gist', 'release', 'github actions', 'merge request'],
  },
  tellModelAboutUnloaded: true,

  instructionProfiles: true,
  dropSkillPathRx: /\/skills\/stable\//,
  keepSkillNames: ['firebase-basics', 'firebase-auth-basics', 'firebase-remote-config-basics'],
  profileText: {
    flutter: {
      persona: 'You are an expert Flutter developer assisting a user within the Android Studio IDE.',
      requests: 'You should consider every request as coming from a Flutter app developer needing help with Flutter and Dart development.',
      general: 'You are a general agent helping with development of Flutter apps and packages.',
      bestPractice: `## Flutter Best Practice
* **Expert Persona:** Interpret all requests as a Senior Flutter Developer. Prioritize idiomatic Dart, const-correct widgets, and efficient rebuilds and state management.
* **Understand the Project:** While you should adopt modern Flutter practices (Material 3, null safety, etc.), maintaining consistency with the user's existing code style and architecture is your highest priority.
* **Native code:** Android or iOS platform code (Kotlin, Gradle, platform channels) only matters when the task touches the android/ or ios/ folders.`,
    },
    hybrid: {
      persona: 'You are an expert mobile developer (Flutter/Dart and native Android/Kotlin) assisting a user within the Android Studio IDE.',
      requests: 'You should consider every request as coming from a mobile app developer working on Flutter or native Android projects; infer which one from the files involved.',
      general: 'You are a general agent helping with development of Flutter and Android apps and libraries.',
      bestPractice: `## Mobile Best Practice
* **Expert Persona:** Interpret all requests as a Senior Mobile Developer. Use idiomatic Dart in Flutter code and idiomatic Kotlin or Java in native Android code, with efficient lifecycle and state management.
* **Understand the Project:** While you should adopt modern practices for the framework in use (Flutter with Material 3, or Android with Compose and coroutines), maintaining consistency with the user's existing code style and architecture is your highest priority.`,
    },
  },

  normalize: true,
  repairToolCalls: true,
  sortTools: true,
  stripOldReasoning: false,
  injectStreamUsage: false,
  preserveUserMessages: true,
};

const PAUSE_MARKER = '[9router-context-paused]';
const targetUrl = new URL(CFG.target);
const isHttps = targetUrl.protocol === 'https:';
const transport = isHttps ? https : http;
const agent = new (isHttps ? https.Agent : http.Agent)({ keepAlive: true, maxSockets: 64 });

const modelCalibration = {};
const sessionDecisions = new Map();
const pendingDialogs = new Map();

const stats = {
  startedAt: new Date().toISOString(),
  requests: 0,
  repairedRequestTools: 0,
  repairedResponseTools: 0,
  losslessSavedTokensEst: 0,
  dedupedToolOutputs: 0,
  spilledFilesWritten: 0,
  foldedMessages: 0,
  tokenAlertsTriggered: 0,
  conversationsContinued: 0,
  conversationsStopped: 0,
  routedToLongContext: 0,
  toolsGatedOut: 0,
  skillsDropped: 0,
  offloadedToolOutputs: 0,
  hugeToolOutputs: 0,
  currentAgentContext: {
    updatedAt: null,
    conversationId: null,
    decisionStatus: 'none',
    model: null,
    messageCount: 0,
    toolCount: 0,
    toolTokensEst: 0,
    messageTokensEst: 0,
    totalInputTokensEst: 0,
    rawInputTokensEst: 0,
    lastActualPromptTokens: null,
    tokenAlertThreshold: CFG.tokenAlertThreshold,
    tokenBudget: CFG.maxContextTokens,
    utilizationPct: 0,
  },
  calibrationByModel: modelCalibration,
};

module.exports = { CFG, PAUSE_MARKER, targetUrl, isHttps, transport, agent, modelCalibration, sessionDecisions, pendingDialogs, stats };
