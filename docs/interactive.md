# Interactive

<table>
<colgroup>
<col style="width: 25%" />
<col style="width: 25%" />
<col style="width: 25%" />
<col style="width: 25%" />
</colgroup>
<thead>
<tr>
<th style="text-align: left;">command</th>
<th style="text-align: left;">arguments</th>
<th style="text-align: left;">description</th>
<th style="text-align: left;">effect</th>
</tr>
</thead>
<tbody>
<tr>
<td style="text-align: left;"><p>/tools</p></td>
<td style="text-align: left;"><p>[--connect]</p></td>
<td style="text-align: left;"><p>List tool metadata</p></td>
<td style="text-align: left;"><p>Lists registered tools and optionally discovers MCP tools under the execution policy</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/mcp</p></td>
<td style="text-align: left;"><p>[--connect]</p></td>
<td style="text-align: left;"><p>List MCP servers</p></td>
<td style="text-align: left;"><p>Lists configured servers and optionally discovers their tool counts</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/help</p></td>
<td style="text-align: left;"></td>
<td style="text-align: left;"><p>Show slash commands</p></td>
<td style="text-align: left;"><p>Prints the available slash commands</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/exit</p></td>
<td style="text-align: left;"></td>
<td style="text-align: left;"><p>Exit interactive mode</p></td>
<td style="text-align: left;"><p>Ends the interactive session</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/session</p></td>
<td style="text-align: left;"></td>
<td style="text-align: left;"><p>Show the current session information</p></td>
<td style="text-align: left;"><p>Prints the full session ID and diagnostic summary</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/model</p></td>
<td style="text-align: left;"></td>
<td style="text-align: left;"><p>Show the current model</p></td>
<td style="text-align: left;"><p>Prints the current provider and model</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/model</p></td>
<td style="text-align: left;"><p>provider:model</p></td>
<td style="text-align: left;"><p>Switch the current model</p></td>
<td style="text-align: left;"><p>Updates the provider and model for subsequent requests</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/debug</p></td>
<td style="text-align: left;"></td>
<td style="text-align: left;"><p>Show debug logging state</p></td>
<td style="text-align: left;"><p>Prints whether debug logging is on or off</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/debug</p></td>
<td style="text-align: left;"><p>on</p></td>
<td style="text-align: left;"><p>Enable debug logging</p></td>
<td style="text-align: left;"><p>Turns debug logging on for subsequent requests</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/debug</p></td>
<td style="text-align: left;"><p>off</p></td>
<td style="text-align: left;"><p>Disable debug logging</p></td>
<td style="text-align: left;"><p>Turns debug logging off for subsequent requests</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/skills</p></td>
<td style="text-align: left;"></td>
<td style="text-align: left;"><p>List Skill metadata</p></td>
<td style="text-align: left;"><p>Displays source IDs and digests without activating instructions</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/skill</p></td>
<td style="text-align: left;"><p>ID@DIGEST</p></td>
<td style="text-align: left;"><p>Select a Skill</p></td>
<td style="text-align: left;"><p>Adds a pending one-Run selection</p></td>
</tr>
<tr>
<td style="text-align: left;"><p>/skill</p></td>
<td style="text-align: left;"><p>clear</p></td>
<td style="text-align: left;"><p>Clear pending Skills</p></td>
<td style="text-align: left;"><p>Leaves historical snapshots intact</p></td>
</tr>
</tbody>
</table>

## Managed operations

The default workspace-confirm policy allows reads inside the workspace and asks before edits, commands and MCP operations. Use Y or N for the displayed single-operation request. Ctrl+C during a run requests stop; an incomplete result means cleanup or effects remain unconfirmed. The interface reports the run result and required recording failure. An application owner can select --execution-policy unrestricted explicitly; limits and required recording still apply. Persistent recording defaults to file-and-directory-sync; --journal-level file-sync explicitly selects weaker acknowledgement when needed. See [Managed Execution](execution.md) for ownership and migration details.

## Tool and MCP inspection

Use /tools and /mcp to inspect registered tools and configured MCP servers. Add --connect to discover MCP tools under the current execution policy. Discovery uses Y/N approval and Ctrl+C cancellation without calling a model. See [Tool inventory](tools.md) for unknown counts, transient recording and failure behavior.

## Selected instructions

Use /skills to inspect explicit sources and /skill ID@DIGEST to select the next Run’s instructions. Successful admission consumes pending choices; rejected admission retains them. Local slash commands do not consume selections. Use /skill clear to clear the pending set. See [Explicit Skill selection](skills.md) for source validation and reader migration.
