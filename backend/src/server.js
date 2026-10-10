const app = require('./app');
const env = require('./config/env');

const server = app.listen(env.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Hindusthan Department ERP API listening on port ${env.port} (${env.nodeEnv})`);
});

const shutdown = (signal) => () => {
  // eslint-disable-next-line no-console
  console.log(`\n${signal} received. Shutting down.`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
};

process.on('SIGINT', shutdown('SIGINT'));
process.on('SIGTERM', shutdown('SIGTERM'));

module.exports = server;