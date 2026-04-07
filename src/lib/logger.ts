import pino from 'pino';
import os from 'os';

const isDevelopment = process.env.NODE_ENV === 'development';

export const logger = pino({
  level: isDevelopment ? 'debug' : 'info',
  base: {
    pid: process.pid,
    hostname: os.hostname(),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDevelopment && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        translateTime: 'HH:MM:ss Z',
      },
    },
  }),
});

/**
 * Creates a child logger with a specific module name.
 */
export const createModuleLogger = (moduleName: string) => {
  return logger.child({ module: moduleName });
};
