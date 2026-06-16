type LogLevel = "info" | "warn" | "error";

type LogPayload = Record<string, unknown>;

function emit(level: LogLevel, event: string, payload: LogPayload = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    event,
    ...payload,
  };

  const line = JSON.stringify(record);
  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  console.log(line);
}

export const logger = {
  info(event: string, payload?: LogPayload) {
    emit("info", event, payload);
  },
  warn(event: string, payload?: LogPayload) {
    emit("warn", event, payload);
  },
  error(event: string, payload?: LogPayload) {
    emit("error", event, payload);
  },
};
