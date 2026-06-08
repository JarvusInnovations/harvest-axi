import { AxiError } from "axi-sdk-js";

/**
 * Build a placeholder command that fails clearly until its plan lands. Keeps
 * the dispatch surface honest: the command exists and `--help` works, but
 * invoking it points at the plan that will implement it rather than silently
 * doing nothing.
 */
export function stubCommand(name: string, plan: string) {
  return async (args: string[]): Promise<string> => {
    if (args.includes("--help")) {
      return `usage: harvest-axi ${name} ...\nstatus: not yet implemented (see plans/${plan}.md)\n`;
    }
    throw new AxiError(
      `\`harvest-axi ${name}\` is not yet implemented`,
      "NOT_IMPLEMENTED",
      [`Tracked in plans/${plan}.md`],
    );
  };
}
