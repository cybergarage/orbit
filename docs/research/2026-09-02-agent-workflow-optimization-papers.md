---
status: current
investigation-date: 2026-09-02
orbit-commit: ed08f33d63b7e75c4d62c33b966e481a5c8ff012
related-adrs: []
superseded-by: []
---

# Agent Workflow Optimization Papers

## Purpose

This note examines three primary publications that treat language-agent prompts,
communication links, or complete workflows as optimization targets:

- GPTSwarm: Language Agents as Optimizable Graphs;
- AFlow: Automating Agentic Workflow Generation; and
- EvoAgentX: An Automated Framework for Evolving Agentic Workflows.

The goal is to preserve enough detail about each paper's contribution,
architecture, optimization loop, evaluation, and limitations to support future
Orbit design work. The note also separates the papers' demonstrated results from
broader claims about self-improving production agents.

This note is research, not a decision. It does not approve adaptive execution,
graph optimization, or automated promotion in Orbit.

## Research Questions

1. What does each paper optimize: prompts, graph connections, complete workflow
   code, tools, or another artifact?
2. What representation and feedback loop make that optimization possible?
3. Which claimed contributions are novel relative to the other papers?
4. What do the published evaluations demonstrate, under which models and
   benchmarks?
5. Which claims do the evaluations not establish?
6. What evidence is relevant to Orbit's Processor Graph and Adaptive Execution
   directions?

## Orbit Baseline

The Orbit baseline is `ed08f33d63b7e75c4d62c33b966e481a5c8ff012`. At
this revision, Orbit has `Operator`, `Processor`, `OperatorSequence`, and
`ProcessorRegistry`, while its model/tool iteration remains a fixed loop inside
`Agent`. This commit had not been published to the public `main` branch at the
investigation date, so this note does not provide a GitHub link for it. Orbit
does not implement a general Processor Graph, graph optimizer, candidate graph
evaluator, graph-version promotion, or rollback control plane at this baseline.

The publications in this note are therefore evidence for a possible direction,
not descriptions of current Orbit behavior.

Codex and Pi were not investigated for this note because its scope is published
workflow-optimization methods rather than agent runtime, tool, session,
persistence, or observability behavior. Their runtime implications remain
covered by the broader
[Adaptive Processor Graph Runtime](2026-09-02-adaptive-processor-graph-runtime.md)
investigation.

## Sources and Verification Scope

The paper publications are the primary evidence. Evaluation values were checked
against the tables and surrounding experimental descriptions in the official
PDFs on 2026-09-02.

| Work      | Publication used                                                        | Supplemental project                                                                                                                 | Verification boundary                                                                                                                                 |
| --------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GPTSwarm  | ICML 2024, PMLR 235, pages 62743-62767                                  | [public project linked by the authors](https://github.com/metauto-ai/GPTSwarm)                                                       | Paper architecture, algorithms, experiments, and reported costs; no source-code behavior claim                                                        |
| AFlow     | ICLR 2025 conference paper, OpenReview `z5uVAKwmjf`; arXiv `2410.10762` | [FoundationAgents/AFlow](https://github.com/FoundationAgents/AFlow)                                                                  | Paper architecture, algorithms, experiments, and reported costs; the repository is supplemental and was not used to establish implementation behavior |
| EvoAgentX | EMNLP 2025 System Demonstrations, ACL Anthology `2025.emnlp-demos.47`   | [`d77fd6b9a3e76c8dd83bebe3374c53a3f5d16f54`](https://github.com/ANative-Lab/EvoAgentX/tree/d77fd6b9a3e76c8dd83bebe3374c53a3f5d16f54) | Paper architecture and experiments; the pinned repository is contextual evidence already used by the broader Orbit investigation                      |

The downloaded official PDFs had the following SHA-256 values during this
investigation. These hashes identify the exact documents inspected even if an
arXiv landing page later points to a newer revision.

| Work      | SHA-256                                                            |
| --------- | ------------------------------------------------------------------ |
| GPTSwarm  | `63aab69835f124fd1bee714a21433a696c4d8d36da9f7883e0b5b01b836fd6ed` |
| AFlow     | `9be15f695f11dd5bc634c1c026bd2270eff3d3c4a53c4d9b51c012b7bd03d521` |
| EvoAgentX | `9caeb9a286bd2d3ccfa577bda649a322f736c37c31278c8a79aaee287fc58a84` |

## Summary of Findings

The three works form a progression, but they do not optimize the same object.

| Dimension                | GPTSwarm                                                    | AFlow                                                        | EvoAgentX                                                                           |
| ------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| Primary contribution     | Unified graph representation plus node and edge optimizers  | Search over code-represented complete workflows              | Integrated platform for constructing, executing, evaluating, and evolving workflows |
| Basic execution unit     | Operation node                                              | LLM-invoking node and reusable operator                      | Agent action and workflow node                                                      |
| Structure representation | Directed acyclic computational graph                        | Executable code expressing branches, loops, and dependencies | Directed workflow graph, including general and sequential graph forms               |
| Main optimization target | Edge inclusion probabilities and node prompts               | Prompts and code-represented edges of a complete workflow    | Agent prompts/configuration and workflow topology through integrated optimizers     |
| Search or update method  | REINFORCE for edges; iterative prompt improvement for nodes | MCTS variant with LLM expansion and execution feedback       | TextGrad, MIPRO, AFlow, and described SEW integration behind optimizer interfaces   |
| Evaluation role          | Task utility scores graph samples or node outputs           | Validation execution scores each candidate workflow          | Task-specific and LLM-based evaluators provide feedback                             |
| Demonstrated scope       | MMLU, Mini Crosswords, HumanEval, GAIA                      | Six QA, code, and math benchmarks                            | HotPotQA, MBPP, MATH, and two GAIA applications                                     |

Verified finding: these papers establish that prompt content, agent
communication links, and executable workflow structure can all be represented as
search variables and improved on selected benchmark objectives.

They do not establish that an agent should modify its active production graph
during a live run. GPTSwarm optimizes distributions and prompts against task
utilities, AFlow searches and evaluates candidate workflows, and EvoAgentX runs
optimizers against evaluators. The evidence supports an evaluate-then-select
loop, not uncontrolled in-place self-modification.

## GPTSwarm

### Publication and Problem

GPTSwarm was published at ICML 2024. It addresses fragmentation among prompting
and multi-agent techniques by expressing language-agent systems through one
computational-graph model. The paper treats an operation as a node, an agent as
a graph of nodes, and a swarm as a composite graph of agents.

The problem is not only workflow execution. The graph representation is chosen
so that both local node behavior and communication structure become explicit
optimization variables.

### Claimed Novelty

The paper makes four relevant contributions:

1. It describes language agents and multi-agent systems using a common graph
   representation.
2. It supplies a framework for composing agents from reusable operations and
   recursively composing agents into larger graphs.
3. It introduces separate node and edge optimization procedures. Node
   optimization changes prompts, while edge optimization changes inter-agent
   communication topology.
4. It evaluates graph optimization and modular graph construction across
   knowledge, puzzle, code-generation, and general-assistant benchmarks.

The important novelty for Orbit is the separation between optimizing what a
node does and optimizing how nodes communicate. The paper does not collapse
prompt configuration and graph topology into one undifferentiated parameter.

### Architecture

GPTSwarm defines a language agent as a directed computational graph
`G = (N, E, F, o)`:

- `N` is the set of computational nodes;
- `E` is the set of directed edges;
- `F` assigns a computational routine to each node; and
- `o` is the output node.

A node may invoke an LLM, call a function or tool, or perform another operation.
The paper's experiments use natural-language strings for inputs and outputs,
although the formalization allows other data types.

Execution follows a topological order. Each node receives the original input
and the outputs of its predecessors, executes its routine, and forwards its
output to successors. The paper restricts the studied graphs to DAGs.

A swarm combines the nodes, internal edges, and routines of several agent
graphs. Additional cross-agent edges represent communication channels. The
selection of those additional edges determines the orchestration topology.

This model supports hierarchical composition, but its published execution
algorithm does not cover cycles, suspensions, checkpoints, or long-running graph
versions.

### Edge Optimization

For `d` potential edges, a discrete search would contain `2^d` configurations.
GPTSwarm instead assigns a real-valued probability parameter to each potential
edge and defines a distribution over feasible DAGs. During sampling, an edge is
excluded if adding it would create a cycle; otherwise it is included according
to its parameter.

The objective is the expected task utility of graphs sampled from that
distribution. GPTSwarm estimates its gradient and updates edge parameters using
REINFORCE with gradient ascent; the experiments use Adam. Edge optimization
therefore learns a probability distribution over DAG connectivity rather than
directly editing one deterministic graph after each example.

### Node Optimization

An LLM-backed node has a prompt and a natural-language description of its
intended function. For each execution, GPTSwarm records the node input, its
predecessor context, and its output in node-specific history. An improver then
updates each node's prompt from that history, the current prompt, and the
function description.

The design differs from optimizing one global system prompt. Each node owns a
separate prompt associated with a specific operation, and other prompts are held
fixed during one node update. The paper presents the improver as a general
interface; individual experiments instantiate it differently, including UCB1
selection of demonstrations.

### Evaluation Setup

The paper evaluates distinct aspects of the framework rather than applying one
identical optimizer to every benchmark.

| Benchmark       | Evaluated capability                                                              | Main setup                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| MMLU            | Edge optimization and resistance to adversarial agents                            | Equal numbers of truthful and adversarial input-output agents; majority vote; GPT-4 Turbo; 200 REINFORCE iterations for the adversarial setting |
| Mini Crosswords | Edge optimization among different reasoning agents, followed by node optimization | Three-agent swarm using Tree of Thought, Reflexion, and Chain of Thought; 20 problems; GPT-3.5 Turbo for primary optimization                   |
| HumanEval       | Node-level prompt optimization                                                    | ReAct-style code generation with execution feedback; three repeated runs                                                                        |
| GAIA            | Modularity and swarm composition                                                  | Multiple task-solving/tool nodes and prompt-based answer selection; no node or edge optimization in this experiment                             |

The GAIA result is important but must not be reported as evidence for the graph
optimizer. The authors explicitly use GAIA to demonstrate modular framework
capabilities and leave node and edge optimization out of that experiment.

### Reported Results

The principal reported results are:

- On collaborative MMLU, an optimized seven-role swarm improves over the
  single-agent baseline by `2.1% ± 1.1%`, averaged over five training seeds.
- In the adversarial 3-truthful/3-adversarial MMLU comparison, GPTSwarm reaches
  `0.8301` accuracy, compared with `0.8366` for DyLAN and `0.5751` for
  Multiagent Debate. GPTSwarm reports substantially lower optimization and
  inference cost than DyLAN in this setup: `$5.32` versus `$105.93` for
  optimization and `$1.82` versus `$14.99` for inference.
- On Mini Crosswords, edge optimization improves mean word accuracy from
  `0.465 ± 0.0509` for the initial graph distribution to `0.575 ± 0.0275` after
  ten iterations. A graph distribution with similar expected edge density but
  unoptimized probabilities scores `0.510 ± 0.0552`, providing evidence that
  connectivity, rather than edge count alone, matters.
- Applying node optimization after Mini Crosswords edge optimization raises
  accuracy to `0.668 ± 0.0060`.
- Evaluating one optimized Mini Crosswords distribution with GPT-4 Turbo yields
  `0.800 ± 0.0616`, compared with `0.675` for the cited Tree-of-Thought result
  using GPT-4 and `0.668` for the authors' Tree-of-Thought implementation using
  GPT-4 Turbo.
- On HumanEval, online node optimization improves accuracy from `0.76` to
  `0.88 ± 0.007`.
- On GAIA, a seven-Tree-of-Thought-agent swarm averages `18.45%` across three
  levels, compared with `9.70%` for GPT-4 Turbo and `14.6%` for GPT-4 with
  manually selected plugins in the paper's comparison. This experiment does not
  apply the graph optimizers.

### Limitations and Interpretation

- The optimization experiments use selected benchmarks, utilities, prompts,
  and dated GPT-3.5/GPT-4 Turbo model versions. They do not establish
  model-independent gains.
- The graph formalism and edge sampler are restricted to DAGs. The paper does
  not demonstrate adaptive cyclic execution or persistent workflows.
- Optimization can be expensive. The paper reports `$77.42` for one
  GPT-3.5-Turbo Mini Crosswords edge-optimization run and `$28.46` for the
  optimized HumanEval experiment, compared with `$1.61` without HumanEval
  optimization.
- The MMLU adversarial task strongly favors learning to suppress harmful
  communication. It is useful evidence that links matter, but it is not a
  general production-security result.
- The paper identifies scaling beyond 100 agents, internal agent-topology
  optimization, communication efficiency, and robustness as future work.
- No experiment evaluates policy constraints, capability safety, immutable
  graph versions, promotion approval, canaries, or rollback.

## AFlow

### Publication and Problem

AFlow was published as an ICLR 2025 conference paper. It reformulates automated
agentic workflow generation as search over complete, executable workflows.
Where GPTSwarm uses explicit graph connectivity, AFlow uses code as the primary
edge representation so that conditionals, loops, parallelism, and dependencies
can be expressed with ordinary programming constructs.

The paper argues that a large workflow search space is not sufficient by itself.
It focuses on improving search efficiency through reusable operators,
tree-structured experience, execution feedback, and an MCTS variant.

### Claimed Novelty

AFlow's relevant contributions are:

1. A general formulation in which workflow search covers node parameters and
   edge structures, with prior prompt or graph methods represented as narrower
   cases.
2. Code-represented workflows whose control flow can express more than a basic
   DAG.
3. Reusable operators, such as Generate, Review and Revise, Ensemble, Test, and
   Programmer, that bias search toward established patterns.
4. An MCTS-based optimization loop in which each search-tree node is a complete
   workflow, not one runtime LLM node.
5. LLM-generated workflow modifications informed by tree-local successes,
   failures, predictions, and expected outputs.

The distinction between a runtime workflow node and an MCTS tree node is
essential. The MCTS tree records alternative workflow versions. It is not the
workflow's execution graph.

### Workflow Representation and Search Space

AFlow models a workflow as LLM-invoking nodes connected by edges. The general
node definition includes:

- model;
- prompt;
- temperature; and
- output format.

The theoretical search space includes all of these node parameters plus edge
structures. In the evaluated system, however, the model, temperature, and
format are fixed to reduce the practical search space. AFlow primarily searches
prompts, code-represented edges, and the use of predefined operators.

The evaluated operator set contains Generate, Format, Review and Revise,
Ensemble, Test, Programmer, and a basic Custom operator. The Custom operator
allows search without the richer predefined operators, but the paper's ablation
shows that predefined operators improve search efficiency and performance.

### Optimization Architecture

Each MCTS tree node stores one complete workflow. Optimization proceeds through
five stages:

1. **Initialization:** start with a code template for invoking nodes and
   operators. The paper describes this as an empty or blank workflow, although
   the template and invocation interfaces remain supplied.
2. **Selection:** select among top workflows and the initial workflow using a
   mixture of uniform and score-weighted probabilities. The paper uses
   `lambda = 0.2` and score influence `alpha = 0.4`.
3. **Expansion:** ask an optimizer LLM to make a single-step code or prompt
   modification using the selected workflow's accumulated experience.
4. **Evaluation:** execute the generated workflow five times on the validation
   set and compute mean and standard deviation.
5. **Backpropagation:** record performance, the parent-to-child modification,
   and whether it improved the parent, then propagate that experience for later
   selection and expansion.

Search stops after a fixed maximum number of rounds or when the average score of
the top candidates does not improve for a configured number of rounds. The
experiments use 20 AFlow rounds.

This is an offline candidate-generation and evaluation architecture. It does
not mutate the workflow currently executing one benchmark item.

### Evaluation Setup

The authors use a `20%` validation and `80%` test split with random seed 42.
HumanEval, MBPP, and GSM8K use their full datasets. HotpotQA and DROP use 1,000
samples each. The MATH subset contains 617 level-five problems from four topic
areas.

Claude 3.5 Sonnet is the optimizer LLM. Executor models include
GPT-4o-mini-0718, DeepSeek-V2.5, GPT-4o-0513, and Claude-3.5-Sonnet-0620. The
main six-benchmark table executes all methods with GPT-4o mini and averages
three test runs.

The metrics are solve rate for GSM8K and MATH, pass@1 for HumanEval and MBPP,
and F1 for HotpotQA and DROP. Baselines include direct invocation, Chain of
Thought, self-consistency, MedPrompt, MultiPersona Debate, Self-Refine, and the
automated ADAS method.

### Reported Results

The main GPT-4o-mini results are:

| Method                           | HotpotQA | DROP | HumanEval | MBPP | GSM8K | MATH | Average |
| -------------------------------- | -------: | ---: | --------: | ---: | ----: | ---: | ------: |
| Direct invocation                |     68.1 | 68.3 |      87.0 | 71.8 |  92.7 | 48.6 |    72.8 |
| CoT self-consistency (5 answers) |     68.9 | 78.8 |      91.6 | 73.6 |  92.7 | 50.4 |    76.0 |
| ADAS                             |     64.5 | 76.6 |      82.4 | 53.4 |  90.8 | 35.4 |    67.2 |
| AFlow                            |     73.5 | 80.6 |      94.7 | 83.4 |  93.5 | 56.2 |    80.3 |

The paper summarizes these results as a `5.7%` average improvement over the
best manually designed baseline average and a `19.5%` improvement over the
automated ADAS average. These are differences relative to the reported averages,
not a claim that every benchmark improves by those amounts.

On HumanEval, workflows found with GPT-4o mini and DeepSeek-V2.5 transfer to
other executor models and generally exceed direct invocation. The workflow
searched with one executor is not always best for another: on GPT-4o mini, the
GPT-4o-mini-searched workflow scores `94.7`, while the DeepSeek-searched
workflow scores `90.8`. This is evidence that workflow quality can be
model-dependent.

The cost comparison reports that executing the GPT-4o-mini-searched workflow
with DeepSeek reaches `93.9%` HumanEval pass@1 at `$0.0291`, approximately
`4.55%` of the `$0.6371` cost of direct GPT-4o at `93.89%`. This comparison is
for inference on the divided HumanEval test set. It does not include the full
cost of searching for the workflow.

In the operator ablation on GSM8K, AFlow without the predefined operator set
still reaches `93.1%` and discovers an ensemble-like structure, but the paper
reports that operators find stronger workflows more efficiently.

### Limitations and Interpretation

- The paper's broad search-space formulation includes model, temperature, and
  output format, but the evaluated search fixes those variables. The reported
  results primarily validate prompt and code-structure search.
- AFlow reduces manual workflow authoring but still depends on a code template,
  predefined node/operator interfaces, task-specific operators in the main
  setting, an executable evaluator, dataset splits, and optimizer prompts.
- Optimization uses the validation set repeatedly and selects candidates by
  measured score. Held-out test results reduce but do not eliminate risks of
  benchmark-specific overfitting.
- The primary experiments are reasoning tasks with explicit numerical
  evaluators. Appendices explore open-ended tasks, but those examples do not
  provide equivalent benchmark evidence for reliable production optimization.
- The `4.55%` cost result compares inference costs after a workflow has been
  found. It should not be reported as total optimization lifecycle cost.
- Generated workflows are executable code. The paper does not evaluate static
  safety checks, capability policies, sandbox boundaries, provenance-based
  promotion, or rollback.

## EvoAgentX

### Publication and Problem

EvoAgentX was published in the EMNLP 2025 System Demonstrations track. Its
primary contribution is an open-source integration platform rather than a new
single search algorithm. It connects workflow generation and execution to
several optimizer families and a common evaluation layer.

The paper addresses two practical gaps: many multi-agent frameworks require
hand-authored workflows, and optimization methods such as TextGrad, AFlow, and
MIPRO are otherwise fragmented across different toolchains.

### Claimed Novelty

The paper's relevant contributions are:

1. automatic multi-agent workflow construction from high-level task
   descriptions;
2. a five-layer modular architecture that separates infrastructure, agents,
   workflows, optimization, and evaluation;
3. common integration of multiple prompt and workflow optimization algorithms;
   and
4. built-in benchmark and evaluator support for applying those optimizers to
   both framework examples and existing multi-agent applications.

Unlike GPTSwarm and AFlow, EvoAgentX should be interpreted primarily as a
systems and integration contribution. Its reported gains come from integrated
algorithms, not from one new EvoAgentX optimization rule that is applied
uniformly to every task.

### Five-Layer Architecture

The paper describes five layers.

#### Basic Components

The basic-component layer supplies configuration validation, logging, file
handling, storage, caching, checkpointing, and model-provider integration. The
paper mentions OpenRouter and LiteLLM for model access.

#### Agent

An agent combines an LLM, memory, and a set of actions. Each action carries a
prompt template, input/output formats, and optional tools. The LLM performs
reasoning and response generation, while actions define executable task logic.

#### Workflow

A workflow is a directed graph `W = (V, E)`. A workflow node records a task,
inputs, outputs, associated agents, and a status such as pending, running,
completed, or failed. A node can contain a set of agents or an explicit
`ActionGraph`.

The layer exposes a general `WorkFlowGraph` for custom nodes, edges,
conditional branches, and parallel patterns, plus a `SequentialWorkFlowGraph`
that infers connections from task input/output dependencies.

#### Evolving

The evolving layer separates three optimizer roles:

- the agent optimizer refines prompts, tool configurations, and action
  strategies;
- the workflow optimizer changes task decomposition and graph structure; and
- the memory optimizer is described as under active development.

The paper associates TextGrad and MIPRO with agent optimization and associates
AFlow and SEW with workflow optimization. Evaluation feedback is the common
input to each update interface.

#### Evaluation

The evaluation layer provides task-specific evaluators and LLM-based
evaluators. Task-specific evaluators compare outputs with ground truth using
metrics such as F1, pass@1, and solve rate. LLM evaluators support qualitative
criteria and consistency checks where static metrics are unavailable.

The architectural separation is relevant to Orbit because it treats evaluation
as its own layer rather than embedding a score call inside each optimizer.

### Evaluation Setup

The paper reports two categories of experiment:

1. integrated optimizer results on HotPotQA, MBPP, and MATH; and
2. application of EvoAgentX to Open Deep Research and OWL on GAIA.

For the first category, the original workflow is compared with TextGrad,
AFlow, and MIPRO. Different algorithms achieve the strongest result on
different tasks. For the second category, the paper reports accuracy changes at
GAIA Levels 1 through 3 and overall.

The system-demonstration paper does not document the experimental model,
sampling procedure, run count, variance, confidence interval, optimization
budget, or statistical test at the same level of detail as the AFlow paper.
Those omissions limit cross-paper comparison.

### Reported Results

| Method   | HotPotQA F1 | MBPP pass@1 | MATH solve rate |
| -------- | ----------: | ----------: | --------------: |
| Original |       63.58 |       69.00 |           66.00 |
| TextGrad |       71.02 |       71.00 |           76.00 |
| AFlow    |       65.09 |       79.00 |           71.00 |
| MIPRO    |       69.16 |       68.00 |           72.30 |

The largest task-specific improvements are:

- HotPotQA: TextGrad raises F1 from `63.58` to `71.02`, an absolute
  `7.44`-point gain;
- MBPP: AFlow raises pass@1 from `69.00` to `79.00`, an absolute
  `10.00`-point gain; and
- MATH: TextGrad raises solve rate from `66.00` to `76.00`, an absolute
  `10.00`-point gain.

The paper's wording calls these percentage improvements, but the table supports
percentage-point differences between scores reported on a 0-to-100 scale. This
note preserves the table values and labels the differences as absolute points.

On GAIA, the paper reports:

- Open Deep Research overall accuracy improves by `18.41%`, with reported
  changes of `20.00%`, `8.71%`, and `7.69%` at Levels 1, 2, and 3; and
- OWL overall accuracy improves by `20.00%`, with reported changes of `28.57%`,
  `10.00%`, and `100.00%` at Levels 1, 2, and 3.

The paper reports relative improvement language for this figure without a
tabular baseline count in the extracted text. The Level 3 `100%` value can
represent a small absolute change when the denominator is small, so it should
not be interpreted without the underlying sample counts.

### Limitations and Interpretation

- The paper integrates distinct optimizers, and no single optimizer is best on
  all three reported benchmark tasks. Optimizer selection remains a design and
  evaluation problem.
- MIPRO lowers MBPP from `69.00` to `68.00`. The results therefore include
  contrary evidence: optimization can regress a target task.
- The memory optimizer is explicitly under active development in the paper. It
  is not evidence of a completed adaptive-memory implementation at publication.
- The system-demonstration paper provides limited model, budget, repeated-run,
  and uncertainty details. Its values should not be compared directly with
  AFlow or GPTSwarm as if the experimental conditions were aligned.
- Built-in LLM evaluation is flexible but can introduce evaluator bias and
  correlated model errors. The reported benchmark gains mostly use
  task-specific metrics and do not validate LLM judging as a promotion gate.
- The paper does not evaluate immutable workflow versions, isolated replay,
  approval policies, canary promotion, rollback, or production safety.

## Cross-Paper Analysis

### The Optimization Unit Expands Across the Papers

GPTSwarm exposes two relatively structured parameter groups: prompts at nodes
and probabilities for candidate DAG edges. AFlow expands the structure search
to executable code and treats one complete workflow as an MCTS state.
EvoAgentX then provides a platform boundary in which agent, workflow, and future
memory optimizers can coexist behind shared execution and evaluation layers.

This progression increases expressiveness and risk together. Edge probabilities
over a constrained DAG are easier to validate than arbitrary generated code.
Generated code can express loops and conditions but requires stronger static and
runtime controls. An integration platform can compare several optimizers, but it
also needs a common artifact, evaluator, provenance, and lifecycle contract if
their outputs are to be promoted safely.

### Evaluation Is Part of the Architecture

All three systems require an evaluation function or utility signal. The
optimizer cannot identify an improvement without one.

- GPTSwarm scores sampled graphs and node histories with task utilities.
- AFlow repeatedly executes each candidate workflow on a validation set and
  records the result in tree-structured experience.
- EvoAgentX exposes evaluation as a separate layer and feeds results to agent
  and workflow optimizer interfaces.

The evaluator therefore defines the practical objective of the adaptive system.
If it omits safety, latency, cost, or failure behavior, the optimizer can improve
the measured quality score while degrading the system on unmeasured dimensions.

### Offline Search Is Not Live Self-Modification

The evaluated methods generate or update candidates, measure them, and select a
better result. None of the three papers demonstrates a production run that is
authorized to rewrite its own active workflow and immediately execute the new
structure without a separate validation boundary.

This distinction supports Orbit's separation between an execution plane and a
learning/control plane. The papers provide algorithms that could operate in the
control plane. They do not remove the need for graph validation, versioning,
policy checks, approval, staged promotion, or rollback.

### Optimization Results Are Conditional

The strongest results depend on the benchmark, model, optimizer, and cost
accounting boundary.

- GPTSwarm uses different experimental constructions for MMLU, Mini Crosswords,
  HumanEval, and GAIA.
- AFlow finds workflows that transfer across models, but its own table shows
  that the workflow searched for one executor can be weaker on another.
- EvoAgentX's integrated optimizers have different winners per task and include
  at least one regression.

An adaptive system should therefore store the optimizer, executor model,
dataset, evaluator, seed, budget, candidate artifact, and test result as
provenance. A score without those dimensions is insufficient promotion evidence.

## Implications for Orbit

The following implications are non-binding research conclusions.

1. **Keep prompts, Processor configuration, and graph topology as distinct
   versioned artifacts.** GPTSwarm's node/edge separation and EvoAgentX's
   agent/workflow optimizer separation both support this boundary.
2. **Represent an optimization candidate as a complete immutable Graph
   Version.** AFlow's MCTS states are complete workflows, which aligns with
   comparing candidate versions rather than applying untracked edits.
3. **Constrain the mutation language before accepting generated code.** Orbit
   can obtain much of AFlow's structural search value by generating validated
   graph definitions or typed edit operations instead of arbitrary executable
   code.
4. **Make evaluation a first-class control-plane contract.** It should include
   quality, latency, token and monetary cost, failure rate, capability use, and
   policy violations rather than one benchmark score.
5. **Separate search cost from candidate inference cost.** AFlow's `4.55%`
   result demonstrates an attractive deployed inference point, but promotion
   accounting must also retain the optimizer and validation cost.
6. **Require held-out evaluation and regression gates.** Repeated validation
   search can overfit, and EvoAgentX demonstrates that an optimizer can reduce a
   task score.
7. **Treat optimizer choice as configuration with provenance.** No method is
   uniformly best across tasks or models.
8. **Do not infer production safety from benchmark improvement.** None of the
   papers evaluates Orbit's required promotion, approval, canary, and rollback
   controls.

A conservative initial Orbit experiment could optimize prompts and select among
declared edges while keeping the Processor set, capabilities, terminal states,
and cycle budgets fixed. More expressive topology mutation should follow only
after graph validation, replay, version pinning, and policy evaluation exist.

## Risks and Limitations of This Investigation

- The papers use different dates, model versions, benchmarks, metrics, splits,
  and cost definitions. Their numeric results are not a common leaderboard.
- This note verifies publication claims but does not reproduce the experiments.
- GPTSwarm and AFlow source code were not inspected at pinned revisions for this
  paper-focused note. No implementation claim is inferred from their current
  repositories.
- EvoAgentX evolves after the pinned supplemental revision. Current project
  features may differ from the system-demonstration paper.
- Some paper terminology is broader than Orbit's. In particular, a workflow
  node, agent, graph node, action, and Orbit Processor are not assumed to be
  interchangeable.
- Benchmark improvements do not establish causal attribution to one structural
  change when prompts, topology, demonstrations, or execution strategies change
  together.

## Open Questions

1. Should Orbit's first optimizer search prompts, declared edges, or both?
2. What typed graph-edit language can express useful candidates without allowing
   arbitrary code generation?
3. Which dimensions must a candidate improve or preserve before promotion?
4. How should stochastic candidate scores be aggregated, and what uncertainty
   threshold should block promotion?
5. Which held-out and adversarial datasets can detect evaluator overfitting?
6. How should optimization cost be amortized against inference savings?
7. Should different executor models have independent Graph Versions even when
   their Processor topology is structurally identical?
8. Which Processor properties must remain immutable during early adaptive
   experiments: capabilities, side-effect class, retry safety, or all of them?
9. How should Orbit record failed mutations and negative results so later
   optimizers do not repeat them?
10. What evidence would justify moving from offline evaluation to shadow or
    canary execution?

## Related Decisions

No ADR had adopted an automated graph-optimization method as of 2026-09-02.
Future ADRs should distinguish at least:

- candidate representation and allowed mutations;
- evaluation datasets and promotion criteria;
- graph versioning, provenance, and reproducibility;
- capability and policy validation;
- staged promotion and rollback; and
- optimizer execution and budget isolation.

Related research and directional concepts:

- [Adaptive Processor Graph Runtime](2026-09-02-adaptive-processor-graph-runtime.md)
- [Processor Graph](../concepts/processor-graph.md)
- [Adaptive Execution](../concepts/adaptive-execution.md)

## References

### GPTSwarm

- [GPTSwarm: Language Agents as Optimizable Graphs, PMLR publication page](https://proceedings.mlr.press/v235/zhuge24a.html)
- [GPTSwarm official publication PDF](https://raw.githubusercontent.com/mlresearch/v235/main/assets/zhuge24a/zhuge24a.pdf)
- [GPTSwarm project repository](https://github.com/metauto-ai/GPTSwarm)

### AFlow

- [AFlow: Automating Agentic Workflow Generation, OpenReview](https://openreview.net/forum?id=z5uVAKwmjf)
- [AFlow arXiv record](https://arxiv.org/abs/2410.10762)
- [AFlow project repository](https://github.com/FoundationAgents/AFlow)

### EvoAgentX

- [EvoAgentX: An Automated Framework for Evolving Agentic Workflows, ACL Anthology](https://aclanthology.org/2025.emnlp-demos.47/)
- [EvoAgentX official publication PDF](https://aclanthology.org/2025.emnlp-demos.47.pdf)
- [EvoAgentX arXiv record](https://arxiv.org/abs/2507.03616)
- [EvoAgentX at the contextual source revision](https://github.com/ANative-Lab/EvoAgentX/tree/d77fd6b9a3e76c8dd83bebe3374c53a3f5d16f54)
