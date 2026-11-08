'use strict';
/*
 * 9router Proxy — single entry.
 * Starts all three layers in one process:
 *   orchestration_layer :20131 -> :20130 (role routing, roster injection, /orch dashboard)
 *   context_layer       :20130 -> :20129 (shaping, gating, budget)
 *   connection_layer    :20129 -> :20128 (forced model rewrite, retries, fallback, dedup, logging)
 * Kept so com.local.9routerproxy.plist works unchanged.
 */
require('./connection_layer/server').start();
require('./context_layer/server').start();
require('./orchestration_layer/server').start();
