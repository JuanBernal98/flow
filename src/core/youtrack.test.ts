import { describe, expect, test } from "bun:test";
import { loadYouTrackTasks, moveMergedTicket, type YouTrackDeps } from "./youtrack";

const TEST_TOKEN = "perm-test-token";

/** Build deps that never touch the real environment, Keychain, or network. */
function createTestYouTrackDeps(overrides: YouTrackDeps = {}): YouTrackDeps {
  return {
    url: "https://youtrack.example.test",
    env: { FLOW_YOUTRACK_TOKEN: TEST_TOKEN },
    platform: "linux",
    readKeychainToken: () => undefined,
    fetchImpl: async () => Response.json([]),
    ...overrides,
  };
}

describe("loadYouTrackTasks", () => {
  test("requests assigned open issues and maps summary and State", async () => {
    const requests: { url: URL; init?: RequestInit }[] = [];
    const result = await loadYouTrackTasks(
      createTestYouTrackDeps({
        fetchImpl: async (url, init) => {
          requests.push({ url, init });
          return Response.json([
            {
              $type: "Issue",
              idReadable: "PROJ-123",
              summary: "Keep badge on one line",
              customFields: [
                { name: "Priority", value: { name: "Major" } },
                { name: "State", value: { name: "In Progress", $type: "StateBundleElement" } },
              ],
            },
            {
              idReadable: "PROJ-124",
              summary: null,
              customFields: [{ name: "State", value: null }],
            },
          ]);
        },
      }),
    );

    expect(result).toEqual({
      kind: "ready",
      tasks: [
        {
          id: "PROJ-123",
          summary: "Keep badge on one line",
          state: "In Progress",
          url: "https://youtrack.example.test/issue/PROJ-123",
        },
        {
          id: "PROJ-124",
          summary: "",
          state: undefined,
          url: "https://youtrack.example.test/issue/PROJ-124",
        },
      ],
    });
    const [request] = requests;
    if (!request) throw new Error("Expected one YouTrack request");
    expect(`${request.url.origin}${request.url.pathname}`).toBe(
      "https://youtrack.example.test/api/issues",
    );
    expect(request.url.searchParams.get("query")).toBe("for: me #Unresolved sort by: updated desc");
    expect(new Headers(request.init?.headers).get("Authorization")).toBe(`Bearer ${TEST_TOKEN}`);
  });

  test("keeps a configured base path such as /youtrack", async () => {
    let requested: URL | undefined;
    await loadYouTrackTasks(
      createTestYouTrackDeps({
        url: "https://example.test/youtrack",
        fetchImpl: async (url) => {
          requested = url;
          return Response.json([]);
        },
      }),
    );
    expect(requested?.pathname).toBe("/youtrack/api/issues");
  });

  test("falls back to the Keychain token on macOS only", async () => {
    const seenAuth: (string | null)[] = [];
    const fetchImpl = async (_url: URL, init?: RequestInit) => {
      seenAuth.push(new Headers(init?.headers).get("Authorization"));
      return Response.json([]);
    };
    const env = {};

    const mac = await loadYouTrackTasks(
      createTestYouTrackDeps({
        env,
        platform: "darwin",
        readKeychainToken: () => "keychain-token",
        fetchImpl,
      }),
    );
    const linux = await loadYouTrackTasks(
      createTestYouTrackDeps({ env, readKeychainToken: () => "keychain-token", fetchImpl }),
    );

    expect(mac.kind).toBe("ready");
    expect(seenAuth).toEqual(["Bearer keychain-token"]);
    expect(linux.kind).toBe("unconfigured");
  });

  test("reports missing or insecure configuration without calling the network", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return Response.json([]);
    };

    const noUrl = await loadYouTrackTasks(createTestYouTrackDeps({ url: undefined, fetchImpl }));
    const plainHttp = await loadYouTrackTasks(
      createTestYouTrackDeps({ url: "http://youtrack.example.test", fetchImpl }),
    );

    expect(noUrl.kind).toBe("unconfigured");
    expect(plainHttp).toEqual({
      kind: "unconfigured",
      message: "YouTrack URL needs https",
    });
    expect(calls).toBe(0);
  });

  test("connects only to the repository's instance, never one from the environment", async () => {
    let calls = 0;
    const result = await loadYouTrackTasks(
      createTestYouTrackDeps({
        url: undefined,
        env: { FLOW_YOUTRACK_URL: "https://env.example.test", FLOW_YOUTRACK_TOKEN: TEST_TOKEN },
        fetchImpl: async () => {
          calls += 1;
          return Response.json([]);
        },
      }),
    );
    expect(result).toEqual({
      kind: "unconfigured",
      message: "Set [youtrack] url in .flow/config.toml",
    });
    expect(calls).toBe(0);
  });

  test("allows plain http on loopback for local fakes", async () => {
    const result = await loadYouTrackTasks(
      createTestYouTrackDeps({
        url: "http://127.0.0.1:4010",
      }),
    );
    expect(result.kind).toBe("ready");
  });

  test("turns HTTP, schema, network, and timeout failures into messages without the token", async () => {
    const results = await Promise.all([
      loadYouTrackTasks(
        createTestYouTrackDeps({ fetchImpl: async () => new Response("", { status: 401 }) }),
      ),
      loadYouTrackTasks(
        createTestYouTrackDeps({ fetchImpl: async () => new Response("", { status: 502 }) }),
      ),
      loadYouTrackTasks(createTestYouTrackDeps({ fetchImpl: async () => Response.json({}) })),
      loadYouTrackTasks(
        createTestYouTrackDeps({
          fetchImpl: async () => {
            throw new Error(`connect failed with ${TEST_TOKEN}`);
          },
        }),
      ),
      loadYouTrackTasks(
        createTestYouTrackDeps({
          fetchTimeoutMs: 5,
          fetchImpl: (_url, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
            }),
        }),
      ),
    ]);

    expect(results).toEqual([
      { kind: "error", message: "YouTrack rejected the token" },
      { kind: "error", message: "YouTrack responded 502" },
      { kind: "error", message: "Unexpected YouTrack response" },
      { kind: "error", message: "YouTrack is unreachable" },
      { kind: "error", message: "YouTrack timed out" },
    ]);
    expect(JSON.stringify(results)).not.toContain(TEST_TOKEN);
  });
});

describe("moveMergedTicket", () => {
  /** Answer `users/me` and the issue read; record every command sent. */
  function createTestMoveDeps(issue: { assignee?: string; state?: string }, commands: unknown[]) {
    return createTestYouTrackDeps({
      fetchImpl: async (url, init) => {
        if (url.pathname.endsWith("/api/users/me")) return Response.json({ login: "me" });
        if (url.pathname.endsWith("/api/commands")) {
          commands.push(JSON.parse(String(init?.body)));
          return Response.json({});
        }
        return Response.json({
          customFields: [
            {
              name: "Assignee",
              value: issue.assignee ? { login: issue.assignee, name: "x" } : null,
            },
            { name: "State", value: issue.state ? { name: issue.state } : null },
          ],
        });
      },
    });
  }

  test("moves my ticket still in Review with a State command", async () => {
    const commands: unknown[] = [];
    const result = await moveMergedTicket(
      "PROJ-5",
      "Done",
      createTestMoveDeps({ assignee: "me", state: "Review" }, commands),
    );
    expect(result).toEqual({ kind: "moved", state: "Done" });
    expect(commands).toEqual([{ query: "State Done", issues: [{ idReadable: "PROJ-5" }] }]);
  });

  test("never touches a ticket assigned to someone else or no longer in Review", async () => {
    const commands: unknown[] = [];
    expect(
      await moveMergedTicket(
        "PROJ-5",
        "Done",
        createTestMoveDeps({ assignee: "teammate", state: "Review" }, commands),
      ),
    ).toEqual({ kind: "skipped", reason: "not assigned to you" });
    expect(
      await moveMergedTicket("PROJ-5", "Done", createTestMoveDeps({ state: "Review" }, commands)),
    ).toEqual({ kind: "skipped", reason: "not assigned to you" });
    expect(
      await moveMergedTicket(
        "PROJ-5",
        "Done",
        createTestMoveDeps({ assignee: "me", state: "In Progress" }, commands),
      ),
    ).toEqual({ kind: "skipped", reason: "no longer in Review" });
    expect(commands).toEqual([]);
  });

  test("passes on YouTrack's reason when it rejects the command", async () => {
    const deps = createTestYouTrackDeps({
      fetchImpl: async (url) => {
        if (url.pathname.endsWith("/api/users/me")) return Response.json({ login: "me" });
        if (url.pathname.endsWith("/api/commands")) {
          return Response.json(
            { error: "bad_request", error_description: "State expected: {Done}" },
            { status: 400 },
          );
        }
        return Response.json({
          customFields: [
            { name: "Assignee", value: { login: "me" } },
            { name: "State", value: { name: "Review" } },
          ],
        });
      },
    });
    expect(await moveMergedTicket("PROJ-5", "Done", deps)).toEqual({
      kind: "error",
      message: "YouTrack responded 400: State expected: {Done}",
    });
  });

  test("reports a failed read without sending any command", async () => {
    const result = await moveMergedTicket(
      "PROJ-5",
      "Done",
      createTestYouTrackDeps({ fetchImpl: async () => new Response("", { status: 403 }) }),
    );
    expect(result).toEqual({ kind: "error", message: "YouTrack rejected the token" });
  });
});
