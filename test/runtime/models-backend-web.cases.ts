import {
  applyPatchInWorktree,
  buildDocsPacket,
  buildPhasePacket,
  capture,
  coerceToUnifiedDiff,
  compileSpecInput,
  countOccurrences,
  createValidator,
  databasePath,
  describe,
  expect,
  freePort,
  fs,
  generateFromModel,
  handleInternalApi,
  initializeDatabase,
  it,
  loadConfig,
  parseTuiCommand,
  probeModelProvider,
  path,
  routeModel,
  runCli,
  runVerificationPlan,
  saveConfig,
  schemaFixtures,
  selectOpenDesignAssets,
  spawn,
  startFakeLlamaHttpServer,
  startFakeSearchServer,
  tempWorkspace,
  validateCommandAllowed,
  validateConfig,
  validatePatchScope,
  vi,
  writeFakeLlamaServer,
} from "./support.js";

describe("Micro Mission Coder runtime - models, backends, and web research", () => {
it("model routing honors disabled role policy entries", () => {
    const registry = {
      models: [{ id: "moondream", role: "visual_inspector", provider: "ollama", state_policy: "cold" as const }],
      role_policy: { middle_32gb: { visual_inspector: "disabled_by_default" } },
    };
    expect(routeModel(registry, "visual_inspector", "middle_32gb")).toBeNull();
  });

it("model routing prefers explicit role overrides and same-role model entries", () => {
    const registry = {
      models: [
        { id: "qwen2.5-coder:7b", role: "code_writer", provider: "ollama", state_policy: "warm" as const },
        { id: "qwen2.5-coder:7b", role: "test_writer", provider: "ollama", state_policy: "warm" as const },
        { id: "phi4-mini", role: "test_writer", provider: "ollama", state_policy: "cold" as const },
      ],
      role_policy: { middle_32gb: { test_writer: "phi4-mini" } },
    };
    expect(routeModel(registry, "test_writer", "middle_32gb")?.role).toBe("test_writer");
    expect(routeModel(registry, "test_writer", "middle_32gb", { test_writer: "qwen2.5-coder:7b" })?.role).toBe("test_writer");
    expect(routeModel(registry, "test_writer", "middle_32gb", { test_writer: "disabled" })).toBeNull();
  });

it("models list reports every routed role including interface and disabled visual inspection", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    fs.writeFileSync(
      path.join(cwd, "12_MODEL_PROFILES.yaml"),
      [
        "models:",
        "  - id: gemma3:1b",
        "    role: interface",
        "    provider: ollama",
        "    state_policy: hot",
        "  - id: gemma3:1b",
        "    role: planner",
        "    provider: ollama",
        "    state_policy: hot",
        "  - id: qwen2.5-coder:7b",
        "    role: code_writer",
        "    provider: ollama",
        "    state_policy: warm",
        "  - id: phi4-mini",
        "    role: test_writer",
        "    provider: ollama",
        "    state_policy: cold",
        "  - id: moondream",
        "    role: visual_inspector",
        "    provider: ollama",
        "    state_policy: cold",
        "role_policy:",
        "  middle_32gb:",
        "    interface: gemma3:1b",
        "    planner: gemma3:1b",
        "    code_writer: qwen2.5-coder:7b",
        "    test_writer: phi4-mini",
        "    visual_inspector: disabled_by_default",
        "",
      ].join("\n"),
    );
    const cap = capture();
    expect(await runCli(["models", "list"], { cwd, io: cap.io })).toBe(0);
    const routed = JSON.parse(cap.stdout.join("\n")).routed as Array<{ role: string; model: string | null; backend: string | null }>;
    expect(routed).toEqual(expect.arrayContaining([expect.objectContaining({ role: "interface", model: "gemma3:1b", backend: "ollama" })]));
    expect(routed).toEqual(expect.arrayContaining([expect.objectContaining({ role: "test_writer", model: "phi4-mini", backend: "ollama" })]));
    expect(routed).toEqual(expect.arrayContaining([expect.objectContaining({ role: "visual_inspector", model: null, backend: null })]));
  });

it("models status and set provide a usable picker instead of only dumping routes", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    fs.writeFileSync(
      path.join(cwd, "12_MODEL_PROFILES.yaml"),
      [
        "models:",
        "  - id: qwen2.5-coder:3b",
        "    role: code_writer",
        "    provider: ollama",
        "    state_policy: warm",
        "    hardware_min_ram_gb: 16",
        "    context_limit: 32768",
        "  - id: qwen2.5-coder:7b",
        "    role: code_writer",
        "    provider: ollama",
        "    state_policy: warm",
        "    hardware_min_ram_gb: 24",
        "    context_limit: 32768",
        "role_policy:",
        "  middle_32gb:",
        "    code_writer: qwen2.5-coder:7b",
        "",
      ].join("\n"),
    );
    const statusCap = capture();
    expect(await runCli(["models", "status"], { cwd, io: statusCap.io })).toBe(0);
    expect(statusCap.stdout.join("\n")).toContain("active qwen2.5-coder:7b (profile)");
    expect(statusCap.stdout.join("\n")).toContain("qwen2.5-coder:3b provider=ollama");

    expect(await runCli(["models", "set", "code_writer", "qwen2.5-coder:3b"], { cwd, io: capture().io })).toBe(0);
    const listCap = capture();
    expect(await runCli(["models", "list"], { cwd, io: listCap.io })).toBe(0);
    const parsed = JSON.parse(listCap.stdout.join("\n")) as { overrides: Record<string, string>; routed: Array<{ role: string; model: string | null }> };
    expect(parsed.overrides.code_writer).toBe("qwen2.5-coder:3b");
    expect(parsed.routed).toEqual(expect.arrayContaining([expect.objectContaining({ role: "code_writer", model: "qwen2.5-coder:3b" })]));

    expect(await runCli(["models", "clear", "code_writer"], { cwd, io: capture().io })).toBe(0);
    const clearedCap = capture();
    expect(await runCli(["models", "list"], { cwd, io: clearedCap.io })).toBe(0);
    expect(JSON.parse(clearedCap.stdout.join("\n")).routed).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "code_writer", model: "qwen2.5-coder:7b" })]),
    );
  });

it("models list falls back to the packaged registry outside the source repo", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const cap = capture();
    expect(await runCli(["models", "list"], { cwd, io: cap.io })).toBe(0);
    const routed = JSON.parse(cap.stdout.join("\n")).routed as Array<{ role: string; model: string | null }>;
    expect(routed).toEqual(expect.arrayContaining([expect.objectContaining({ role: "interface", model: "gemma3:1b" })]));
    expect(routed).toEqual(expect.arrayContaining([expect.objectContaining({ role: "spec_critic", model: "gemma3:1b" })]));
    expect(routed).toEqual(expect.arrayContaining([expect.objectContaining({ role: "code_writer", model: "qwen2.5-coder:7b" })]));
  });

it("models set can pin the optional liquid interface route without changing defaults", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const setCap = capture();
    expect(await runCli(["models", "set", "interface", "liquid-lfm2-1.2b"], { cwd, io: setCap.io })).toBe(0);
    expect(setCap.stdout.join("\n")).toContain("model_route interface liquid-lfm2-1.2b");

    const listCap = capture();
    expect(await runCli(["models", "list"], { cwd, io: listCap.io })).toBe(0);
    const parsed = JSON.parse(listCap.stdout.join("\n")) as {
      provider_default: string;
      overrides: Record<string, string>;
      routed: Array<{ role: string; model: string | null; backend: string | null }>;
    };
    expect(parsed.provider_default).toBe("ollama");
    expect(parsed.overrides.interface).toBe("liquid-lfm2-1.2b");
    expect(parsed.routed).toEqual(expect.arrayContaining([expect.objectContaining({ role: "interface", model: "liquid-lfm2-1.2b", backend: "llamacpp" })]));
  });

it("setup backend llamacpp writes config without stealing Ollama as the default", async () => {
    const cwd = tempWorkspace();
    const modelPath = path.join(cwd, "code-writer.gguf");
    fs.writeFileSync(modelPath, "fake gguf placeholder\n");
    const cap = capture();
    expect(
      await runCli(["setup", "backend", "llamacpp", "--server", "/tmp/llama-server", "--model", `code_writer=${modelPath}`, "--auto-start", "true"], {
        cwd,
        io: cap.io,
      }),
    ).toBe(0);
    const loaded = loadConfig(cwd);
    expect(loaded.config.models.provider_default).toBe("ollama");
    expect(loaded.config.models.llamacpp.llama_server_path).toBe("/tmp/llama-server");
    expect(loaded.config.models.llamacpp.model_paths.code_writer).toBe(modelPath);
    expect(loaded.config.models.llamacpp.auto_start).toBe(true);
    expect(cap.stdout.join("\n")).toContain("select_hint microcoder setup backend llamacpp --select");
  });

it("setup backend llamacpp pins liquid as the interface route when given an interface GGUF", async () => {
    const cwd = tempWorkspace();
    const modelPath = path.join(cwd, "interface.gguf");
    fs.writeFileSync(modelPath, "fake gguf placeholder\n");
    const cap = capture();
    expect(
      await runCli(["setup", "backend", "llamacpp", "--model", `interface=${modelPath}`, "--auto-start", "false"], {
        cwd,
        io: cap.io,
      }),
    ).toBe(0);
    const loaded = loadConfig(cwd);
    expect(loaded.config.models.provider_default).toBe("ollama");
    expect(loaded.config.models.llamacpp.model_paths.interface).toBe(modelPath);
    expect(loaded.config.models.role_overrides?.interface).toBe("liquid-lfm2-1.2b");
    expect(cap.stdout.join("\n")).toContain("interface_route liquid-lfm2-1.2b");
  });

it("setup backend llamacpp rejects missing flag values before writing bad config", async () => {
    const cwd = tempWorkspace();
    const cap = capture();
    expect(await runCli(["setup", "backend", "llamacpp", "--host", "--port"], { cwd, io: cap.io })).toBe(1);
    expect(cap.stderr.join("\n")).toContain("--host requires a value");
    expect(loadConfig(cwd).config.models.llamacpp.host).toBe("127.0.0.1");
  });

it("config validation rejects bad llama.cpp backend settings", () => {
    const loaded = loadConfig(tempWorkspace());
    loaded.config.models.provider_default = "llamacpp";
    loaded.config.models.llamacpp.port = 70000;
    loaded.config.models.llamacpp.context_size = 0;
    loaded.config.models.llamacpp.timeout_seconds = 0;
    const errors = validateConfig(loaded.config);
    expect(errors).toContain("models.llamacpp.port must be between 1 and 65535");
    expect(errors).toContain("models.llamacpp.context_size must be a positive integer");
    expect(errors).toContain("models.llamacpp.timeout_seconds must be a positive integer");
  });

it("config validation rejects bad web research settings", () => {
    const loaded = loadConfig(tempWorkspace());
    (loaded.config.web_research as { provider: string }).provider = "bad-provider";
    (loaded.config.web_research as { auto_include_in_chat: unknown }).auto_include_in_chat = "yes";
    loaded.config.web_research.timeout_seconds = 0;
    loaded.config.web_research.max_results = 0;
    loaded.config.web_research.search_url = "not-a-url";
    const errors = validateConfig(loaded.config);
    expect(errors).toContain("web_research.provider must be duckduckgo_html or custom_json");
    expect(errors).toContain("web_research.auto_include_in_chat must be a boolean");
    expect(errors).toContain("web_research.timeout_seconds must be a positive integer");
    expect(errors).toContain("web_research.max_results must be a positive integer");
    expect(errors).toContain("web_research.search_url must be an http(s) URL");
  });

it("config validation rejects bad chat interface model settings", () => {
    const loaded = loadConfig(tempWorkspace());
    (loaded.config.chat.interface_model as { enabled: unknown }).enabled = "yes";
    (loaded.config.chat.interface_model as { require_explicit_route: unknown }).require_explicit_route = "yes";
    loaded.config.chat.interface_model.timeout_seconds = 0;
    loaded.config.chat.interface_model.minimum_confidence = 2;
    const errors = validateConfig(loaded.config);
    expect(errors).toContain("chat.interface_model.enabled must be a boolean");
    expect(errors).toContain("chat.interface_model.require_explicit_route must be a boolean");
    expect(errors).toContain("chat.interface_model.timeout_seconds must be a positive integer");
    expect(errors).toContain("chat.interface_model.minimum_confidence must be between 0 and 1");
  });

it("web search uses a configured endpoint and returns sources without live network dependency", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await startFakeSearchServer();
    try {
      const loaded = loadConfig(cwd);
      loaded.config.web_research.enabled = true;
      loaded.config.web_research.provider = "custom_json";
      loaded.config.web_research.search_url = fake.url;
      loaded.config.web_research.max_results = 3;
      saveConfig(cwd, loaded.config);

      const cap = capture();
      expect(await runCli(["web", "search", "canvas snake keyboard controls"], { cwd, io: cap.io })).toBe(0);
      const output = cap.stdout.join("\n");
      expect(output).toContain("web_status READY");
      expect(output).toContain("Docs for canvas snake keyboard controls");
      expect(output).toContain("https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API");
      expect(fake.requests).toEqual(["/search?q=canvas%20snake%20keyboard%20controls"]);
    } finally {
      await fake.close();
    }
  });

it("setup web configures research without changing model routing", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const cap = capture();
    expect(
      await runCli(
        [
          "setup",
          "web",
          "--enabled",
          "false",
          "--auto",
          "false",
          "--chat",
          "false",
          "--provider",
          "custom_json",
          "--url",
          "http://127.0.0.1:9999/search?q={q}",
          "--timeout",
          "2",
          "--max-results",
          "2",
          "--allow-domain",
          "developer.mozilla.org",
        ],
        { cwd, io: cap.io },
      ),
    ).toBe(0);
    const loaded = loadConfig(cwd);
    expect(loaded.config.models.provider_default).toBe("ollama");
    expect(loaded.config.web_research.enabled).toBe(false);
    expect(loaded.config.web_research.auto_include_in_docs).toBe(false);
    expect(loaded.config.web_research.auto_include_in_chat).toBe(false);
    expect(loaded.config.web_research.provider).toBe("custom_json");
    expect(loaded.config.web_research.timeout_seconds).toBe(2);
    expect(loaded.config.web_research.max_results).toBe(2);
    expect(loaded.config.web_research.allowed_domains).toEqual(["developer.mozilla.org"]);
    expect(cap.stdout.join("\n")).toContain("web research configured");
  });

it("setup web rejects unknown options and flag-shaped values", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const missingValueCap = capture();
    expect(await runCli(["setup", "web", "--provider", "--timeout"], { cwd, io: missingValueCap.io })).toBe(1);
    expect(missingValueCap.stderr.join("\n")).toContain("--provider requires a value");

    const unknownCap = capture();
    expect(await runCli(["setup", "web", "--bogus", "true"], { cwd, io: unknownCap.io })).toBe(1);
    expect(unknownCap.stderr.join("\n")).toContain("unknown option --bogus");
  });

it("models list shows llama.cpp backend, provider, model path, and routing when selected", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const modelPath = path.join(cwd, "code-writer.gguf");
    fs.writeFileSync(modelPath, "fake gguf placeholder\n");
    const loaded = loadConfig(cwd);
    loaded.config.models.provider_default = "llamacpp";
    loaded.config.models.llamacpp.model_paths.code_writer = modelPath;
    saveConfig(cwd, loaded.config);
    const cap = capture();
    expect(await runCli(["models", "list"], { cwd, io: cap.io })).toBe(0);
    const parsed = JSON.parse(cap.stdout.join("\n")) as { provider_default: string; routed: Array<Record<string, unknown>> };
    expect(parsed.provider_default).toBe("llamacpp");
    expect(parsed.routed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "code_writer",
          model: "qwen2.5-coder:7b",
          registry_provider: "ollama",
          backend: "llamacpp",
          model_path: modelPath,
        }),
      ]),
    );
  });

it("doctor reports MISSING_MODEL when llama.cpp is selected without a GGUF path", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const loaded = loadConfig(cwd);
    loaded.config.models.provider_default = "llamacpp";
    saveConfig(cwd, loaded.config);
    const cap = capture();
    expect(await runCli(["doctor"], { cwd, io: cap.io })).toBe(7);
    expect(cap.stdout.join("\n")).toContain("code_writer_backend llamacpp");
    expect(cap.stdout.join("\n")).toContain("llamacpp_status MISSING_MODEL");
  });

it("models probe code_writer uses a llama.cpp-compatible HTTP server without Ollama", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const fake = await startFakeLlamaHttpServer("FAKE_LLAMACPP_HTTP_OK");
    try {
      const modelPath = path.join(cwd, "code-writer.gguf");
      fs.writeFileSync(modelPath, "fake gguf placeholder\n");
      const loaded = loadConfig(cwd);
      loaded.config.models.provider_default = "llamacpp";
      loaded.config.models.llamacpp.host = "127.0.0.1";
      loaded.config.models.llamacpp.port = fake.port;
      loaded.config.models.llamacpp.model_paths.code_writer = modelPath;
      loaded.config.models.llamacpp.auto_start = false;
      loaded.config.models.llamacpp.timeout_seconds = 5;
      saveConfig(cwd, loaded.config);

      const doctorCap = capture();
      expect(await runCli(["doctor"], { cwd, io: doctorCap.io })).toBe(0);
      expect(doctorCap.stdout.join("\n")).toContain("llamacpp_status READY");

      const cap = capture();
      expect(await runCli(["models", "probe", "code_writer"], { cwd, io: cap.io })).toBe(0);
      const output = cap.stdout.join("\n");
      expect(output).toContain("provider llamacpp");
      expect(output).toContain("response FAKE_LLAMACPP_HTTP_OK");
    } finally {
      await fake.close();
    }
  });

it("auto-started llama.cpp probes stop their managed server and remove the pid file", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const serverPath = writeFakeLlamaServer(cwd);
    const modelPath = path.join(cwd, "code-writer.gguf");
    fs.writeFileSync(modelPath, "fake gguf placeholder\n");
    const port = await freePort();
    const loaded = loadConfig(cwd);
    loaded.config.models.provider_default = "llamacpp";
    loaded.config.models.llamacpp.llama_server_path = serverPath;
    loaded.config.models.llamacpp.host = "127.0.0.1";
    loaded.config.models.llamacpp.port = port;
    loaded.config.models.llamacpp.model_paths.code_writer = modelPath;
    loaded.config.models.llamacpp.auto_start = true;
    loaded.config.models.llamacpp.auto_stop_after_request = true;
    loaded.config.models.llamacpp.startup_timeout_seconds = 5;
    loaded.config.models.llamacpp.timeout_seconds = 5;
    saveConfig(cwd, loaded.config);
    try {
      const cap = capture();
      expect(await runCli(["models", "probe", "code_writer"], { cwd, io: cap.io })).toBe(0);
      expect(cap.stdout.join("\n")).toContain("response FAKE_LLAMACPP_PROCESS_OK");
      expect(fs.existsSync(path.join(cwd, ".mission", "backend", "llamacpp.pid"))).toBe(false);
      const statusCap = capture();
      expect(await runCli(["backend", "status", "code_writer"], { cwd, io: statusCap.io })).toBe(7);
      expect(statusCap.stdout.join("\n")).toContain("status SERVER_START_FAILED");
    } finally {
      await runCli(["backend", "stop"], { cwd, io: capture().io });
    }
  });

it("backend stop removes unverified llama.cpp pid files without signaling unrelated processes", async () => {
    const cwd = tempWorkspace();
    await runCli(["init"], { cwd, io: capture().io });
    const sleeper = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    try {
      expect(sleeper.pid).toBeTypeOf("number");
      const loaded = loadConfig(cwd);
      loaded.config.models.provider_default = "llamacpp";
      loaded.config.models.llamacpp.llama_server_path = path.join(cwd, "fake-llama-server.mjs");
      loaded.config.models.llamacpp.host = "127.0.0.1";
      loaded.config.models.llamacpp.port = await freePort();
      saveConfig(cwd, loaded.config);
      const pidDir = path.join(cwd, ".mission", "backend");
      fs.mkdirSync(pidDir, { recursive: true });
      const pidFile = path.join(pidDir, "llamacpp.pid");
      fs.writeFileSync(
        pidFile,
        JSON.stringify({
          pid: sleeper.pid,
          host: loaded.config.models.llamacpp.host,
          port: loaded.config.models.llamacpp.port,
          model_path: path.join(cwd, "not-this-process.gguf"),
          binary_path: loaded.config.models.llamacpp.llama_server_path,
        }),
      );

      const cap = capture();
      expect(await runCli(["backend", "stop"], { cwd, io: cap.io })).toBe(0);
      expect(cap.stdout.join("\n")).toContain("ownership could not be verified");
      expect(fs.existsSync(pidFile)).toBe(false);
      expect(process.kill(sleeper.pid!, 0)).toBe(true);
    } finally {
      if (sleeper.pid) {
        try {
          process.kill(sleeper.pid, "SIGKILL");
        } catch {
          // Already exited.
        }
      }
    }
  });

it("ollama probes fail with an explicit timeout instead of hanging", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(
      path.join(cwd, "12_MODEL_PROFILES.yaml"),
      [
        "models:",
        "  - id: qwen2.5-coder:7b",
        "    role: code_writer",
        "    provider: ollama",
        "    state_policy: warm",
      ].join("\n"),
    );
    const loaded = loadConfig(cwd);
    loaded.config.models.llamacpp.timeout_seconds = 1;
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    );
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock);
    try {
      let thrown: unknown;
      try {
        await probeModelProvider({ cwd, config: loaded.config, role: "code_writer" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ code: "MODEL_PROVIDER_FAILED" });
      expect((thrown as Error).message).toContain("timed out after 1s");
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

it("OpenAI-compatible probes fail with an explicit timeout instead of hanging", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(
      path.join(cwd, "12_MODEL_PROFILES.yaml"),
      [
        "models:",
        "  - id: local-code",
        "    role: code_writer",
        "    provider: openai-compatible",
        "    state_policy: warm",
      ].join("\n"),
    );
    const loaded = loadConfig(cwd);
    loaded.config.models.llamacpp.timeout_seconds = 1;
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      }),
    );
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock);
    try {
      let thrown: unknown;
      try {
        await probeModelProvider({ cwd, config: loaded.config, role: "code_writer" });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toMatchObject({ code: "MODEL_PROVIDER_FAILED" });
      expect((thrown as Error).message).toContain("timed out after 1s");
      expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

it("code patch generation sends a strict unified-diff contract to model backends", async () => {
    const cwd = tempWorkspace();
    fs.writeFileSync(
      path.join(cwd, "12_MODEL_PROFILES.yaml"),
      [
        "models:",
        "  - id: qwen2.5-coder:7b",
        "    role: code_writer",
        "    provider: ollama",
        "    state_policy: warm",
      ].join("\n"),
    );
    const loaded = loadConfig(cwd);
    const packet = buildPhasePacket({
      config: loaded.config,
      phase: "code_patch",
      task: {
        id: "T1",
        title: "Create a browser Snake game scaffold",
        description: "Create index.html, src/main.js, and src/styles.css for a playable Snake game.",
        status: "ready",
        depends_on: [],
        acceptance_ids: ["AC1"],
        allowed_files: ["index.html", "src/main.js", "src/styles.css"],
        forbidden_files: [".env"],
        verification_commands: ["npm test"],
        risk_flags: [],
      },
    });
    const fetchMock = vi.fn((_url: string | URL | Request, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ response: "diff --git a/index.html b/index.html\n" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", fetchMock);
    try {
      await generateFromModel({ cwd, config: loaded.config, role: "code_writer", packet });
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")) as { prompt?: string };
      expect(body.prompt).toContain("Return ONLY a unified diff patch");
      expect(body.prompt).toContain("Do not wrap the diff in markdown fences");
      expect(body.prompt).toContain("Use /dev/null for new files");
      expect(body.prompt).toContain("Empty repository evidence is normal for new projects");
      expect(body.prompt).toContain("If evidence says allowed files are missing, that is permission to create them");
      expect(body.prompt).toContain("Every changed file needs its own top-level diff --git section");
      expect(body.prompt).toContain("Make the verification commands pass");
      expect(body.prompt).toContain("node --check src/main.js");
      expect(body.prompt).toContain("Allowed files:");
      expect(body.prompt).toContain("index.html");
      expect(body.prompt).toContain("Create a browser Snake game scaffold");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

it("async CLI failures are converted into exit codes instead of uncaught rejections", async () => {
    const cwd = tempWorkspace();
    const cap = capture();
    const code = await runCli(["models", "probe", "missing_role"], { cwd, io: cap.io });
    expect(code).toBe(7);
    expect(cap.stderr.join("\n")).toContain("no model configured");
  });
});
