import http from 'node:http';
import { env } from './config/env.js';
import { createHttpHandler } from './app.js';
import { createLogger } from './logger.js';

const log = createLogger('server');

// Process entrypoint: wiring only. The request handler lives in app.js
// (no side effects) so tests can bind it to an ephemeral port.
const server = http.createServer(createHttpHandler());

server.listen(env.PORT);
log.info(`listening on port ${env.PORT}`, { mode: env.NODE_ENV });

export { server };
export default server;
