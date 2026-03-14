// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import {Agent} from "@src/lib/agent.js";
import assert from "node:assert";

describe("Agent", () => {
  describe("#chat()", () => {
    it("should return a response from the chat model", async () => {
      const agent = new Agent();
      const response = await agent.chat("Hello");
      assert.ok(response.length > 0, "Response should not be empty");
    });
  });
});
