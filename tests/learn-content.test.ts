import assert from "node:assert/strict";
import { test } from "node:test";
import { CAREER_PATHS } from "@/db/schema";
import { GLOSSARY } from "@/content/learn/glossary";
import { GUIDE_ORDER, GUIDES } from "@/content/learn/guides";
import { RESOURCES } from "@/content/learn/resources";

/* The curated Learn content holds together: every reference resolves. */

const termKeys = new Set(GLOSSARY.map((term) => term.key));

test("every target path except 'other' has a field guide, listed once", () => {
  assert.deepEqual([...GUIDE_ORDER].sort(), CAREER_PATHS.filter((path) => path !== "other").sort());
  for (const path of GUIDE_ORDER) assert.equal(GUIDES[path].path, path);
});

test("glossary keys are unique and no phrase belongs to two terms", () => {
  assert.equal(termKeys.size, GLOSSARY.length, "duplicate glossary key");
  const seen = new Map<string, string>();
  for (const term of GLOSSARY) {
    assert.ok(term.definition.trim(), `${term.key} has no definition`);
    assert.ok(term.paths.length, `${term.key} has no paths`);
    for (const phrase of [term.term, ...term.aliases]) {
      const normalized = phrase.toLowerCase().replace(/[\s-]+/g, " ").trim();
      const owner = seen.get(normalized);
      assert.ok(!owner || owner === term.key, `"${phrase}" is on both ${owner} and ${term.key}`);
      seen.set(normalized, term.key);
    }
  }
});

test("guides reference only real glossary terms", () => {
  for (const guide of Object.values(GUIDES)) {
    for (const stage of guide.workflow) for (const key of stage.terms) assert.ok(termKeys.has(key), `${guide.path} stage "${stage.name}" cites unknown term ${key}`);
    for (const metric of guide.metrics) assert.ok(termKeys.has(metric.term), `${guide.path} metric cites unknown term ${metric.term}`);
    assert.ok(guide.workflow.length && guide.dayInTheLife.length && guide.interviewLoop.length && guide.firstSteps.length, `${guide.path} is missing a section`);
  }
});

test("resources are https, uniquely keyed, and cover real terms", () => {
  const keys = new Set<string>();
  for (const resource of RESOURCES) {
    assert.ok(!keys.has(resource.key), `duplicate resource ${resource.key}`);
    keys.add(resource.key);
    assert.match(resource.url, /^https:\/\//, `${resource.key} url`);
    assert.ok(resource.cost.trim(), `${resource.key} has no cost`);
    for (const key of resource.covers) assert.ok(termKeys.has(key), `${resource.key} covers unknown term ${key}`);
  }
});
