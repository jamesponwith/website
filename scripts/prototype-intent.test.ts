import { describe, expect, test } from "bun:test";
import { composeDecision, intentQuestions, interpretIntent, parseSceneCommand } from "./prototype-intent";

const current = { shape: "torus", color: "amber", speed: 1, amplitude: 1 };
function result(overrides: Record<string, string> = {}) {
  const selections = { action: "transform", shape: "retain", color: "retain", speed: "retain", amplitude: "retain", ...overrides };
  return { model: "jev-1.13.0", answers: Object.fromEntries(Object.entries(selections).map(([name, choice]) => [name, { type: "choice", choice, confidence: .92, probabilities: { [choice]: 1 } }])) };
}

describe("native scene command boundary", () => {
  test("all supported geometry and palettes, including new transformations", () => {
    for (const command of ["shape galaxy", "shape helix", "shape lattice", "color ice", "scene speed .1", "amplitude 2", "pause", "reset"]) expect(parseSceneCommand(command)).not.toBeNull();
  });
  test("rejects shell execution, extra arguments, non-finite and out-of-range numbers", () => {
    for (const command of ["shape galaxy; pwd", "reset; ls", "speed 3.1", "speed 0", "speed NaN", "amplitude .1", "amplitude Infinity", "color ice extra", "pause now", "$(whoami)", "color cyan\nburst", "shape nonexistent"]) expect(parseSceneCommand(command)).toBeNull();
  });
});

describe("Jev decision composition", () => {
  test("retains unmentioned properties", () => {
    const text = "make it icy";
    const decision = composeDecision(result({ color: "ice" }), intentQuestions(text), text, current, "browser", 80);
    expect(decision.commands).toEqual(["color ice"]);
    expect(decision.shape).toBe("torus");
    expect(decision.speed).toBe(1);
    expect(decision.model).toBe("jev-1.13.0");
  });
  test("composes selected transforms and clamps relative speed", () => {
    const text = "a violet helix, faster and turbulent";
    const decision = composeDecision(result({ shape: "helix", color: "violet", speed: "faster", amplitude: "expansive" }), intentQuestions(text), text, { ...current, speed: 2.7 }, "phone", 99);
    expect(decision.commands).toEqual(["shape helix", "color violet", "speed 3", "amplitude 2"]);
    expect(decision.source).toBe("phone");
  });
  test("unrelated requests perform no operations even if speculative values are selected", () => {
    const text = "send email";
    const decision = composeDecision(result({ action: "no_match", shape: "galaxy", color: "cyan" }), intentQuestions(text), text, current, "terminal", 90);
    expect(decision.commands).toEqual([]);
    expect(decision.shape).toBe(current.shape);
  });
  test("numeric selection uses only bounded candidates present in source", () => {
    const text = "set speed to 1.7";
    const questions = intentQuestions(text);
    expect(questions.speed.criteria.value_1).toBeUndefined();
    expect(questions.speed.criteria["value_1.7"]).toBeDefined();
    const decision = composeDecision(result({ speed: "value_1.7" }), questions, text, current, "browser", 40);
    expect(decision.commands).toEqual(["speed 1.7"]);
  });
  test("leading decimals keep their exact value instead of becoming integers", () => {
    for (const text of ["speed .3", "speed +.3", "speed 0.3", "speed +0.3"]) {
      const questions = intentQuestions(text);
      expect(questions.speed.criteria["value_0.3"]).toBeDefined();
      expect(questions.speed.criteria.value_3).toBeUndefined();
      const decision = composeDecision(result({ speed: "value_0.3" }), questions, text, current, "browser", 40);
      expect(decision.commands).toEqual(["speed 0.3"]);
    }
  });
  test("signed invalid speeds and numeric fragments never offer a positive substitute", () => {
    for (const text of ["speed -.3", "speed -0.3", "speed -3", "speed 3.1", "speed 1e-3", "speed .3x"]) {
      const criteria = intentQuestions(text).speed.criteria;
      expect(Object.keys(criteria).filter(key => key.startsWith("value_"))).toEqual([]);
    }
  });
  test("optical worlds retain the compatible wire values", () => {
    const criteria = intentQuestions("liquid glass").shape.criteria;
    const worlds = { torus: "Gravitational horizon", wave: "Liquid glass", sphere: "Deep lens", galaxy: "Radiance", helix: "Folded light", lattice: "Glass architecture" };
    for (const [wire, description] of Object.entries(worlds)) {
      expect(criteria[wire]).toContain(description);
      const decision = composeDecision(result({ shape: wire }), intentQuestions(description), description, current, "browser", 40);
      expect(decision.commands).toEqual([`shape ${wire}`]);
    }
  });
  test("rejects invented option, bad model identity and non-finite confidence", () => {
    expect(() => composeDecision(result({ shape: "shell" }), intentQuestions("ring"), "ring", current, "browser", 1)).toThrow("invalid typed");
    expect(() => composeDecision({ ...result(), model: "local-fallback" }, intentQuestions("ring"), "ring", current, "browser", 1)).toThrow("model identity");
    const invalid = result();
    invalid.answers.shape.confidence = NaN;
    expect(() => composeDecision(invalid, intentQuestions("ring"), "ring", current, "browser", 1)).toThrow("invalid typed");
  });
  test("missing credentials fail explicitly without pretending to interpret", async () => {
    await expect(interpretIntent("galaxy", current, "browser", null)).rejects.toThrow("TYPESAFE_API_KEY is missing");
  });
});
