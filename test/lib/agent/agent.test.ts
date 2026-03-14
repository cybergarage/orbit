// Copyright (c) 2026 The Scribemuse Authors
// SPDX-License-Identifier: Apache-2.0

import assert from "node:assert";
import {Agent} from "@src/lib/agent/agent.js";

describe("Agent", function () {
  describe("#chat()", function () {
    it("should return a response from the chat model", async function () {
      const agent = new Agent();
      const response = await agent.chat("Hello");
      assert.ok(response.length > 0, "Response should not be empty");
    });
  });
});
