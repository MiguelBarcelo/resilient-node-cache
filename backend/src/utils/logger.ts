type LogLevel = 'info' | 'warn' | 'error';

interface LogPayload extends Record<string, unknown> {
  msg: string;
  event: string;
  service?: string;
}

const sinkByLevel: Record<LogLevel, (line: string) => void> = {
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

function createMethod(level: LogLevel) {
  return (payload: LogPayload) => {
    const { level: _, ...rest } = payload as Record<string, unknown>;
    const entry = {
      level,
      timestamp: new Date().toISOString(),
      ...rest,
    };
    sinkByLevel[level](JSON.stringify(entry));
  };
}

const logger = {
  info: createMethod('info'),
  warn: createMethod('warn'),
  error: createMethod('error'),
};

export default logger;
