'use strict';
/*
 * 9router Proxy — single entry.
 * Starts both layers in one process:
 *   context_layer    :20130 -> :20129 (shaping, gating, budget)
 *   connection_layer :20129 -> :20128 (retries, fallback, dedup, logging)
 * Kept so com.local.9routerproxy.plist works unchanged.
 */
require('./connection_layer/server').start();
require('./context_layer/server').start();
