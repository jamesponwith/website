import {expect,test} from "bun:test";
import {homeHero,heroSearch} from "../src/lib/home-hero";

test("the live workspace is the default and explicit classic links remain usable",()=>{
  expect(homeHero("")).toBe("light");
  expect(homeHero("?hero=light")).toBe("light");
  expect(homeHero("?hero=classic")).toBe("classic");
  expect(homeHero("?hero=unknown")).toBe("light");
});
test("native sign-in returns select their existing classic terminal flow",()=>{
  expect(homeHero("?hero=light","success")).toBe("classic");
  expect(homeHero("","error")).toBe("classic");
  expect(homeHero("",undefined)).toBe("light");
  expect(homeHero("?hero=light",undefined,"classic")).toBe("classic");
});
test("view changes preserve unrelated query parameters and restore the canonical default",()=>{
  expect(heroSearch("?ref=release&hero=light","classic")).toBe("?ref=release&hero=classic");
  expect(heroSearch("?hero=classic","light")).toBe("");
  expect(heroSearch("?ref=release&hero=classic","light")).toBe("?ref=release");
});
