'use strict';

const env = (k, d) => process.env[k] ?? d;
const flag = (k, d) => {
  const v = process.env[k];
  return v === undefined ? d : /^(1|true|yes|on)$/i.test(v);
};

const config = {
  databaseUrl: env('DATABASE_URL', 'postgresql://postgres:123456@localhost:5432/9router_proxy'),
  enabled: flag('LOG_TO_PG', true),
  automigrate: flag('PG_AUTOMIGRATE', true),
};

module.exports = { env, flag, config };
