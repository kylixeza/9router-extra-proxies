'use strict';
// ponytail: PG tables + in-memory cache. Hot path stays sync; PG writes fire-and-forget.
// Standalone (no require of gating.js) to avoid circular deps.
//
// Schema (one-to-many):
//   mcp_providers (name PK) -> mcp_items (provider FK)         : one provider has many items
//   mcp_providers (name PK) -> mcp_provider_keywords (provider FK) : one provider has many keywords
//   skills (name PK)        -> skill_keywords (skill FK)        : one skill has many keywords

// ponytail: hash-only sync token; slash cmds get intercepted by skill router.
const INDEX_CMD_RX = /(?:#9r-sync|#9router-sync|index\s+9router\s+proxy)/i;
const stripIndexCmd = t => String(t || '').replace(INDEX_CMD_RX, ' ');

const STOP = new Set(['com', 'org', 'io', 'net', 'mcp', 'server', 'app', 'the', 'and', 'with', 'from', 'stable']);
const esc = x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// providers: name -> { name, keywords:Set, items:Set(toolName) }
// skills: name -> { name, path, description, keywords:Set }
const providers = new Map();
const skills = new Map();
// keyword(lower) -> Set(providerName)
const kwToProviders = new Map();
// keyword(lower) -> Set(skillName)
const kwToSkills = new Map();

function toks(s) {
  return String(s || '').toLowerCase().split(/[^a-z0-9]+/g).filter(w => w.length > 2 && !STOP.has(w));
}

// Curated keywords (user-supplied). Exact match lists; no auto-derived noise.
const MCP_KEYWORDS = {
  figma: ['figma', 'ui design', 'ui mockup', 'mockup', 'wireframe', 'node-id', 'design file', 'design spec', 'from the design'],
  github: ['issue', 'gist', 'github actions', 'workflow run', 'pr #', 'pull request #', 'my prs', 'open prs', 'review pr', 'review the pr', 'merge pr', 'create pr', 'create a pr', 'create a pull request', 'open a pull request', 'merge request'],
};

const SKILL_KEYWORDS = {
  'write-pr': ['pull request', 'pr', 'pr title', 'pr description', 'merge request'],
  'commit-strategy': ['commit', 'commits', 'commit message', 'staged', 'unstaged', 'atomic commit'],
  'tdd': ['tdd', 'test-driven', 'test driven', 'red-green', 'red green', 'tests first', 'failing test first', 'integration test'],
  'retro': ['retro', 'retrospective'],
  'teach': ['teach me', 'teach us'],
  'triage': ['triage', 'label issues', 'incoming issues'],
  'wizard': ['wizard', 'provision', 'ci secrets', 'cutover', 'credentials setup'],
  'archify': ['architecture diagram', 'sequence diagram', 'data-flow diagram', 'data flow diagram', 'state diagram', 'lifecycle diagram', 'workflow diagram', 'flowchart', 'archify'],
  'handoff': ['handoff', 'hand off', 'another agent', 'new chat'],
  'loop-me': ['loop me', 'grill me about specs'],
  'to-spec': ['to-spec', 'to spec', 'write a spec', 'turn this into a spec', 'publish the spec'],
  'ask-matt': ['which skill', 'what skill', 'skill should i use'],
  'graphify': ['graphify', 'knowledge graph', 'codebase architecture', 'file relationships', 'god nodes'],
  'grill-me': ['grill me', 'interview me', 'stress-test my plan', 'stress test my plan'],
  'grilling': ['grill', 'grilling', 'stress-test', 'stress test'],
  'ponytail': ['ponytail', 'lazy senior', 'over-engineering', 'overengineering', 'ladder of logic'],
  'research': ['research', 'investigate', 'primary sources', 'look into'],
  'implement': ['implement the spec', 'implement the tickets', 'implement this ticket', 'implement the plan'],
  'prototype': ['prototype', 'throwaway', 'spike'],
  'wait-what': ['wait what', 'did not land', "didn't land", 're-pitch'],
  'wayfinder': ['wayfinder', 'decision tickets', 'huge chunk of work'],
  'to-tickets': ['to-tickets', 'to tickets', 'break into tickets', 'create tickets', 'split into tickets', 'tracer bullet', 'tracer-bullet'],
  'code-review': ['code review', 'review my changes', 'review the changes', 'review this branch', 'review the diff', 'review since'],
  'writing-beats': ['writing beats', 'journey of beats'],
  'writing-shape': ['shape into an article', 'writing shape'],
  'claude-handoff': ['background agent', 'fresh agent'],
  'implement-spec': ['implement the specification', 'implement this spec', 'implement spec'],
  'codebase-design': ['deep module', 'deep modules', 'module interface', 'seam', 'deepening', 'more testable', 'codebase design'],
  'diagnosing-bugs': ['diagnose', 'debug', 'bug', 'broken', 'error', 'exception', 'crash', 'failing', 'failed', 'throwing', 'slow', 'regression', 'not working', 'stack trace'],
  'domain-modeling': ['domain model', 'domain modeling', 'context.md', 'adr', 'glossary', 'terminology'],
  'grill-with-docs': ['grill with docs', 'create an adr'],
  'setup-pre-commit': ['pre-commit', 'husky', 'lint-staged', 'commit hook'],
  'to-questionnaire': ['questionnaire'],
  'writing-fragments': ['raw fragments', 'writing fragments'],
  'scaffold-exercises': ['scaffold exercises', 'exercise stubs', 'exercise directory', 'course section'],
  'writing-for-agents': ['agents.md', 'claude.md', 'writing for agents', 'write a skill', 'edit a skill', 'create a skill', 'skill.md'],
  'migrate-to-shoehorn': ['shoehorn', 'partial test data'],
  'setup-ts-deep-modules': ['dependency-cruiser', 'deep modules typescript'],
  'setup-matt-pocock-skills': ['matt pocock', 'engineering skills', 'triage label'],
  'resolving-merge-conflicts': ['merge conflict', 'merge conflicts', 'rebase conflict', 'conflict markers', 'resolve conflict', 'resolve the conflict'],
  'git-guardrails-claude-code': ['git guardrails', 'dangerous git', 'git hooks', 'claude code hooks'],
  'improve-codebase-architecture': ['improve the architecture', 'improve architecture', 'architecture review', 'deepening opportunities', 'architecture report'],
  'leanback-to-compose-tv-migration': ['leanback', 'android tv', 'androidx.tv', 'tv app'],
  'display-glasses-with-jetpack-compose-glimmer': ['glimmer', 'xr glasses', 'display glasses', 'android xr'],
  'play-policy-insights': ['play policy', 'play store policy', 'data safety', 'compliance report'],
  'engage-sdk-integration': ['engage sdk', 'play engage'],
  'play-billing-library-version-upgrade': ['play billing', 'billing library', 'billingclient', 'pbl'],
  'wear-compose-m3': ['wear os', 'wearos', 'wear compose', 'watch app', 'androidx.wear'],
  'media3-cast-integration': ['cast', 'chromecast', 'castplayer', 'google cast'],
  'camerax': ['camerax', 'camera'],
  'edge-to-edge': ['edge-to-edge', 'edge to edge', 'insets', 'status bar', 'navigation bar', 'system bar'],
  'testing-setup': ['testing strategy', 'test infrastructure', 'screenshot tests', 'testing libraries', 'espresso'],
  'android-cli': ['android cli', 'avd', 'emulator', 'sdk manager'],
  'firebase-basics': ['firebase', 'google-services.json', 'googleservice-info'],
  'firebase-auth-basics': ['firebase auth', 'firebase authentication', 'sign-in', 'sign in', 'auth rules'],
  'firebase-remote-config-basics': ['remote config', 'feature flag', 'feature flags'],
  'verified-email': ['verified email', 'credential manager', 'email verification'],
  'restore-credentials': ['restore credentials', 'restore keys', 'androidx.credentials'],
  'android-intent-security': ['intent security', 'intent redirection', 'exported', 'androidmanifest', 'intent filter'],
  'appfunctions': ['appfunctions', 'app functions', 'appfunction'],
  'ml-kit-genai-prompt-api': ['ml kit', 'genai', 'gemini nano', 'prompt api'],
  'android-profiler': ['profiler', 'profiling', 'heap dump', 'memory leak', 'jank', 'startup time', 'bottleneck', 'method trace'],
  'navigation-3': ['navigation 3', 'nav3', 'navigation3', 'back stack', 'backstack', 'list-detail', 'deep link'],
  'navigation-event': ['predictive back', 'navigationevent', 'backhandler', 'back gesture'],
  'r8-analyzer': ['r8', 'proguard', 'keep rules', 'minify', 'obfuscat'],
  'agp-9-upgrade': ['agp 9', 'agp9', 'android gradle plugin', 'upgrade agp'],
  'styles': ['compose styles', 'styles api', 'styleable'],
  'adaptive': ['adaptive', 'foldable', 'tablet', 'window size', 'large screen', 'mediaquery'],
  'migrate-xml-views-to-jetpack-compose': ['xml view', 'xml layout', 'migrate to compose', 'migrate xml', 'views to compose'],
};

const PROVIDER_STOP = new Set(['mcp', 'server', 'com', 'org', 'io', 'net', 'app']);

function cleanParts(raw) {
  const parts = String(raw || '').toLowerCase().split(/_+/).filter(p => p.length > 1 && !PROVIDER_STOP.has(p));
  return [...new Set(parts)];
}

// Raw MCP group (e.g. "com_figma_mcp_mcp") or full tool name -> provider context.
// Non-MCP tools -> "ide".
function groupToProvider(g) {
  if (!g) return 'ide';
  const m = /^mcp__(.+?)__/.exec(g);
  const raw = m ? m[1] : g;
  // Tool name passed directly? Extract middle first.
  const parts = cleanParts(raw);
  if (!parts.length) return String(raw).toLowerCase().slice(0, 64) || 'ide';
  const KNOWN = ['figma', 'github', 'memory', 'firebase', 'camerax', 'testing', 'navigation', 'billing', 'wear', 'tv', 'xr', 'cast', 'profiler'];
  for (const k of KNOWN) if (parts.includes(k)) return k;
  // "others based on the name": first meaningful token wins (figma/github style grouping).
  // ponytail: coarse grouping keeps provider count low; split later if a provider grows too big.
  return parts[0];
}

function providerOfToolName(name) {
  const m = /^mcp__(.+?)__/.exec(name || '');
  if (!m) return 'ide';
  return groupToProvider(m[1]);
}

function keywordsForProvider(p) {
  const list = MCP_KEYWORDS[p];
  if (list) return list.map(k => String(k).toLowerCase());
  // Unknown provider (incl. ide/memory): provider name itself as keyword.
  // ponytail: no auto-derived noise; add curated list when provider proves useful.
  return [String(p).toLowerCase()];
}

function keywordsForSkillName(name) {
  const list = SKILL_KEYWORDS[name];
  if (list) return list.map(k => String(k).toLowerCase());
  return [String(name || '').toLowerCase().replace(/[-_]+/g, ' ').trim()];
}

const SKILL_DESCRIPTIONS = {
  'tdd': 'Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.',
  'retro': 'Conduct a retrospective on a coding session.',
  'teach': 'Teach the user a new skill or concept, within this workspace.',
  'triage': 'Move issues and external PRs through a state machine of triage roles, categorise, verify, grill if needed, and write agent-ready briefs.',
  'wizard': "Generate an interactive bash wizard that walks a human through steps only they can perform. Use when provisioning infrastructure, setting up credentials or CI secrets, walking an unfamiliar third-party dashboard, or running a one-off migration or cutover. Don't invoke this for steps the agent can perform itself.",
  'archify': 'Create polished, validated architecture, workflow, sequence, data-flow, and lifecycle/state diagrams as explorable standalone HTML with inline SVG, dark/light themes, optional trace motion, and PNG/JPEG/WebP/SVG/WebM export. Accept plain-language requirements or pasted Mermaid flowchart, sequenceDiagram, and stateDiagram input; inspect repository evidence when the diagram must reflect real code. Use when the user asks to visualize system architecture, infrastructure/cloud/security/network topology, technical workflows, API call sequences, request lifecycles, data pipelines, ETL/ELT, data lineage, state machines, or to convert/beautify Mermaid.',
  'handoff': 'Compact the current conversation into a handoff document for another agent to pick up.',
  'loop-me': 'Grill me about specs for the workflows I want to build, within this workspace.',
  'to-spec': "Turn the current conversation into a spec and publish it to the project issue tracker: no interview, just synthesis of what you've already discussed.",
  'ask-matt': 'Ask which skill or flow fits your situation. A router over the skills in this repo.',
  'graphify': 'Use for any question about a codebase, its architecture, file relationships, or project content \u2014 especially when graphify-out/ exists, where the question should be treated as a graphify query first. Turns any input (code, docs, papers, images, videos) into a persistent knowledge graph with god nodes, community detection, and query/path/explain tools.',
  'grill-me': 'A relentless interview to sharpen a plan or design.',
  'grilling': "Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.",
  'ponytail': "Forces the agent to adopt the philosophy of a 'lazy senior developer' - minimizing code, reusing existing logic, and avoiding over-engineering using the 'Ladder of Logic'.",
  'research': 'Investigate a question against high-trust primary sources and capture the findings as a Markdown file in the repo. Use when the user wants a topic researched, docs or API facts gathered, or reading legwork delegated to a background agent.',
  'implement': 'Implement a piece of work based on a spec or set of tickets.',
  'prototype': 'Build a throwaway prototype to answer a design question. Use when the user wants to sanity-check whether a state model or logic feels right, or explore what a UI should look like.',
  'wait-what': 'Stop. That last message did not land: re-pitch it.',
  'wayfinder': 'Plan a huge chunk of work (more than one agent session can hold) as a shared map of decision tickets on your issue tracker, and resolve them one at a time until the way to the destination is clear.',
  'to-tickets': 'Break a plan, spec, or the current conversation into a set of tracer-bullet tickets, each declaring its blocking edges, published to the configured tracker (edges as text in one file per ticket locally, or native blocking links on a real tracker).',
  'code-review': 'Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards (does the code follow this repo\'s documented coding standards?) and Spec (does the code match what the originating issue/spec asked for?). Runs both reviews in parallel sub-agents and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X".',
  'writing-beats': 'Writing, exploit; assemble raw material into a journey of beats, grounding each term before a beat leans on it.',
  'writing-shape': 'Writing, exploit: shape raw material into an article, paragraph by paragraph.',
  'claude-handoff': 'Hand the current conversation off to a fresh background agent that picks up the work immediately.',
  'implement-spec': 'Implement a specification in code.',
  'codebase-design': "Shared vocabulary for designing deep modules. Use when the user wants to design or improve a module's interface, find deepening opportunities, decide where a seam goes, make code more testable or AI-navigable, or when another skill needs the deep-module vocabulary.",
  'diagnosing-bugs': 'Diagnosis loop for hard bugs and performance regressions. Use when the user says "diagnose"/"debug this", or reports something broken/throwing/failing/slow.',
  'domain-modeling': "Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a CONTEXT.md, or recording or editing an ADR.",
  'grill-with-docs': "A relentless interview to sharpen a plan or design, which also creates docs (ADR's and glossary) as we go.",
  'setup-pre-commit': 'Set up Husky pre-commit hooks with lint-staged (Prettier), type checking, and tests in the current repo. Use when user wants to add pre-commit hooks, set up Husky, configure lint-staged, or add commit-time formatting/typechecking/testing.',
  'to-questionnaire': "Turn a decision you can't fully answer into a questionnaire for someone else to fill in.",
  'writing-fragments': 'Writing, explore: mine raw fragments, no structure yet.',
  'scaffold-exercises': 'Create exercise directory structures with sections, problems, solutions, and explainers that pass linting. Use when user wants to scaffold exercises, create exercise stubs, or set up a new course section.',
  'writing-for-agents': 'Writing documents for agents. Use when creating or editing skills, or modifying AGENTS.md or CLAUDE.md.',
  'migrate-to-shoehorn': 'Migrate test files from `as` type assertions to @total-typescript/shoehorn. Use when user mentions shoehorn, wants to replace `as` in tests, or needs partial test data.',
  'setup-ts-deep-modules': 'Wire dependency-cruiser into a TypeScript repo so each package is a deep module, with implementation hidden in subfolders and reachable only through its entry-point files. User-invoked.',
  'setup-matt-pocock-skills': 'Configure this repo for the engineering skills: set up its issue tracker, triage label vocabulary, and domain doc layout. Run once before first use of the other engineering skills.',
  'resolving-merge-conflicts': 'Use when you need to resolve an in-progress git merge/rebase conflict.',
  'git-guardrails-claude-code': 'Set up Claude Code hooks to block dangerous git commands (push, reset --hard, clean, branch -D, etc.) before they execute. Use when user wants to prevent destructive git operations, add git safety hooks, or block git push/reset in Claude Code.',
  'improve-codebase-architecture': 'Scan a codebase for deepening opportunities, present them as a visual HTML report, then grill through whichever one you pick.',
  'leanback-to-compose-tv-migration': 'Provides instructions and architectural patterns for migrating Android TV applications from legacy Leanback UI Toolkit, Android Views, or Support Fragments to Jetpack Compose for TV (androidx.tv). Use this skill for Leanback to Compose migrations, including browse screen, settings screen, authentication screen, login screen, or video playback screen migrations, or when replacing BrowseSupportFragment, LeanbackSettingsFragment, PreferenceFragment, BaseLeanbackPreferenceFragmentCompat, VideoSupportFragment, GuidedStepSupportFragment, SearchSupportFragment, VerticalGridSupportFragment, Presenter, ArrayObjectAdapter, or CursorMapper with modern Compose equivalents, implementing immersive carousels with focus memory, Media3 video playback with PlayerSurface, or custom 10-foot hero layouts.',
  'display-glasses-with-jetpack-compose-glimmer': 'Provides guidelines for developing projected Android XR apps for display glasses using the Jetpack Compose Glimmer UI toolkit. This skill covers foundational Glimmer design principles, workflows for implementing Jetpack Compose Glimmer, and interaction models for the glasses form factor. Use this skill to build an Android XR Augmented Experience app with Jetpack Compose Glimmer that adheres to the Glimmer design system for optimized glasses styling.',
  'play-policy-insights': 'Automated auditor designed to verify Android applications against Google Play Policy domains. It cross-references static code analysis with Play Store declarations to generate deterministic compliance reports, identifying undeclared data collection, architectural risks, and missing disclosures across Permissions and APIs Hygiene, User Account and Identity, and Data Safety and Privacy domains.',
  'engage-sdk-integration': 'Helps developers integrate, debug, and resolve Play Engage SDK implementation issues. Use when adding Engage SDK support, generating publishing code, mapping data classes to entities, or fixing SDK-related errors.',
  'play-billing-library-version-upgrade': 'Use this skill when upgrading or migrating an Android project from any legacy Google Play Billing Library (PBL) version to the latest stable version of PBL.',
  'wear-compose-m3': 'Expert guidance for working with Wear OS Compose Material3. Use when creating, updating, or migrating Wear OS projects. This includes the androidx.wear.compose.material3, androidx.wear.compose.foundation, and androidx.wear.compose.navigation3 libraries. Also working with core components such as AppScaffold, ScreenScaffold, and TransformingLazyColumn, and core Wear OS concepts such as ambient mode. Migration from lower versions such as Material 2.5 and Horologist.',
  'media3-cast-integration': 'Implements Google Cast support in Android apps using Jetpack Media3. Handles adding build dependencies, updating manifest, configuring OptionsProvider, and managing CastPlayer or RemoteCastPlayer for playback in both Compose and View-based UIs. Use when adding Cast functionality or migrating from legacy Cast SDK to Media3 Cast.',
  'camerax': 'Provide technical guidance for Android camera development with CameraX. Use when implementing camera features, handling asynchronous recording lifecycles, wiring low-level hardware interop using CameraX, or integrating ML Kit or Media3 effects.',
  'edge-to-edge': 'Use this skill to migrate your Jetpack Compose app to add adaptive edge-to-edge support and troubleshoot common issues. Use this skill to fix UI components (like buttons or lists) that are obscured by or overlapping with the navigation bar or status bar, fix IME insets, and fix system bar legibility.',
  'testing-setup': 'Analyze and create a testing strategy for native Android apps - install testing libraries, set up test infrastructure, create harnesses for unit tests, UI tests, screenshot tests, and end-to-end tests.',
  'android-cli': 'Provides instructions for installing and using the `android` CLI. The `android` command-line tool is a critical tool for Android development and helps you create new Android projects, run Android apps on devices, manage and interact with Android virtual devices (including screenshots and UI inspection), manage Android SDK components, look up official Android documentation, and discover and install official Android skills.',
  'firebase-basics': "Provides foundational setup, authentication, and project management workflows for Firebase using the Firebase CLI. Use when checking Firebase CLI version (must use 'npx -y firebase-tools@latest --version'), initializing a Firebase environment, authenticating, setting active projects, or setting up `google-services.json` or `GoogleService-Info.plist` files.",
  'firebase-auth-basics': "Guide for setting up and using Firebase Authentication. Use this skill when the user's app requires user sign-in, user management, or secure data access using auth rules.",
  'firebase-remote-config-basics': 'Comprehensive guide for Firebase Remote Config, including template management and SDK usage. Use this skill when the user needs help setting up Remote Config, managing feature flags, or updating app behavior dynamically.',
  'verified-email': 'Provides a complete workflow for implementing verified email retrieval on Android Credential Manager API. Use this skill to integrate a secure, OTP-less email verification flow into an Android app. This skill solves the problem of high-friction sign-up processes by leveraging cryptographically verified credentials from trusted providers like Google.',
  'restore-credentials': "Provides knowledge and workflows to implement Android's Restore Credentials feature using the androidx.credentials library. Use this skill to create, sign in with, and delete restore keys, enabling silent user sign-in on new devices after a restore. It covers version compatibility, dependencies, server-side prerequisites, and the complete client-side implementation for creating, retrieving, and clearing restore keys.",
  'android-intent-security': 'Best practices for Android Intent security. Use this skill when auditing component configurations in AndroidManifest.xml activities, services, receivers) or source code handling incoming Intents (getIntent, getParcelableExtra) to prevent Intent Redirection and unauthorized access.',
  'appfunctions': 'Analyzes Android apps to identify key user workflows for AppFunctions such as creating a note, playing media, or sending an automated or AI agent triggered message, voice commands, or system shortcuts, without needing to open the app UI. Generates Kotlin code to expose these workflows to the Android system, allowing agents to discover and execute them on-device. Also refines KDoc documentation to ensure AI agents correctly understand and use the provided functionality.',
  'ml-kit-genai-prompt-api': 'Analyzes Android codebases to implement ML Kit GenAI Prompt API. Use this skill to send natural language requests on-device to Gemini Nano, use structured output with Prompt API, implement prefix caching, optimize the current prompt, or apply best practices.',
  'android-profiler': 'Manages Android performance profiling and debugging. Triggers when the user asks to record or analyze Android performance data, such as system traces, heap dumps, method recordings, callstack samples, memory allocations, or investigate bottlenecks, jank, memory leaks, and app startup issues on Android, or when the user asks to write, debug, or execute ad-hoc SQL queries. Applies to both user and system apps or services.',
  'navigation-3': 'Learn how to install and migrate to Jetpack Navigation 3, and how to implement features and patterns such as deep links, multiple backstacks, scenes (dialogs, bottom sheets, list-detail, two-pane, supporting pane), conditional navigation (such as logged-in navigation versus anonymous), returning results from flows, integration with Hilt, ViewModel, Kotlin, and view interoperability.',
  'navigation-event': 'Intercept back gestures and run Predictive Back animations using the NavigationEvent (androidx.navigationevent) library in Compose Android. Handles Activity setup, parent-child dispatcher scoping in `ViewPagers` or tabs, Compose `NavigationBackHandler`, and migration from legacy `BackHandler` on SDK 36+.',
  'r8-analyzer': "Analyzes Android build files and R8 keep rules to identify redundancies, broad package-wide rules, and rules that subsume library consumer keep rules. Use when developers want to optimize their app's size, remove redundant or overly broad keep rules, or troubleshoot Proguard configurations.",
  'agp-9-upgrade': 'Upgrades, or migrates, an Android project to use Android Gradle Plugin (AGP) version 9. Do not use this skill for migrating Kotlin Multiplatform (KMP) projects.',
  'styles': 'Use this skill to integrate the Jetpack Compose Styles API into an Android project. This skill guides you through upgrading dependencies, setting up component themes, making custom components styleable, and migrating existing layout properties to use unified styles. Migrate custom design system components, replace hard coded parameters with Style attributes, and use Modifier.styleable for interaction states.',
  'adaptive': "Instructions to make or update an app's UI so that it adapts to different Android devices including phones, tablets, foldables, laptops, desktop, TV, Auto and XR. It includes how to handle different window sizes, pointing devices (such as mouse) and text entry devices (such as keyboard) using the Compose MediaQuery API. It also covers multi-pane layouts using Navigation3 Scenes, adaptive UI components (such as buttons) with varying target sizes, and adaptive layouts (including navigation areas - nav rails and nav bars) using the Compose Grid and FlexBox APIs.",
  'migrate-xml-views-to-jetpack-compose': 'Provides a structured workflow for migrating an Android XML View to Jetpack Compose. This skill details the step-by-step process, from planning and dependency setup, to theming and layout migration, validation and XML cleanup. Use this skill when you need to migrate an XML View to Jetpack Compose in an Android project. It solves the problem of converting the UI of a legacy XML View into modern, declarative Compose components while maintaining interoperability.',
};

function descriptionForSkill(name) {
  return SKILL_DESCRIPTIONS[name] || '';
}

function parseSkills(text) {
  const out = [];
  if (!text) return out;
  const rx = /<skill>[\s\S]*?<\/skill>\s*/gi;
  let m;
  while ((m = rx.exec(text))) {
    const entry = m[0];
    const name = ((entry.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '').trim();
    if (!name) continue;
    const path = ((entry.match(/<path>([\s\S]*?)<\/path>/) || [])[1] || '').trim();
    const desc = ((entry.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '').trim();
    out.push({ name, path, description: desc || descriptionForSkill(name) });
  }
  return out;
}

// ponytail: full <skill> blocks for keep-set, shared by gating applyDbInstructions.
function extractSkillBlocks(text, keepSet) {
  if (!text || !keepSet || !keepSet.size) return '';
  const blocks = [];
  const rx = /<skill>\s*<name>[\s\S]*?<\/skill>\s*/gi;
  let m;
  while ((m = rx.exec(text))) {
    const entry = m[0];
    const name = ((entry.match(/<name>([\s\S]*?)<\/name>/) || [])[1] || '').trim();
    if (keepSet.has(name)) blocks.push(entry.trim());
  }
  return blocks.join('\n\n');
}

function linkKw(map, kw, id) {
  if (!map.has(kw)) map.set(kw, new Set());
  map.get(kw).add(id);
}

function unlinkKw(map, kw, id) {
  const s = map.get(kw);
  if (s) { s.delete(id); if (!s.size) map.delete(kw); }
}

function rememberProvider(name, toolName, keywords) {
  let p = providers.get(name);
  if (!p) { p = { name, keywords: new Set(), items: new Set() }; providers.set(name, p); }
  p.items.add(toolName);
  for (const k of keywords) {
    if (!p.keywords.has(k)) { p.keywords.add(k); linkKw(kwToProviders, k, name); }
  }
}

function rememberSkill(name, path, keywords, description) {
  const old = skills.get(name);
  if (old) for (const k of old.keywords) unlinkKw(kwToSkills, k, name);
  const desc = (description !== undefined && description !== null)
    ? String(description || '')
    : (old && old.description) || descriptionForSkill(name);
  const s = { name, path: path ?? (old ? old.path : null), description: desc || '', keywords: new Set(keywords) };
  skills.set(name, s);
  for (const k of keywords) linkKw(kwToSkills, k, name);
}

function store() { try { return require('../storage_layer'); } catch (_) { return null; } }

async function ensureSchema() {
  const s = store();
  if (!s || !s.isEnabled()) return;
  await s.query(`CREATE TABLE IF NOT EXISTS mcp_providers (
    name TEXT PRIMARY KEY, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await s.query(`CREATE TABLE IF NOT EXISTS mcp_items (
    name TEXT PRIMARY KEY, provider TEXT NOT NULL REFERENCES mcp_providers(name) ON DELETE CASCADE,
    description TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await s.query(`CREATE TABLE IF NOT EXISTS mcp_provider_keywords (
    provider TEXT NOT NULL REFERENCES mcp_providers(name) ON DELETE CASCADE,
    keyword TEXT NOT NULL, PRIMARY KEY (provider, keyword))`);
  await s.query(`CREATE INDEX IF NOT EXISTS idx_mprov_kw ON mcp_provider_keywords (keyword)`);
  await s.query(`CREATE TABLE IF NOT EXISTS skills (
    name TEXT PRIMARY KEY, path TEXT, description TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await s.query(`ALTER TABLE skills ADD COLUMN IF NOT EXISTS description TEXT`);
  await s.query(`ALTER TABLE skills ADD COLUMN IF NOT EXISTS path TEXT`);
  await s.query(`CREATE TABLE IF NOT EXISTS skill_keywords (
    skill TEXT NOT NULL REFERENCES skills(name) ON DELETE CASCADE,
    keyword TEXT NOT NULL, PRIMARY KEY (skill, keyword))`);
  await s.query(`CREATE INDEX IF NOT EXISTS idx_skill_kw ON skill_keywords (keyword)`);
}

async function loadFromDb() {
  const s = store();
  if (!s || !s.isEnabled()) return;
  try {
    await ensureSchema();
    const pr = await s.query(`SELECT name FROM mcp_providers`);
    if (pr) for (const r of pr.rows) if (!providers.has(r.name)) providers.set(r.name, { name: r.name, keywords: new Set(), items: new Set() });
    const it = await s.query(`SELECT name, provider FROM mcp_items`);
    if (it) for (const r of it.rows) {
      let p = providers.get(r.provider);
      if (!p) { p = { name: r.provider, keywords: new Set(), items: new Set() }; providers.set(r.provider, p); }
      p.items.add(r.name);
    }
    const pk = await s.query(`SELECT provider, keyword FROM mcp_provider_keywords`);
    if (pk) for (const r of pk.rows) {
      let p = providers.get(r.provider);
      if (!p) { p = { name: r.provider, keywords: new Set(), items: new Set() }; providers.set(r.provider, p); }
      const k = String(r.keyword).toLowerCase();
      p.keywords.add(k); linkKw(kwToProviders, k, r.provider);
    }
    let sk = null;
    try { sk = await s.query(`SELECT name, path, description FROM skills`); }
    catch (_) { sk = await s.query(`SELECT name, path FROM skills`); }
    if (sk) for (const r of sk.rows) if (!skills.has(r.name)) skills.set(r.name, { name: r.name, path: r.path, description: r.description || descriptionForSkill(r.name), keywords: new Set() });
    else for (const [n, sn] of skills) if (!sn.description) sn.description = descriptionForSkill(n);
    const skk = await s.query(`SELECT skill, keyword FROM skill_keywords`);
    if (skk) for (const r of skk.rows) {
      let sn = skills.get(r.skill);
      if (!sn) { sn = { name: r.skill, path: null, description: descriptionForSkill(r.skill), keywords: new Set() }; skills.set(r.skill, sn); }
      const k = String(r.keyword).toLowerCase();
      sn.keywords.add(k); linkKw(kwToSkills, k, r.skill);
    }
  } catch (e) { console.error('[tool-index] load failed:', e.message); }
}

function persistProvider(name, toolEntries) {
  const s = store();
  if (!s || !s.isEnabled()) return;
  const p = providers.get(name);
  if (!p) return;
  const kws = [...p.keywords];
  (async () => {
    try {
      await s.query(`INSERT INTO mcp_providers (name) VALUES ($1)
        ON CONFLICT (name) DO UPDATE SET updated_at=now()`, [name]);
      for (const t of toolEntries) {
        await s.query(`INSERT INTO mcp_items (name, provider, description) VALUES ($1,$2,$3)
          ON CONFLICT (name) DO UPDATE SET provider=EXCLUDED.provider,
          description=EXCLUDED.description, updated_at=now()`,
          [t.name, name, (t.desc || '').slice(0, 2000) || null]);
      }
      await s.query(`DELETE FROM mcp_provider_keywords WHERE provider=$1`, [name]);
      for (const k of kws) await s.query(
        `INSERT INTO mcp_provider_keywords (provider, keyword) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [name, k]);
    } catch (e) { console.error('[tool-index] persist provider failed:', e.message); }
  })();
}

function persistSkill(name, path, description) {
  const s = store();
  if (!s || !s.isEnabled()) return;
  const sn = skills.get(name);
  if (!sn) return;
  const kws = [...sn.keywords];
  const desc = description !== undefined ? description : sn.description || '';
  (async () => {
    try {
      await s.query(`ALTER TABLE skills ADD COLUMN IF NOT EXISTS description TEXT`);
      await s.query(`INSERT INTO skills (name, path, description) VALUES ($1,$2,$3)
        ON CONFLICT (name) DO UPDATE SET path=EXCLUDED.path, description=EXCLUDED.description, updated_at=now()`, [name, path || null, desc || null]);
      await s.query(`DELETE FROM skill_keywords WHERE skill=$1`, [name]);
      for (const k of kws) await s.query(
        `INSERT INTO skill_keywords (skill, keyword) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [name, k]);
    } catch (e) { console.error('[tool-index] persist skill failed:', e.message); }
  })();
}

// Index full request without filtering. Upserts providers+items+skills. One -> many keywords.
function indexCurrentRequest(body, instructionText) {
  let nTools = 0, nSkills = 0;
  const byProvider = new Map();
  if (Array.isArray(body.tools)) {
    for (const t of body.tools) {
      const n = (t && ((t.function && t.function.name) || t.name)) || '';
      if (!n) continue;
      const desc = (t && ((t.function && t.function.description) || t.description)) || '';
      const p = providerOfToolName(n);
      if (!byProvider.has(p)) byProvider.set(p, []);
      byProvider.get(p).push({ name: n, desc });
      nTools++;
    }
  }
  const providersIndexed = [];
  for (const [p, entries] of byProvider) {
    for (const k of keywordsForProvider(p)) rememberProvider(p, entries[0].name, [k]);
    // add remaining items without duplicating keyword links
    const prov = providers.get(p);
    for (const e of entries.slice(1)) prov.items.add(e.name);
    persistProvider(p, entries);
    providersIndexed.push({ provider: p, tools: entries.length, keywords: [...prov.keywords].slice(0, 10) });
  }
  const skillsIndexed = [];
  for (const sk of parseSkills(instructionText)) {
    rememberSkill(sk.name, sk.path, keywordsForSkillName(sk.name), sk.description);
    persistSkill(sk.name, sk.path, sk.description);
    nSkills++;
    skillsIndexed.push(sk.name);
  }
  return { tools: nTools, skills: nSkills, providers: providersIndexed, skillNames: skillsIndexed };
}

function hasIndex() { return providers.size > 0 || skills.size > 0; }

function matchKw(map, text) {
  const hit = new Set();
  if (!text) return hit;
  const low = ` ${String(text).toLowerCase()} `;
  for (const [kw, ids] of map) {
    const found = kw.includes(' ')
      ? low.includes(` ${kw} `) || low.includes(` ${kw}s `)
      : new RegExp(`(?:^|[^a-z0-9])${esc(kw)}s?(?![a-z0-9])`).test(low);
    if (found) for (const id of ids) hit.add(id);
  }
  return hit;
}

function matchedGroupsForPrompt(text) {
  // Returns provider names; gating maps raw MCP groups -> provider via groupToProvider.
  // ponytail: strip index cmd so the sync token never matches skill/tool keywords.
  return matchKw(kwToProviders, stripIndexCmd(text));
}

function matchedSkillsForPrompt(text) {
  return matchKw(kwToSkills, stripIndexCmd(text));
}

// Debug/summary for the "ask AI" step: providers with sample keywords.
function indexSummary() {
  return [...providers.values()].map(p => ({
    provider: p.name, tools: p.items.size, keywords: [...p.keywords].slice(0, 10),
  }));
}

loadFromDb();

// --- Dashboard CRUD (memory + PG fire-and-forget) ---
function db() { try { return require('../storage_layer'); } catch (_) { return null; } }
function delProvider(name) {
  const p = providers.get(name);
  if (!p) return false;
  for (const k of p.keywords) unlinkKw(kwToProviders, k, name);
  providers.delete(name);
  const s = db();
  if (s && s.isEnabled()) (async () => {
    try { await s.query(`DELETE FROM mcp_providers WHERE name=$1`, [name]); }
    catch (e) { console.error('[tool-index] del provider failed:', e.message); }
  })();
  return true;
}
function delSkill(name) {
  const sn = skills.get(name);
  if (!sn) return false;
  for (const k of sn.keywords) unlinkKw(kwToSkills, k, name);
  skills.delete(name);
  const s = db();
  if (s && s.isEnabled()) (async () => {
    try { await s.query(`DELETE FROM skills WHERE name=$1`, [name]); }
    catch (e) { console.error('[tool-index] del skill failed:', e.message); }
  })();
  return true;
}
function addProvKw(provider, kw) {
  kw = String(kw || '').toLowerCase().trim();
  if (!kw) return false;
  let p = providers.get(provider);
  if (!p) { p = { name: provider, keywords: new Set(), items: new Set() }; providers.set(provider, p); }
  if (p.keywords.has(kw)) return true;
  p.keywords.add(kw); linkKw(kwToProviders, kw, provider);
  const s = db();
  if (s && s.isEnabled()) (async () => {
    try {
      await s.query(`INSERT INTO mcp_providers (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [provider]);
      await s.query(`INSERT INTO mcp_provider_keywords (provider, keyword) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [provider, kw]);
    } catch (e) { console.error('[tool-index] add prov kw failed:', e.message); }
  })();
  return true;
}
function delProvKw(provider, kw) {
  kw = String(kw || '').toLowerCase().trim();
  const p = providers.get(provider);
  if (!p || !p.keywords.has(kw)) return false;
  p.keywords.delete(kw); unlinkKw(kwToProviders, kw, provider);
  const s = db();
  if (s && s.isEnabled()) (async () => {
    try { await s.query(`DELETE FROM mcp_provider_keywords WHERE provider=$1 AND keyword=$2`, [provider, kw]); }
    catch (e) { console.error('[tool-index] del prov kw failed:', e.message); }
  })();
  return true;
}
function upsertSkillDash(name, path, keywords, description) {
  name = String(name || '').trim();
  if (!name) return false;
  description = description !== undefined && description !== null ? String(description) : descriptionForSkill(name);
  rememberSkill(name, path || null, (keywords || []).map(k => String(k).toLowerCase().trim()).filter(Boolean), description);
  persistSkill(name, path, description);
  return true;
}
function setSkillPath(name, path) {
  const sn = skills.get(name);
  if (!sn) return false;
  sn.path = path || null;
  persistSkill(name, path, sn.description);
  return true;
}
function setSkillDescription(name, description) {
  const sn = skills.get(name);
  if (!sn) return false;
  sn.description = String(description || '');
  persistSkill(name, sn.path, sn.description);
  return true;
}
function addSkillKw(skill, kw) {
  kw = String(kw || '').toLowerCase().trim();
  if (!kw) return false;
  let sn = skills.get(skill);
  if (!sn) { sn = { name: skill, path: null, description: descriptionForSkill(skill), keywords: new Set() }; skills.set(skill, sn); }
  if (sn.keywords.has(kw)) return true;
  sn.keywords.add(kw); linkKw(kwToSkills, kw, skill);
  persistSkill(skill, sn.path);
  return true;
}
function delSkillKw(skill, kw) {
  kw = String(kw || '').toLowerCase().trim();
  const sn = skills.get(skill);
  if (!sn || !sn.keywords.has(kw)) return false;
  sn.keywords.delete(kw); unlinkKw(kwToSkills, kw, skill);
  const s = db();
  if (s && s.isEnabled()) (async () => {
    try { await s.query(`DELETE FROM skill_keywords WHERE skill=$1 AND keyword=$2`, [skill, kw]); }
    catch (e) { console.error('[tool-index] del skill kw failed:', e.message); }
  })();
  return true;
}
function delTool(toolName) {
  for (const p of providers.values()) {
    if (p.items.has(toolName)) {
      p.items.delete(toolName);
      const s = db();
      if (s && s.isEnabled()) (async () => {
        try { await s.query(`DELETE FROM mcp_items WHERE name=$1`, [toolName]); }
        catch (e) { console.error('[tool-index] del tool failed:', e.message); }
      })();
      return true;
    }
  }
  return false;
}
function moveTool(toolName, toProvider) {
  let from = null;
  for (const p of providers.values()) if (p.items.has(toolName)) { from = p; break; }
  if (!from) return false;
  from.items.delete(toolName);
  let tp = providers.get(toProvider);
  if (!tp) { tp = { name: toProvider, keywords: new Set([toProvider.toLowerCase()]), items: new Set() }; providers.set(toProvider, tp); linkKw(kwToProviders, toProvider.toLowerCase(), toProvider); }
  tp.items.add(toolName);
  const s = db();
  if (s && s.isEnabled()) (async () => {
    try {
      await s.query(`INSERT INTO mcp_providers (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [toProvider]);
      await s.query(`UPDATE mcp_items SET provider=$1 WHERE name=$2`, [toProvider, toolName]);
    } catch (e) { console.error('[tool-index] move tool failed:', e.message); }
  })();
  return true;
}
function upsertProviderDash(name, keywords) {
  name = String(name || '').trim().toLowerCase();
  if (!name) return false;
  let p = providers.get(name);
  if (!p) { p = { name, keywords: new Set(), items: new Set() }; providers.set(name, p); }
  for (const k of (keywords || [])) addProvKw(name, k);
  const s = db();
  if (s && s.isEnabled()) (async () => {
    try { await s.query(`INSERT INTO mcp_providers (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]); }
    catch (e) { console.error('[tool-index] upsert provider failed:', e.message); }
  })();
  return true;
}

module.exports = { INDEX_CMD_RX, indexCurrentRequest, matchKw, matchedGroupsForPrompt, matchedSkillsForPrompt, hasIndex, parseSkills, extractSkillBlocks, groupToProvider, providerOfToolName, indexSummary, providers, skills, delProvider, delSkill, addProvKw, delProvKw, upsertSkillDash, setSkillPath, setSkillDescription, addSkillKw, delSkillKw, delTool, moveTool, upsertProviderDash, SKILL_DESCRIPTIONS, descriptionForSkill };
