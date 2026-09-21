import { QUESTION_KINDS, questionLogic } from "@workspace/quiz-core"
import { describe, expect, it } from "vitest"

import { questionTypes, TYPE_MENU_ORDER, typeDef, typeLabel } from "./registry"

describe("authoring registry", () => {
  it("covers every kind the domain defines", () => {
    expect(Object.keys(questionTypes).sort()).toEqual([...QUESTION_KINDS].sort())
  })

  it("stays in step with the logic registry in quiz-core", () => {
    // If these drift, a kind can be authored but not validated or published.
    expect(Object.keys(questionTypes).sort()).toEqual(Object.keys(questionLogic).sort())
  })

  it("shows every kind in the type menu, exactly once", () => {
    expect([...TYPE_MENU_ORDER].sort()).toEqual([...QUESTION_KINDS].sort())
    expect(new Set(TYPE_MENU_ORDER).size).toBe(TYPE_MENU_ORDER.length)
  })

  it("gives each kind a label, a description, an icon and an editor", () => {
    for (const kind of QUESTION_KINDS) {
      const def = typeDef(kind)
      expect(def.kind, kind).toBe(kind)
      expect(def.label.length, kind).toBeGreaterThan(0)
      expect(def.menuLabel.length, kind).toBeGreaterThan(0)
      expect(def.description.length, kind).toBeGreaterThan(0)
      expect(def.icon, kind).toBeTruthy()
      expect(typeof def.Editor, kind).toBe("function")
    }
  })

  it("gives the two choice variants one short label but distinct menu labels", () => {
    // The type button and the rail say "Multiple Choice" for both, because the
    // one/many switch is what distinguishes them there. The menu has no such
    // switch, so showing the same label twice would be a coin flip.
    expect(typeLabel("single_choice")).toBe(typeLabel("multiple_choice"))
    expect(typeDef("single_choice").menuLabel).not.toBe(
      typeDef("multiple_choice").menuLabel
    )
  })

  it("keeps every menu label distinct", () => {
    const menuLabels = QUESTION_KINDS.map((kind) => typeDef(kind).menuLabel)
    expect(new Set(menuLabels).size).toBe(menuLabels.length)
  })
})
