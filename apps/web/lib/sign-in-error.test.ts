import { describe, expect, it } from "vitest"

import { describeSignInError } from "./sign-in-error"

describe("describeSignInError", () => {
  it("names the domain problem", () => {
    expect(describeSignInError("domain_not_allowed")).toMatch(/domain/i)
  })

  it("names the unverified email problem", () => {
    expect(describeSignInError("email_not_verified")).toMatch(/verif/i)
  })

  it("explains a valid session without access", () => {
    expect(describeSignInError("not_authorized")).toMatch(/teachers and admins/i)
  })

  it("stays generic for codes it has never heard of", () => {
    const message = describeSignInError("proto_mismatch_v99")
    expect(message).toMatch(/try again/i)
    // Never echo an upstream code at a person.
    expect(message).not.toContain("proto_mismatch_v99")
  })
})
