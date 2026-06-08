import { resolveCredentials } from "../config.js";
import { whoMe } from "../harvest/identity.js";
import { renderList, renderObject, joinBlocks } from "../output/index.js";

export const DOCTOR_HELP = `usage: harvest-axi doctor
Checks credentials, token validity, and account reachability. Exit 0 if all
checks pass, 1 otherwise. No flags.
`;

interface Check {
  check: string;
  status: string;
  detail: string;
}

/**
 * Health check: credentials present → token valid → account reachable. Each
 * check reports pass/fail with a specific remediation. Sets exit code 1 on any
 * failure (the SDK reads process.exitCode).
 */
export async function doctorCommand(): Promise<string> {
  const checks: Check[] = [];
  const creds = resolveCredentials();

  if (!creds) {
    checks.push({
      check: "credentials",
      status: "fail",
      detail: "none found — run `harvest-axi auth setup --token <pat>`",
    });
    process.exitCode = 1;
    return joinBlocks(
      renderList("checks", checks as unknown as Record<string, unknown>[], [
        { name: "check", extract: (i) => i.check },
        { name: "status", extract: (i) => i.status },
        { name: "detail", extract: (i) => i.detail },
      ]),
    );
  }

  checks.push({
    check: "credentials",
    status: "ok",
    detail: `${creds.source} (account ${creds.accountId})`,
  });

  try {
    const profile = await whoMe(creds);
    checks.push({ check: "token", status: "ok", detail: `authenticated as ${profile.user_name}` });
    checks.push({ check: "account", status: "ok", detail: profile.account_name });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    checks.push({ check: "token", status: "fail", detail: message });
    checks.push({
      check: "account",
      status: "skipped",
      detail: "token check failed first",
    });
    process.exitCode = 1;
  }

  return joinBlocks(
    renderObject({ healthy: !checks.some((c) => c.status === "fail") }),
    renderList("checks", checks as unknown as Record<string, unknown>[], [
      { name: "check", extract: (i) => i.check },
      { name: "status", extract: (i) => i.status },
      { name: "detail", extract: (i) => i.detail },
    ]),
  );
}
