export class FlowUserError extends Error {
  readonly details: string[];

  constructor(message: string, details: string[] = []) {
    super(message);
    this.name = "FlowUserError";
    this.details = details;
  }
}

/** Format CLI and startup failures without exposing Bun internal stack frames for expected errors. */
export function formatCliError(error: unknown) {
  if (error instanceof FlowUserError) {
    const lines = [`flow: ${error.message}`];

    if (error.details.length > 0) {
      lines.push("", ...error.details);
    }

    return `${lines.join("\n")}\n`;
  }

  if (error instanceof Error) {
    if (process.env.FLOW_DEBUG === "1" && error.stack) {
      return `${error.stack}\n`;
    }

    return `flow: ${error.message}\n`;
  }

  return `flow: ${String(error)}\n`;
}
