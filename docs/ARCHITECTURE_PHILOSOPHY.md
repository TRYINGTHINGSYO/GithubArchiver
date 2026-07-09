# GitHubArchive+ Architecture Philosophy

## Mission

GitHubArchive+ preserves software evidence, then turns it into explainable repository intelligence.

## Architecture

```text
Evidence
↓
Repository DNA
↓
Analysis Engines
↓
Versioned Intelligence
↓
Evidence Graph
↓
Provenance & Explanation
↓
User Experience
```

## Architectural Laws

1. Evidence before intelligence
2. Explain every conclusion
3. Stable evidence identities
4. Reproducibility
5. Immutable evidence, versioned intelligence
6. Provenance over authority
7. Derived data is disposable; evidence is not

## Platform Models

1. Repository DNA
2. Evidence Graph

## Design Principles

1. Progressive disclosure
2. Deterministic over inferred
3. Time-aware reasoning
4. Actionable intelligence
5. Human-first presentation

## Key Definitions

### Repository DNA

Repository DNA is the normalized platform model that describes what a repository objectively is: languages, frameworks, manifests, license, releases, activity, file structure, documentation, dependencies, CI/CD, and other durable traits.

### Evidence Graph

The Evidence Graph is the internal provenance model connecting preserved artifacts, derived facts, analysis results, conclusions, and explanations.

It is not merely the frontend visualization. The UI graph is only one renderer of this model.

```text
artifact → derived fact → analysis result → conclusion → explanation
```

## Core Rule

Summaries first. Evidence on demand. No claim without a trail.

## Most Important Law

### Immutable Evidence, Versioned Intelligence

Preserved artifacts are historical records and must remain immutable.

Intelligence layers may evolve, but each result must record the algorithm, ruleset, or model version that produced it.

Scores can change. Summaries can improve. Risk models can get smarter.

The archive remains the source of truth.

## Provenance Over Authority

A conclusion is trustworthy because its origin is transparent and reproducible, not because GitHubArchive+ asserts it.

Every intelligence artifact should expose:

- the evidence it consumed
- the algorithm, ruleset, or model version that produced it
- when it was computed
- how it can be reproduced

## Derived Data Is Disposable

Derived data can be deleted and regenerated from preserved evidence.

Archive scores, recoverability reports, risk assessments, Repository Memory summaries, and AI interpretations are analysis outputs. They are valuable, but they are not the archive.

If an algorithm improves, its prior results may be recomputed from immutable evidence without losing the historical record.

## Executable Contracts

Every intelligence capability should fit the same pipeline:

```ts
interface EvidenceProducer {
	produce(): EvidenceArtifact[];
}

interface AnalysisEngine {
	analyze(dna: RepositoryDNA): IntelligenceResult;
}

interface ExplanationProvider {
	explain(resultId: string): EvidenceGraph;
}
```

An intelligence result is a reproducible analysis artifact, not a UI component:

```ts
interface IntelligenceResult {
	id: string;
	type: 'archive_score' | 'recoverability' | 'risk' | 'summary';
	algorithmVersion: string;
	evidenceIds: string[];
	dnaVersion: string;
	computedAt: string;
	value: unknown;
	confidence: number;
}
```

## Product Identity

GitHubArchive+ is a software evidence platform.

Archive Score, Repository DNA, recoverability, risk reports, snapshot comparisons, exports, APIs, and AI summaries are all views over preserved evidence.
